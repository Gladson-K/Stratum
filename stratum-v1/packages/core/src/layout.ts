import type { Design } from './sgm';

/**
 * Lightweight layered (Sugiyama-style) auto-layout:
 *  1. longest-path layering from entry nodes (left → right)
 *  2. barycenter ordering within layers to reduce crossings
 * Existing positions are preserved unless `force` is set.
 */
export function autoLayout(d: Design, opts: { force?: boolean; dx?: number; dy?: number } = {}): Design {
  const dx = opts.dx ?? 240, dy = opts.dy ?? 120;
  const ids = d.nodes.map((n) => n.id);
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of d.edges) {
    if (!preds.has(e.target) || !succs.has(e.source) || e.source === e.target) continue;
    preds.get(e.target)!.push(e.source);
    succs.get(e.source)!.push(e.target);
  }
  // layering with cycle guard
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const L = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const l = Math.max(-1, ...preds.get(id)!.map(L)) + 1;
    visiting.delete(id);
    layer.set(id, l);
    return l;
  };
  ids.forEach(L);
  const layers: string[][] = [];
  for (const id of ids) (layers[layer.get(id)!] ??= []).push(id);
  // barycenter ordering, 4 sweeps
  const order = new Map<string, number>();
  layers.forEach((ls) => ls.forEach((id, i) => order.set(id, i)));
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let li = 1; li < layers.length; li++) {
      const ls = layers[li];
      if (!ls) continue;
      const bc = (id: string) => {
        const p = preds.get(id)!.filter((x) => (layer.get(x) ?? 0) < li);
        return p.length ? p.reduce((s, x) => s + (order.get(x) ?? 0), 0) / p.length : order.get(id)!;
      };
      ls.sort((a, b) => bc(a) - bc(b));
      ls.forEach((id, i) => order.set(id, i));
    }
  }
  const maxRows = Math.max(1, ...layers.map((l) => l?.length ?? 0));
  const nodes = d.nodes.map((n) => {
    if (n.position && !opts.force) return n;
    const li = layer.get(n.id) ?? 0;
    const rows = layers[li]?.length ?? 1;
    const offset = ((maxRows - rows) * dy) / 2;
    return { ...n, position: { x: li * dx, y: offset + (order.get(n.id) ?? 0) * dy } };
  });
  return { ...d, nodes };
}

/** Copy positions from a previous design onto a freshly parsed one (by node id). */
export function preservePositions(next: Design, prev: Design | null | undefined): Design {
  if (!prev) return autoLayout(next);
  const pos = new Map(prev.nodes.filter((n) => n.position).map((n) => [n.id, n.position!]));
  const merged = { ...next, nodes: next.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id) } : n)) };
  return autoLayout(merged);
}
