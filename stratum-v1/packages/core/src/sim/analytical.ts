import { perfOf, type Design, type SNode, type SEdge } from '../sgm';

/**
 * Analytical capacity and latency model.
 *
 * Each node is an M/M/c queueing station:
 *   c  = instances * concurrency           (parallel servers)
 *   mu = 1000 / serviceTimeMs              (requests/s per server)
 *   rho = lambda / (c * mu)                (utilization)
 * Waiting probability uses Erlang C, computed through the numerically stable
 * Erlang B recursion so very large c (thousands of workers) is safe.
 *
 * Arrival rates propagate from entry nodes along edges (multiplied by
 * callsPerRequest). When a node calls a cache, its calls to databases/storage
 * are reduced by the cache hit ratio (cache-aside pattern).
 *
 * End-to-end latency percentiles are estimated by Monte Carlo sampling of
 * request paths through the model (sync edges only), using a seeded RNG so
 * results are deterministic.
 */

export interface NodeResult {
  id: string;
  lambda: number;          // arrivals per second
  servers: number;
  utilization: number;     // rho
  saturated: boolean;
  waitProbability: number; // Erlang C
  meanWaitMs: number;
  meanResponseMs: number;  // wait + service at this node only
  capacityRps: number;     // c * mu
  monthlyCost: number;
}

export interface SimulationResult {
  rps: number;
  nodes: Record<string, NodeResult>;
  bottleneck: { id: string; utilization: number } | null;
  /** Maximum entry rps before the first node saturates (rho = 1). */
  maxRps: number;
  /** Entry rps where the first node reaches 80% utilization (recommended ceiling). */
  safeRps: number;
  latency: { p50: number; p95: number; p99: number; mean: number } | null;
  slo: { targetP99Ms: number; pass: boolean } | null;
  monthlyCost: number;
  costPerMillionRequests: number;
  warnings: string[];
  entry: string[];
}

const HOURS_PER_MONTH = 730;
const DATA_KINDS = new Set(['database', 'storage', 'search']);

function erlangC(c: number, a: number): number {
  // a = lambda / mu (offered load in Erlangs). Requires a < c.
  if (a <= 0) return 0;
  if (a >= c) return 1;
  // For huge c relative to a, wait probability is effectively 0.
  let b = 1;
  const limit = Math.min(c, 200_000);
  for (let k = 1; k <= limit; k++) {
    b = (a * b) / (k + a * b);
    if (k > a && b < 1e-15) { b = 0; break; }
  }
  const rho = a / c;
  return b / (1 - rho * (1 - b));
}

export function entryNodes(d: Design): string[] {
  if (d.scenario.entry?.length) return d.scenario.entry.filter((id) => d.nodes.some((n) => n.id === id));
  const incoming = new Set(d.edges.map((e) => e.target));
  const roots = d.nodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
  const clients = roots.filter((id) => d.nodes.find((n) => n.id === id)?.kind === 'client');
  return clients.length ? clients : roots;
}

