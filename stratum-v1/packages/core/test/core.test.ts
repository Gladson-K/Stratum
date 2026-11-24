import { describe, expect, it } from 'vitest';
import {
  parseMermaid, emitMermaid, parseEraser, emitEraser, simulate, runCritique,
  applyPatch, loadTemplate, TEMPLATES, generateFromPrompt, parseLlmFindings, validateDesign,
  type Design,
} from '../src';

const strip = (d: Design) => ({
  nodes: d.nodes.map(({ position, ...n }) => n).sort((a, b) => a.id.localeCompare(b.id)),
  edges: d.edges.map(({ id, ...e }) => e).sort((a, b) => `${a.source}${a.target}`.localeCompare(`${b.source}${b.target}`)),
  groups: d.groups,
  scenario: d.scenario,
});

describe('Mermaid dialect', () => {
  it('parses shapes, chains, async edges, labels and subgraphs', () => {
    const { design, errors } = parseMermaid(`flowchart LR
      client([Mobile]) --> lb[Load Balancer] --> api[API]
      subgraph data[Data]
        db[(Postgres)]
      end
      api -->|SQL| db
      api -.-> q[[Kafka events]]
      a & b --> api`);
    expect(errors.filter((e) => e.severity !== 'warning')).toEqual([]);
    const kinds = Object.fromEntries(design.nodes.map((n) => [n.id, n.kind]));
    expect(kinds).toMatchObject({ client: 'client', lb: 'load_balancer', api: 'service', db: 'database', q: 'stream' });
    expect(design.nodes.find((n) => n.id === 'db')?.group).toBe('data');
    expect(design.edges.find((e) => e.target === 'q')?.sync).toBe(false);
    expect(design.edges.find((e) => e.target === 'db')?.label).toBe('SQL');
    expect(design.edges.filter((e) => e.target === 'api').length).toBe(3);
  });

  it('reports line-level errors', () => {
    const { errors } = parseMermaid('flowchart LR\n  a --> \n  subgraph x\n');
    expect(errors.some((e) => e.line === 2)).toBe(true);
    expect(errors.some((e) => /Unclosed/.test(e.message))).toBe(true);
  });

  it('round-trips every template losslessly (including perf metadata)', () => {
    for (const t of TEMPLATES) {
      const a = parseMermaid(t.mermaid).design;
      const b = parseMermaid(emitMermaid(a)).design;
      expect(strip(b)).toEqual(strip(a));
    }
  });
});

describe('Eraser-style dialect', () => {
  it('parses declarations, groups, chains, fan-in, reverse and labels', () => {
    const { design, errors } = parseEraser(`title Checkout
      Client [icon: smartphone]
      Data Tier [color: blue] {
        Orders DB [icon: postgres]
        Sessions [icon: redis]
      }
      Client > API Service > Orders DB: SQL
      API Service > Sessions
      API Service --> Events [icon: kafka]
      Web, Mobile > API Service
      API Service < Auth`);
    expect(errors).toEqual([]);
    expect(design.name).toBe('Checkout');
    const byId = Object.fromEntries(design.nodes.map((n) => [n.id, n]));
    expect(byId.orders_db.kind).toBe('database');
    expect(byId.sessions.kind).toBe('cache');
    expect(byId.orders_db.group).toBe('data_tier');
    expect(design.edges.find((e) => e.target === 'orders_db')?.label).toBe('SQL');
    expect(design.edges.find((e) => e.source === 'auth')?.target).toBe('api_service');
    expect(design.edges.filter((e) => e.target === 'api_service').length).toBe(4);
  });

  it('round-trips Mermaid templates through the Eraser dialect', () => {
    for (const t of TEMPLATES) {
      const a = parseMermaid(t.mermaid).design;
      const code = emitEraser(a);
      const { design: b, errors } = parseEraser(code);
      expect(errors).toEqual([]);
      expect(b.nodes.length).toBe(a.nodes.length);
      expect(b.edges.length).toBe(a.edges.length);
      for (const n of a.nodes) {
        const m = b.nodes.find((x) => x.id === n.id)!;
        expect(m, `node ${n.id} in ${t.id}`).toBeTruthy();
        expect(m.kind).toBe(n.kind);
        expect(m.perf ?? {}).toEqual(n.perf ?? {});
      }
    }
  });
});

