import { describe, expect, it } from 'vitest';
import { emit, emitEraser, emitMermaid, loadTemplate, parse, parseEraser, parseMermaid } from '../src';

describe('diagram-as-code', () => {
  it('dispatches parse and emit by dialect', () => {
    const { design, errors } = parse('flowchart LR\n  a([Client]) --> b[API]', 'mermaid');
    expect(errors).toEqual([]);
    expect(emit(design, 'mermaid')).toContain('flowchart LR');
    const eraser = parse(emitEraser(design), 'eraser');
    expect(eraser.errors).toEqual([]);
    expect(eraser.design.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('round-trips node, edge and scenario metadata', () => {
    const source = `flowchart TD
  %% @scenario rps=4200 sloP99Ms=180 entry=client
  client([Client]) --> api[API]
  api --> db[(Postgres)]
  %% @node api kind=service tech="Go 1.23" instances=6 concurrency=200 serviceTimeMs=4 prop.pii=true
  %% @edge api db calls=2 latencyMs=0.3`;
    const { design, errors } = parseMermaid(source);
    expect(errors).toEqual([]);
    expect(design.scenario).toEqual({ rps: 4200, sloP99Ms: 180, entry: ['client'] });
    const api = design.nodes.find((n) => n.id === 'api')!;
    expect(api).toMatchObject({
      kind: 'service', tech: 'Go 1.23',
      perf: { instances: 6, concurrency: 200, serviceTimeMs: 4 },
      props: { pii: true },
    });
    const edge = design.edges.find((e) => e.source === 'api' && e.target === 'db')!;
    expect(edge).toMatchObject({ callsPerRequest: 2, latencyMs: 0.3 });

    const round = parseMermaid(emitMermaid(design, 'TD'));
    expect(round.errors).toEqual([]);
    expect(round.design.scenario).toEqual(design.scenario);
    expect(round.design.nodes.find((n) => n.id === 'api')).toMatchObject(api);
    expect(round.design.edges.find((e) => e.source === 'api' && e.target === 'db')).toMatchObject(edge);
  });

  it('warns on a missing header and errors on an unmatched end', () => {
    const result = parseMermaid('a[API]\nend');
    expect(result.errors.some((e) => e.severity === 'warning' && /header/.test(e.message))).toBe(true);
    expect(result.errors.some((e) => /without matching subgraph/.test(e.message))).toBe(true);
  });

  it('keeps repeated edges distinct and marks dashed edges async', () => {
    const { design, errors } = parseMermaid(`flowchart LR
  a[API] --> b[DB]
  a --> b
  a -.-> c[[Events]]`);
    expect(errors).toEqual([]);
    expect(design.edges.map((e) => e.id)).toEqual(['a__b', 'a__b_2', 'a__c']);
    expect(design.edges[2].sync).toBe(false);
    expect(design.nodes.find((n) => n.id === 'b')?.kind).toBe('database');
    expect(design.nodes.find((n) => n.id === 'c')?.kind).toBe('stream');
  });

  it('parses Eraser bidirectional, reverse, fan-in and group declarations', () => {
    const { design, errors } = parseEraser(`title Orders
  // @scenario rps=900 sloP99Ms=200 entry=web
  Web [icon: browser]
  Data {
    Orders DB [icon: postgres]
    Cache [icon: redis]
  }
  Web > Orders API: place
  Orders API <> Cache
  Orders API < Worker
  Web, Mobile > Orders API`);
    expect(errors).toEqual([]);
    expect(design.name).toBe('Orders');
    expect(design.scenario.rps).toBe(900);
    expect(design.nodes.find((n) => n.id === 'orders_api')).toBeTruthy();
    expect(design.nodes.find((n) => n.id === 'orders_db')).toMatchObject({ kind: 'database', group: 'data' });
    expect(design.nodes.find((n) => n.id === 'cache')).toMatchObject({ kind: 'cache', group: 'data' });
    expect(design.edges.some((e) => e.source === 'worker' && e.target === 'orders_api')).toBe(true);
    expect(design.edges.some((e) => e.source === 'orders_api' && e.target === 'cache')).toBe(true);
    expect(design.edges.some((e) => e.source === 'cache' && e.target === 'orders_api')).toBe(true);
    expect(design.edges.filter((e) => e.target === 'orders_api' && e.source === 'web')).toHaveLength(2);
    expect(design.edges.find((e) => e.target === 'orders_api' && e.label === 'place')).toBeTruthy();
  });

  it('reports malformed Eraser groups and connections', () => {
    const result = parseEraser('Data {\n  DB [icon: postgres]\nWeb >');
    expect(result.errors.some((e) => /Unclosed group/.test(e.message))).toBe(true);
    expect(result.errors.some((e) => /missing a node name/.test(e.message))).toBe(true);
  });

  it('round-trips every built-in template through both dialects', () => {
    for (const id of ['url-shortener', 'notification-service', 'ecommerce-checkout', 'chat-app']) {
      const design = loadTemplate(id);
      for (const dialect of ['mermaid', 'eraser'] as const) {
        const again = parse(emit(design, dialect), dialect);
        expect(again.errors.filter((e) => e.severity !== 'warning'), `${id}/${dialect}`).toEqual([]);
        expect(again.design.nodes, `${id}/${dialect}`).toHaveLength(design.nodes.length);
        expect(again.design.edges, `${id}/${dialect}`).toHaveLength(design.edges.length);
      }
    }
  });
});
