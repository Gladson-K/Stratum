import {
  emptyDesign, inferKind, slugify, edgeId,
  type Design, type NodeKind, type SEdge, type SNode,
} from '../sgm';
import {
  newMeta, readMetaDirective, applyNodeMeta, applyEdgeMeta, applyScenarioMeta,
  nodeMetaLine, edgeMetaLine, scenarioMetaLine,
} from './meta';
import type { ParseError, ParseResult } from './types';

/**
 * Eraser-style architecture dialect (compatible with the general syntax pattern):
 *
 *   title Checkout platform
 *   Client [icon: smartphone]
 *   Data Tier [color: blue] {
 *     Orders DB [icon: postgres]
 *   }
 *   Client > API Service > Orders DB: SQL
 *   API Service --> Events: order.created      (dashed = async)
 *   Web, Mobile > Gateway                       (fan-in)
 *   Gateway < Auth                              (reverse direction)
 *   // @node api_service instances=6            (Stratum metadata)
 */

const KIND_ICON: Record<NodeKind, string> = {
  client: 'monitor',
  cdn: 'aws-cloudfront',
  load_balancer: 'aws-elb',
  gateway: 'aws-api-gateway',
  service: 'server',
  function: 'aws-lambda',
  database: 'postgres',
  cache: 'redis',
  queue: 'aws-sqs',
  stream: 'kafka',
  storage: 'aws-s3',
  search: 'elasticsearch',
  external: 'globe',
};

const ICON_HINTS: [RegExp, NodeKind][] = [
  [/monitor|smartphone|laptop|browser|user|mobile/, 'client'],
  [/cloudfront|cdn|akamai|fastly/, 'cdn'],
  [/elb|alb|load-?balancer|nginx/, 'load_balancer'],
  [/api-gateway|gateway|kong/, 'gateway'],
  [/lambda|function/, 'function'],
  [/redis|memcache|elasticache/, 'cache'],
  [/kafka|kinesis|stream/, 'stream'],
  [/sqs|rabbit|queue|sns/, 'queue'],
  [/s3|bucket|storage/, 'storage'],
  [/elastic|opensearch|search/, 'search'],
  [/postgres|mysql|mongo|dynamo|database|aurora|rds|cassandra/, 'database'],
  [/globe|stripe|twilio|external/, 'external'],
  [/server|ec2|kubernetes|k8s|docker|service/, 'service'],
];

function kindFromIcon(icon?: string): NodeKind | undefined {
  if (!icon) return undefined;
  const i = icon.toLowerCase();
  for (const [re, k] of ICON_HINTS) if (re.test(i)) return k;
  return undefined;
}

function parseAttrs(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  const re = /([\w-]+)\s*:\s*("([^"]*)"|[^,]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = (m[3] ?? m[2]).trim();
  return out;
}