describe('Simulation', () => {
  it('computes utilization from M/M/c and finds the bottleneck', () => {
    const { design } = parseMermaid(`flowchart LR
      %% @scenario rps=900 entry=c
      c([Client]) --> s[Service]
      %% @node s instances=1 concurrency=10 serviceTimeMs=10`);
    const r = simulate(design);
    // capacity = 10 servers * 100 req/s = 1000 req/s, rho = 0.9
    expect(r.nodes.s.capacityRps).toBeCloseTo(1000);
    expect(r.nodes.s.utilization).toBeCloseTo(0.9);
    expect(r.bottleneck?.id).toBe('s');
    expect(r.maxRps).toBeCloseTo(1000);
    expect(r.latency!.p99).toBeGreaterThan(r.latency!.p50);
  });

  it('flags saturation and unbounded latency', () => {
    const { design } = parseMermaid(`flowchart LR
      %% @scenario rps=2000 entry=c
      c([Client]) --> s[Service]
      %% @node s instances=1 concurrency=10 serviceTimeMs=10`);
    const r = simulate(design);
    expect(r.nodes.s.saturated).toBe(true);
    expect(r.latency).toBeNull();
  });

  it('applies cache hit ratio to downstream database load and fan-out', () => {
    const { design } = parseMermaid(`flowchart LR
      %% @scenario rps=1000 entry=c
      c([Client]) --> api[API]
      api --> cache[(Redis)]
      api --> db[(Postgres)]
      api --> users[User Service]
      %% @node cache hitRatio=0.9
      %% @edge api users calls=3`);
    const r = simulate(design);
    expect(r.nodes.db.lambda).toBeCloseTo(100);
    expect(r.nodes.users.lambda).toBeCloseTo(3000);
  });

  it('is deterministic for a given seed', () => {
    const d = loadTemplate('url-shortener');
    expect(simulate(d).latency).toEqual(simulate(d).latency);
  });
});

describe('Critique', () => {
  it('finds the deliberate flaws in the notification template', () => {
    const d = loadTemplate('notification-service');
    const report = runCritique(d, { mode: 'deep' });
    const keys = report.findings.map((f) => f.key);
    expect(keys).toContain('spof:prefs');
    expect(keys).toContain('dualwrite:api');
    expect(keys.some((k) => k.startsWith('saturation:email'))).toBe(true);
    expect(report.agentsRun).toContain('devils_advocate');
    expect(report.score).toBeLessThan(100);
    // every finding is anchored to existing ids
    const ids = new Set([...d.nodes.map((n) => n.id), ...d.edges.map((e) => e.id)]);
    for (const f of report.findings) for (const t of f.targets) expect(ids.has(t)).toBe(true);
  });

  it('accepting patches resolves the findings they target', () => {
    let d = loadTemplate('notification-service');
    const before = runCritique(d, { mode: 'deep' });
    for (const f of before.findings) if (f.patch) d = applyPatch(d, f.patch);
    expect(validateDesign(d).filter((i) => i.level === 'error')).toEqual([]);
    const after = runCritique(d, { mode: 'deep' });
    const fixedKeys = before.findings.filter((f) => f.patch).map((f) => f.key);
    for (const k of fixedKeys) expect(after.findings.map((f) => f.key)).not.toContain(k);
    expect(after.score).toBeGreaterThan(before.score);
  });

  it('flags clients talking directly to data stores', () => {
    const { design } = parseMermaid('flowchart LR\n c([Browser]) --> db[(Postgres)]');
    const r = runCritique(design);
    expect(r.findings[0].severity).toBe('critical');
    expect(r.findings[0].category).toBe('security');
  });

  it('dismissed findings are filtered', () => {
    const d = loadTemplate('notification-service');
    const r = runCritique(d, { mode: 'deep', dismissed: ['spof:prefs'] });
    expect(r.findings.map((f) => f.key)).not.toContain('spof:prefs');
  });
});

describe('Generation and LLM validation', () => {
  it('generates a design from a prompt with parsed traffic', () => {
    const { design, assumptions } = generateFromPrompt('A chat app with search handling 20k rps and push notifications');
    expect(design.scenario.rps).toBe(20000);
    expect(design.nodes.some((n) => n.id === 'ws')).toBe(true);
    expect(design.nodes.some((n) => n.kind === 'search')).toBe(true);
    expect(assumptions.length).toBeGreaterThan(0);
    expect(validateDesign(design)).toEqual([]);
    expect(simulate(design).latency).not.toBeNull();
  });

  it('rejects LLM findings that reference unknown nodes', () => {
    const d = loadTemplate('url-shortener');
    const raw = 'Sure! {"findings":[{"title":"ok","severity":"high","category":"cost","targets":["api"]},{"title":"bad","targets":["ghost"]}]}';
    const f = parseLlmFindings(raw, d);
    expect(f.length).toBe(1);
    expect(f[0].targets).toEqual(['api']);
  });
});
