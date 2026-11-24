import {
  emptyDesign, inferKind, slugify, edgeId,
  type Design, type NodeKind, type SEdge, type SNode,
} from '../sgm';
import {
  newMeta, readMetaDirective, applyNodeMeta, applyEdgeMeta, applyScenarioMeta,
  nodeMetaLine, edgeMetaLine, scenarioMetaLine,
} from './meta';
import type { ParseResult, ParseError } from './types';

/**
 * Mermaid flowchart dialect (flowchart / graph). Supports:
 *  - node shapes: [rect] (round) ([stadium]) [(cylinder)] [[subroutine]] ((circle)) [/parallelogram/] {rhombus}
 *  - edges: -->  ---  ==>  -.->  -.-  with |label| or "-- label -->" / "-. label .->"
 *  - chains (a --> b --> c) and fan-out with & (a & b --> c)
 *  - subgraph <id>[label] ... end
 *  - Stratum metadata in comments: %% @node / @edge / @scenario
 */

const SHAPES: { open: string; close: string; hint?: NodeKind }[] = [
  { open: '([', close: '])', hint: 'client' },
  { open: '[(', close: ')]', hint: 'database' },
  { open: '[[', close: ']]', hint: 'queue' },
  { open: '((', close: '))', hint: 'external' },
  { open: '[/', close: '/]', hint: 'storage' },
  { open: '{{', close: '}}', hint: 'gateway' },
  { open: '[', close: ']' },
  { open: '(', close: ')' },
  { open: '{', close: '}' },
];

const KIND_SHAPE: Partial<Record<NodeKind, [string, string]>> = {
  client: ['([', '])'],
  database: ['[(', ')]'],
  cache: ['[(', ')]'],
  queue: ['[[', ']]'],
  stream: ['[[', ']]'],
  external: ['((', '))'],
  storage: ['[/', '/]'],
  gateway: ['{{', '}}'],
};

const EDGE_RE = /^\s*(?:(-\.\s+([^.]+?)\s+\.->)|(--\s+([^-]+?)\s+-->)|(==\s+([^=]+?)\s+==>)|(-\.->|-\.-|-->|---|==>|--o|--x))\s*(?:\|([^|]*)\|)?\s*/;

interface NodeRef { id: string; label?: string; hint?: NodeKind; explicit: boolean }

function stripQuotes(s: string) {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"')) ? t.slice(1, -1) : t;
}

function readNode(src: string, i: number): { ref: NodeRef; next: number } | null {
  const m = /^\s*([A-Za-z0-9_]+)/.exec(src.slice(i));
  if (!m) return null;
  let pos = i + m[0].length;
  const id = m[1];
  for (const shape of SHAPES) {
    if (src.startsWith(shape.open, pos)) {
      const end = src.indexOf(shape.close, pos + shape.open.length);
      if (end === -1) continue;
      const label = stripQuotes(src.slice(pos + shape.open.length, end));
      pos = end + shape.close.length;
      const cls = /^:::[\w-]+/.exec(src.slice(pos));
      if (cls) pos += cls[0].length;
      return { ref: { id, label, hint: shape.hint, explicit: true }, next: pos };
    }
  }
  const cls = /^:::[\w-]+/.exec(src.slice(pos));
  if (cls) pos += cls[0].length;
  return { ref: { id, explicit: false }, next: pos };
}

function readNodeGroup(src: string, i: number): { refs: NodeRef[]; next: number } | null {
  const refs: NodeRef[] = [];
  let pos = i;
  for (;;) {
    const r = readNode(src, pos);
    if (!r) return refs.length ? { refs, next: pos } : null;
    refs.push(r.ref);
    pos = r.next;
    const amp = /^\s*&\s*/.exec(src.slice(pos));
    if (!amp) break;
    pos += amp[0].length;
  }
  return { refs, next: pos };
}