const DECL_RE = /^([^\[\]{}<>:,]+?)\s*(?:\[([^\]]*)\])?\s*(\{)?\s*$/;
const CONNECTOR_RE = /\s*(<>|-->|>|<)\s*/;

export function parseEraser(code: string): ParseResult {
  const design = emptyDesign('Eraser design');
  const errors: ParseError[] = [];
  const meta = newMeta();
  const nodes = new Map<string, SNode & { _icon?: string }>();
  const byName = new Map<string, string>();
  const edgeIds = new Set<string>();
  const groupStack: string[] = [];

  const resolve = (name: string, attrs: Record<string, string> = {}, declare = false) => {
    const clean = name.trim();
    const key = clean.toLowerCase();
    let id = byName.get(key) ?? slugify(clean);
    let n = nodes.get(id);
    if (!n) {
      n = { id, label: attrs.label ?? clean, kind: 'service', group: groupStack[groupStack.length - 1] };
      nodes.set(id, n);
      byName.set(key, id);
      byName.set(id, id);
      if (attrs.label) byName.set(attrs.label.toLowerCase(), id);
    }
    if (declare) {
      if (attrs.label) { n.label = attrs.label; byName.set(attrs.label.toLowerCase(), id); }
      if (attrs.icon) n._icon = attrs.icon;
      if (!n.group && groupStack.length) n.group = groupStack[groupStack.length - 1];
    }
    return n;
  };

  const lines = code.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith('//')) { readMetaDirective(line.slice(2), meta); return; }
    const title = /^title\s+(.+)$/i.exec(line);
    if (title) { design.name = title[1].trim(); return; }
    if (/^(direction|colorMode|styleMode|typeface)\b/.test(line)) return;
    if (line === '}') {
      if (!groupStack.length) errors.push({ line: lineNo, message: 'Unmatched "}"' });
      groupStack.pop();
      return;
    }

    if (CONNECTOR_RE.test(line) && !/^[^>]*\[[^\]]*>/.test(line)) {
      // connection line, optional ": label" at the end
      let lastOp = -1;
      const opRe = /<>|-->|>|</g;
      let om: RegExpExecArray | null;
      while ((om = opRe.exec(line))) lastOp = om.index + om[0].length;
      const colon = line.indexOf(':', lastOp);
      const body = colon > -1 ? line.slice(0, colon) : line;
      const label = colon > -1 ? line.slice(colon + 1).trim() || undefined : undefined;
      const parts = body.split(CONNECTOR_RE);
      if (parts.length < 3 || parts.length % 2 === 0) { errors.push({ line: lineNo, message: 'Malformed connection' }); return; }
      for (let i = 0; i + 2 < parts.length; i += 2) {
        const op = parts[i + 1];
        const lefts = parts[i].split(',').map((s) => s.trim()).filter(Boolean);
        const rights = parts[i + 2].split(',').map((s) => s.trim()).filter(Boolean);
        if (!lefts.length || !rights.length) { errors.push({ line: lineNo, message: 'Connection is missing a node name' }); return; }
        for (const l of lefts) for (const r of rights) {
          const a = resolve(l), b = resolve(r);
          const pairs: [SNode, SNode][] = op === '<' ? [[b, a]] : op === '<>' ? [[a, b], [b, a]] : [[a, b]];
          for (const [s, t] of pairs) {
            const e: SEdge = { id: edgeId(s.id, t.id, edgeIds), source: s.id, target: t.id, sync: op !== '-->', callsPerRequest: 1 };
            if (label && i + 2 === parts.length - 1) e.label = label;
            design.edges.push(e);
          }
        }
      }
      return;
    }

    const m = DECL_RE.exec(line);
    if (!m) { errors.push({ line: lineNo, message: `Could not parse: ${line}` }); return; }
    const name = m[1].trim();
    const attrs = parseAttrs(m[2]);
    if (m[3]) {
      const id = slugify(name);
      if (!design.groups.find((g) => g.id === id)) design.groups.push({ id, label: attrs.label ?? name });
      groupStack.push(id);
    } else {
      resolve(name, attrs, true);
    }
  });
  if (groupStack.length) errors.push({ line: lines.length, message: `Unclosed group "${groupStack[groupStack.length - 1]}"` });

  for (const n of nodes.values()) {
    n.kind = inferKind(`${n.label} ${n._icon ?? ''}`, kindFromIcon(n._icon));
    if (n._icon && kindFromIcon(n._icon) && inferKind(n.label, undefined) === 'service') {
      n.kind = kindFromIcon(n._icon)!;
    }
    delete n._icon;
    applyNodeMeta(n, meta.nodes.get(n.id));
    design.nodes.push(n);
  }
  for (const e of design.edges) applyEdgeMeta(e, meta.edges.get(`${e.source} ${e.target}`));
  design.scenario = applyScenarioMeta(design.scenario, meta.scenario);
  return { design, errors };
}

export function emitEraser(d: Design): string {
  const out: string[] = [`title ${d.name}`, `// ${scenarioMetaLine(d.scenario)}`, ''];
  const labelCount = new Map<string, number>();
  for (const n of d.nodes) labelCount.set(n.label.toLowerCase(), (labelCount.get(n.label.toLowerCase()) ?? 0) + 1);
  const safe = (s: string) => !/[\[\]{}<>:,]/.test(s) && !s.includes('-->');
  const nameOf = new Map<string, string>();
  for (const n of d.nodes) {
    const useLabel = safe(n.label) && slugify(n.label) === n.id && labelCount.get(n.label.toLowerCase()) === 1;
    nameOf.set(n.id, useLabel ? n.label : n.id);
  }
  const decl = (n: SNode) => {
    const attrs = [`icon: ${KIND_ICON[n.kind]}`];
    if (nameOf.get(n.id) !== n.label) attrs.push(`label: "${n.label.replace(/"/g, "'")}"`);
    return `${nameOf.get(n.id)} [${attrs.join(', ')}]`;
  };
  for (const n of d.nodes.filter((n) => !n.group || !d.groups.find((g) => g.id === n.group))) out.push(decl(n));
  for (const g of d.groups) {
    const gname = slugify(g.label) === g.id && safe(g.label) ? g.label : g.id;
    out.push(`${gname}${gname !== g.label ? ` [label: "${g.label}"]` : ''} {`);
    for (const n of d.nodes.filter((n) => n.group === g.id)) out.push(`  ${decl(n)}`);
    out.push('}');
  }
  out.push('');
  for (const e of d.edges) {
    const op = e.sync ? '>' : '-->';
    out.push(`${nameOf.get(e.source) ?? e.source} ${op} ${nameOf.get(e.target) ?? e.target}${e.label ? `: ${e.label}` : ''}`);
  }
  const metaLines: string[] = [];
  for (const n of d.nodes) {
    // kind is re-inferred from label + icon on parse; record kind only when that would differ
    const iconKind = kindFromIcon(KIND_ICON[n.kind]);
    let inferred = inferKind(`${n.label} ${KIND_ICON[n.kind]}`, iconKind);
    if (iconKind && inferKind(n.label, undefined) === 'service') inferred = iconKind;
    const l = nodeMetaLine(n, inferred);
    if (l) metaLines.push(l);
  }
  for (const e of d.edges) { const l = edgeMetaLine(e); if (l) metaLines.push(l); }
  if (metaLines.length) {
    out.push('', '// --- Stratum metadata (performance profiles) ---');
    for (const l of metaLines) out.push(`// ${l}`);
  }
  return out.join('\n') + '\n';
}
