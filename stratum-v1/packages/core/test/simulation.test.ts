import { describe, expect, it } from 'vitest';
import { entryNodes, loadCurve, loadTemplate, parseMermaid, simulate } from '../src';

const design = (source: string) => parseMermaid(source).design;

describe('simulator internals', () => {
  it('uses declared entries, filters unknown ids and falls back to client roots', () => {
    const d = design(`flowchart LR
  %% @scenario rps=100 entry=ghost,api
  c([Client]) --> api[API]
  api --> db[(Postgres)]`);
    expect(entryNodes(d)).toEqual(['api']);
    expect(entryNodes({ ...d, scenario: { rps: 100 } })).toEqual(['c']);
  });

  it('derives maxRps, safeRps, SLO and unit cost', () => {
    const d = design(`flowchart LR
  %% @scenario rps=500 entry=c
  c([Client]) --> s[Service]
  %% @node s instances=2 concurrency=10 serviceTimeMs=10`);
    const r = simulate(d);
    expect(r.nodes.s.capacityRps).toBeCloseTo(2000);
    expect(r.maxRps).toBeCloseTo(2000);
    expect(r.safeRps).toBeCloseTo(1600);
    expect(r.bottleneck?.id).toBe('s');
    expect(r.slo).toEqual({ targetP99Ms: 300, pass: r.latency!.p99 <= 300 });
    expect(r.costPerMillionRequests).toBeGreaterThan(0);
  });

  it('propagates multi-hop fan-out and cache misses', () => {
    const d = design(`flowchart LR
  %% @scenario rps=100 entry=c
  c([Client]) --> api[API]
  api --> cache[(Redis)]
  api --> db[(Postgres)]
  api --> a[Service A]
  a --> b[Service B]
  %% @node cache hitRatio=0.8
  %% @edge api a calls=2
  %% @edge a b calls=3`);
    const r = simulate(d);
    expect(r.nodes.cache.lambda).toBeCloseTo(100);
    expect(r.nodes.db.lambda).toBeCloseTo(20);
    expect(r.nodes.a.lambda).toBeCloseTo(200);
    expect(r.nodes.b.lambda).toBeCloseTo(600);
  });

  it('warns about cycles and ignores back-edges for load propagation', () => {
    const d = design(`flowchart LR
  %% @scenario rps=100 entry=a
  a[API] --> b[Worker]
  b --> a`);
    const r = simulate(d);
    expect(r.warnings.some((w) => /Cycle detected/.test(w))).toBe(true);
    expect(r.nodes.a.lambda).toBeCloseTo(100);
    expect(r.nodes.b.lambda).toBeCloseTo(100);
  });

  it('reports async backlog but keeps synchronous latency finite', () => {
    const d = design(`flowchart LR
  %% @scenario rps=1000 entry=c
  c([Client]) --> api[API]
  api -.-> slow[Worker]
  %% @node slow instances=1 concurrency=1 serviceTimeMs=100`);
    const r = simulate(d);
    expect(r.nodes.slow.saturated).toBe(true);
    expect(r.warnings.some((w) => /cannot keep up/.test(w))).toBe(true);
    expect(r.latency).not.toBeNull();
  });

  it('makes latency unbounded when a synchronous component saturates', () => {
    const d = design(`flowchart LR
  %% @scenario rps=5000 entry=c
  c([Client]) --> s[Service]
  %% @node s instances=1 concurrency=10 serviceTimeMs=10`);
    const r = simulate(d);
    expect(r.latency).toBeNull();
    expect(r.slo!.pass).toBe(false);
    expect(r.warnings.some((w) => /unbounded/.test(w))).toBe(true);
  });

  it('is deterministic per seed and varies with another seed', () => {
    const d = loadTemplate('url-shortener');
    const a = simulate(d, { samples: 300, seed: 1 }).latency;
    const b = simulate(d, { samples: 300, seed: 1 }).latency;
    const c = simulate(d, { samples: 300, seed: 2 }).latency;
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
  });

  it('builds a load curve with rising utilization', () => {
    const d = loadTemplate('url-shortener');
    const curve = loadCurve(d, [0.25, 1, 2]);
    expect(curve.map((p) => p.multiplier)).toEqual([0.25, 1, 2]);
    expect(curve[0].maxUtilization).toBeLessThan(curve[1].maxUtilization);
    expect(curve[1].maxUtilization).toBeLessThan(curve[2].maxUtilization);
    expect(curve.every((p) => p.rps === d.scenario.rps * p.multiplier)).toBe(true);
  });

  it('handles an empty design without throwing', () => {
    const r = simulate({ name: 'empty', nodes: [], edges: [], groups: [], scenario: { rps: 100 } });
    expect(r.entry).toEqual([]);
    expect(r.latency).toBeNull();
    expect(r.bottleneck).toBeNull();
    expect(r.maxRps).toBe(Infinity);
  });
});