/** Fraction of calls on edge e that actually happen, after cache hits on sibling edges. */
function edgeFactor(d: Design, e: SEdge, nodeById: Map<string, SNode>): number {
  const target = nodeById.get(e.target);
  if (!target || !DATA_KINDS.has(target.kind)) return 1;
  const siblingCaches = d.edges
    .filter((x) => x.source === e.source && x.sync && nodeById.get(x.target)?.kind === 'cache')
    .map((x) => perfOf(nodeById.get(x.target)!).hitRatio ?? 0.9);
  if (!siblingCaches.length) return 1;
  return siblingCaches.reduce((f, h) => f * (1 - h), 1);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimulateOptions { rps?: number; samples?: number; seed?: number }

export function simulate(d: Design, opts: SimulateOptions = {}): SimulationResult {
  const rps = opts.rps ?? d.scenario.rps;
  const warnings: string[] = [];
  const nodeById = new Map(d.nodes.map((n) => [n.id, n]));
  const outEdges = new Map<string, SEdge[]>();
  for (const e of d.edges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    outEdges.set(e.source, [...(outEdges.get(e.source) ?? []), e]);
  }
  const entry = entryNodes(d);
  if (!entry.length && d.nodes.length) warnings.push('No entry node found (every node has incoming edges). Set scenario.entry.');

  // ---- 1. Propagate arrival rates (DFS with cycle protection) ----
  const lambda = new Map<string, number>(d.nodes.map((n) => [n.id, 0]));
  let cycleWarned = false;
  const push = (id: string, rate: number, stack: Set<string>, depth: number) => {
    if (rate <= 1e-9) return;
    if (stack.has(id)) {
      if (!cycleWarned) { warnings.push(`Cycle detected through "${id}"; back-edges are ignored for load propagation.`); cycleWarned = true; }
      return;
    }
    if (depth > 64) return;
    lambda.set(id, (lambda.get(id) ?? 0) + rate);
    stack.add(id);
    for (const e of outEdges.get(id) ?? []) {
      push(e.target, rate * e.callsPerRequest * edgeFactor(d, e, nodeById), stack, depth + 1);
    }
    stack.delete(id);
  };
  for (const id of entry) push(id, rps, new Set(), 0);

  // ---- 2. Per-node queueing metrics ----
  const results: Record<string, NodeResult> = {};
  let monthlyCost = 0;
  let worst: { id: string; utilization: number } | null = null;
  let minHeadroom = Infinity;
  for (const n of d.nodes) {
    const p = perfOf(n);
    const servers = Math.max(1, p.instances * p.concurrency);
    const s = Math.max(p.serviceTimeMs, 0);
    const lam = lambda.get(n.id) ?? 0;
    const mu = s > 0 ? 1000 / s : Infinity;
    const capacity = servers * mu;
    const rho = s > 0 ? lam / capacity : 0;
    const saturated = rho >= 1;
    const pw = saturated ? 1 : s > 0 ? erlangC(servers, lam / mu) : 0;
    const meanWaitMs = saturated ? Infinity : s > 0 && lam > 0 ? (pw / (capacity - lam)) * 1000 : 0;
    const cost = (p.costPerHour ?? 0) * p.instances * HOURS_PER_MONTH;
    monthlyCost += cost;
    results[n.id] = {
      id: n.id, lambda: lam, servers, utilization: rho, saturated, waitProbability: pw,
      meanWaitMs, meanResponseMs: meanWaitMs + s, capacityRps: capacity, monthlyCost: cost,
    };
    if (lam > 0 && n.kind !== 'client' && Number.isFinite(capacity)) {
      if (!worst || rho > worst.utilization) worst = { id: n.id, utilization: rho };
      minHeadroom = Math.min(minHeadroom, capacity / (lam / rps));
    }
  }
  const maxRps = Number.isFinite(minHeadroom) ? minHeadroom : Infinity;

  // ---- 3. Monte Carlo end-to-end latency over sync paths ----
  let latency: SimulationResult['latency'] = null;
  // Only components on a synchronous path from an entry make request latency unbounded.
  // Saturated async consumers instead accumulate an ever-growing backlog.
  const syncReach = new Set<string>();
  const walk = (id: string) => {
    if (syncReach.has(id)) return;
    syncReach.add(id);
    for (const e of outEdges.get(id) ?? []) if (e.sync) walk(e.target);
  };
  entry.forEach(walk);
  const saturatedIds = Object.values(results).filter((r) => r.saturated && r.lambda > 0).map((r) => r.id);
  const anySaturated = saturatedIds.some((id) => syncReach.has(id));
  const asyncSaturated = saturatedIds.filter((id) => !syncReach.has(id));
  if (asyncSaturated.length) {
    warnings.push(`Async consumer(s) ${asyncSaturated.map((id) => `"${nodeById.get(id)?.label ?? id}"`).join(', ')} cannot keep up; their queue backlog grows without bound at this load.`);
  }
  if (entry.length && !anySaturated) {
    const rand = mulberry32(opts.seed ?? 42);
    const exp = (mean: number) => (mean <= 0 ? 0 : -Math.log(1 - rand()) * mean);
    const sampleNode = (id: string, depth: number, stack: Set<string>): number => {
      if (depth > 32 || stack.has(id)) return 0;
      const n = nodeById.get(id)!;
      const r = results[id];
      const p = perfOf(n);
      let t = exp(p.serviceTimeMs);
      if (r.waitProbability > 0 && rand() < r.waitProbability) {
        const capacity = r.capacityRps;
        t += exp(1000 / Math.max(capacity - r.lambda, 1e-9));
      }
      stack.add(id);
      const edges = (outEdges.get(id) ?? []).filter((e) => e.sync);
      // cache-aside: one hit decision per request at this node
      const caches = edges.filter((e) => nodeById.get(e.target)?.kind === 'cache');
      let hit = false;
      for (const c of caches) {
        const h = perfOf(nodeById.get(c.target)!).hitRatio ?? 0.9;
        if (rand() < h) hit = true;
      }
      for (const e of edges) {
        const tgt = nodeById.get(e.target)!;
        if (hit && DATA_KINDS.has(tgt.kind)) continue;
        const calls = Math.max(0, e.callsPerRequest);
        const whole = Math.floor(calls);
        const n = whole + (rand() < calls - whole ? 1 : 0);
        for (let i = 0; i < n; i++) t += (e.latencyMs ?? 0.5) + sampleNode(e.target, depth + 1, stack);
      }
      stack.delete(id);
      return t;
    };
    const N = opts.samples ?? 4000;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) {
      const start = entry[i % entry.length];
      samples.push(sampleNode(start, 0, new Set()));
    }
    samples.sort((a, b) => a - b);
    const q = (p: number) => samples[Math.min(samples.length - 1, Math.floor(p * samples.length))];
    latency = {
      p50: q(0.5), p95: q(0.95), p99: q(0.99),
      mean: samples.reduce((s, x) => s + x, 0) / samples.length,
    };
  } else if (anySaturated) {
    warnings.push('A component on the synchronous request path is saturated (utilization ≥ 100%); latency is unbounded at this load.');
  }

  const sloTarget = d.scenario.sloP99Ms;
  const slo = sloTarget ? { targetP99Ms: sloTarget, pass: !!latency && latency.p99 <= sloTarget } : null;
  const monthlyRequests = rps * 3600 * HOURS_PER_MONTH;
  return {
    rps,
    nodes: results,
    bottleneck: worst,
    maxRps,
    safeRps: maxRps * 0.8,
    latency,
    slo,
    monthlyCost,
    costPerMillionRequests: monthlyRequests > 0 ? (monthlyCost / monthlyRequests) * 1e6 : 0,
    warnings,
    entry,
  };
}

/** Sweep traffic levels to build a load curve (used by the UI chart). */
export function loadCurve(d: Design, multipliers = [0.25, 0.5, 1, 1.5, 2, 3, 5, 8, 10]) {
  return multipliers.map((m) => {
    const r = simulate(d, { rps: d.scenario.rps * m, samples: 1500 });
    return {
      multiplier: m,
      rps: r.rps,
      p50: r.latency?.p50 ?? null,
      p99: r.latency?.p99 ?? null,
      maxUtilization: r.bottleneck?.utilization ?? 0,
    };
  });
}
