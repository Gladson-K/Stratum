import { NODE_KINDS, type NodeKind, type SEdge, type SNode, type Scenario, type PerfProfile } from '../sgm';

/**
 * Shared metadata syntax used inside comments by both the Mermaid and the
 * Eraser-style dialects, so performance profiles survive a round-trip:
 *
 *   @node api kind=service tech="Go 1.23" instances=6 concurrency=200 serviceTimeMs=4
 *   @edge api cache calls=2 latencyMs=0.3
 *   @scenario rps=5000 sloP99Ms=250 entry=client
 */

export type KV = Record<string, string>;

export function parseKV(text: string): KV {
  const out: KV = {};
  const re = /([A-Za-z_][\w.]*)=("([^"]*)"|[^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out[m[1]] = m[3] !== undefined ? m[3] : m[2];
  return out;
}

function fmtVal(v: string | number | boolean): string {
  const s = String(v);
  return /[\s"]/.test(s) ? `"${s.replace(/"/g, "'")}"` : s;
}

export function formatKV(kv: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(kv)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${fmtVal(v as string | number | boolean)}`)
    .join(' ');
}

const PERF_KEYS: (keyof PerfProfile)[] = ['instances', 'concurrency', 'serviceTimeMs', 'hitRatio', 'costPerHour'];

export interface MetaBag {
  nodes: Map<string, KV>;
  edges: Map<string, KV>; // key: "source target"
  scenario?: KV;
}

export function newMeta(): MetaBag {
  return { nodes: new Map(), edges: new Map() };
}

/** Try to read a metadata directive from comment text (without the comment marker). */
export function readMetaDirective(comment: string, bag: MetaBag): boolean {
  const c = comment.trim();
  let m = /^@node\s+([\w-]+)\s*(.*)$/.exec(c);
  if (m) { bag.nodes.set(m[1], { ...(bag.nodes.get(m[1]) ?? {}), ...parseKV(m[2]) }); return true; }
  m = /^@edge\s+([\w-]+)\s+([\w-]+)\s*(.*)$/.exec(c);
  if (m) { bag.edges.set(`${m[1]} ${m[2]}`, parseKV(m[3])); return true; }
  m = /^@scenario\s*(.*)$/.exec(c);
  if (m) { bag.scenario = parseKV(m[1]); return true; }
  return false;
}

export function applyNodeMeta(node: SNode, kv: KV | undefined) {
  if (!kv) return;
  if (kv.kind && (NODE_KINDS as string[]).includes(kv.kind)) node.kind = kv.kind as NodeKind;
  if (kv.tech) node.tech = kv.tech;
  for (const k of PERF_KEYS) {
    if (kv[k] !== undefined && !Number.isNaN(Number(kv[k]))) {
      node.perf = { ...(node.perf ?? {}), [k]: Number(kv[k]) };
    }
  }
  for (const [k, v] of Object.entries(kv)) {
    if (k.startsWith('prop.')) {
      node.props = node.props ?? {};
      node.props[k.slice(5)] = v === 'true' ? true : v === 'false' ? false : Number.isNaN(Number(v)) ? v : Number(v);
    }
  }
}

export function applyEdgeMeta(edge: SEdge, kv: KV | undefined) {
  if (!kv) return;
  if (kv.calls !== undefined) edge.callsPerRequest = Number(kv.calls);
  if (kv.latencyMs !== undefined) edge.latencyMs = Number(kv.latencyMs);
  if (kv.sync !== undefined) edge.sync = kv.sync !== 'false';
}

export function applyScenarioMeta(s: Scenario, kv: KV | undefined): Scenario {
  if (!kv) return s;
  const out = { ...s };
  if (kv.rps) out.rps = Number(kv.rps);
  if (kv.sloP99Ms) out.sloP99Ms = Number(kv.sloP99Ms);
  if (kv.entry) out.entry = kv.entry.split(',').filter(Boolean);
  return out;
}

export function nodeMetaLine(node: SNode, inferredKind: NodeKind): string | null {
  const kv: Record<string, string | number | boolean | undefined> = {};
  if (node.kind !== inferredKind) kv.kind = node.kind;
  if (node.tech) kv.tech = node.tech;
  for (const k of PERF_KEYS) if (node.perf?.[k] !== undefined) kv[k] = node.perf[k];
  for (const [k, v] of Object.entries(node.props ?? {})) kv[`prop.${k}`] = v;
  const s = formatKV(kv);
  return s ? `@node ${node.id} ${s}` : null;
}

export function edgeMetaLine(edge: SEdge): string | null {
  const kv: Record<string, string | number | undefined> = {};
  if (edge.callsPerRequest !== 1) kv.calls = edge.callsPerRequest;
  if (edge.latencyMs !== undefined) kv.latencyMs = edge.latencyMs;
  const s = formatKV(kv);
  return s ? `@edge ${edge.source} ${edge.target} ${s}` : null;
}

export function scenarioMetaLine(s: Scenario): string {
  return `@scenario ${formatKV({ rps: s.rps, sloP99Ms: s.sloP99Ms, entry: s.entry?.length ? s.entry.join(',') : undefined })}`;
}