export function parseMermaid(code: string): ParseResult {
  const design = emptyDesign('Mermaid design');
  const errors: ParseError[] = [];
  const meta = newMeta();
  const nodes = new Map<string, SNode & { _hint?: NodeKind }>();
  const edgeIds = new Set<string>();
  const groupStack: string[] = [];
  let sawHeader = false;

  const upsert = (ref: NodeRef) => {
    const existing = nodes.get(ref.id);
    if (existing) {
      if (ref.explicit && ref.label) { existing.label = ref.label; existing._hint = ref.hint; }
      if (!existing.group && groupStack.length) existing.group = groupStack[groupStack.length - 1];
      return existing;
    }
    const n: SNode & { _hint?: NodeKind } = {
      id: ref.id,
      label: ref.label ?? ref.id,
      kind: 'service',
      _hint: ref.hint,
      group: groupStack[groupStack.length - 1],
    };
    nodes.set(ref.id, n);
    return n;
  };

  const lines = code.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    let line = raw.trim();
    if (!line) return;
    if (line.startsWith('%%')) {
      readMetaDirective(line.slice(2), meta);
      return;
    }
    line = line.replace(/;\s*$/, '');
    if (/^(flowchart|graph)\b/i.test(line)) { sawHeader = true; return; }
    if (/^(classDef|class|style|linkStyle|click|direction)\b/.test(line)) return;
    const sg = /^subgraph\s+(.+)$/.exec(line);
    if (sg) {
      const body = sg[1].trim();
      const m = /^([A-Za-z0-9_\-]+)\s*\[(.+)\]$/.exec(body);
      const id = m ? m[1] : slugify(stripQuotes(body));
      const label = m ? stripQuotes(m[2]) : stripQuotes(body);
      if (!design.groups.find((g) => g.id === id)) design.groups.push({ id, label });
      groupStack.push(id);
      return;
    }
    if (line === 'end') {
      if (!groupStack.length) errors.push({ line: lineNo, message: '"end" without matching subgraph' });
      groupStack.pop();
      return;
    }

    let pos = 0;
    const first = readNodeGroup(line, pos);
    if (!first) { errors.push({ line: lineNo, message: `Could not parse: ${raw.trim()}` }); return; }
    let left = first.refs.map(upsert);
    pos = first.next;
    while (pos < line.length) {
      const rest = line.slice(pos);
      if (!rest.trim()) break;
      const em = EDGE_RE.exec(rest);
      if (!em) { errors.push({ line: lineNo, message: `Expected an arrow near "${rest.trim().slice(0, 20)}"` }); return; }
      const dotted = !!em[1] || (em[7] ?? '').startsWith('-.');
      const label = (em[8] ?? em[2] ?? em[4] ?? em[6])?.trim();
      pos += em[0].length;
      const right = readNodeGroup(line, pos);
      if (!right) { errors.push({ line: lineNo, message: 'Arrow is missing a target node' }); return; }
      const rightNodes = right.refs.map(upsert);
      for (const s of left) for (const t of rightNodes) {
        const e: SEdge = {
          id: edgeId(s.id, t.id, edgeIds), source: s.id, target: t.id,
          sync: !dotted, callsPerRequest: 1,
        };
        if (label) e.label = stripQuotes(label);
        design.edges.push(e);
      }
      left = rightNodes;
      pos = right.next;
    }
  });

  if (groupStack.length) errors.push({ line: lines.length, message: `Unclosed subgraph "${groupStack[groupStack.length - 1]}"` });
  if (!sawHeader && code.trim()) errors.push({ line: 1, message: 'Missing "flowchart LR" (or "graph TD") header', severity: 'warning' });

  for (const n of nodes.values()) {
    n.kind = inferKind(`${n.label} ${n.id}`, n._hint);
    delete n._hint;
    applyNodeMeta(n, meta.nodes.get(n.id));
    design.nodes.push(n);
  }
  for (const e of design.edges) applyEdgeMeta(e, meta.edges.get(`${e.source} ${e.target}`));
  design.scenario = applyScenarioMeta(design.scenario, meta.scenario);
  return { design, errors };
}

function mermaidLabel(label: string) {
  return /[()[\]{}|"<>]/.test(label) ? `"${label.replace(/"/g, "'")}"` : label;
}

function shapeHint(kind: NodeKind): NodeKind | undefined {
  const s = KIND_SHAPE[kind];
  if (!s) return undefined;
  return SHAPES.find((x) => x.open === s[0])?.hint;
}

export function emitMermaid(d: Design, direction: 'LR' | 'TD' = 'LR'): string {
  const out: string[] = [`flowchart ${direction}`];
  out.push(`    %% ${scenarioMetaLine(d.scenario)}`);
  const nodeDecl = (n: SNode) => {
    const [o, c] = KIND_SHAPE[n.kind] ?? ['[', ']'];
    return `${n.id}${o}${mermaidLabel(n.label)}${c}`;
  };
  const grouped = new Map<string, SNode[]>();
  const ungrouped: SNode[] = [];
  for (const n of d.nodes) {
    if (n.group && d.groups.find((g) => g.id === n.group)) {
      grouped.set(n.group, [...(grouped.get(n.group) ?? []), n]);
    } else ungrouped.push(n);
  }
  for (const n of ungrouped) out.push(`    ${nodeDecl(n)}`);
  for (const g of d.groups) {
    const members = grouped.get(g.id) ?? [];
    out.push(`    subgraph ${g.id}[${mermaidLabel(g.label)}]`);
    for (const n of members) out.push(`        ${nodeDecl(n)}`);
    out.push('    end');
  }
  for (const e of d.edges) {
    const arrow = e.sync ? '-->' : '-.->';
    const label = e.label ? `|${mermaidLabel(e.label)}|` : '';
    out.push(`    ${e.source} ${arrow}${label} ${e.target}`);
  }
  const metaLines: string[] = [];
  for (const n of d.nodes) {
    const inferred = inferKind(`${n.label} ${n.id}`, shapeHint(n.kind));
    const l = nodeMetaLine(n, inferred);
    if (l) metaLines.push(l);
  }
  for (const e of d.edges) {
    const l = edgeMetaLine(e);
    if (l) metaLines.push(l);
  }
  if (metaLines.length) {
    out.push('    %% --- Stratum metadata (performance profiles) ---');
    for (const l of metaLines) out.push(`    %% ${l}`);
  }
  return out.join('\n') + '\n';
}
