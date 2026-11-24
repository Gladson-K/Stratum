import { describe, expect, it } from 'vitest';
import { applyPatch, loadTemplate, type Design } from '../src';

const base = (): Design => ({
  name: 'patch', scenario: { rps: 10 }, groups: [],
  nodes: [
    { id: 'a', label: 'A', kind: 'service', perf: { instances: 1 } },
    { id: 'db', label: 'DB', kind: 'database' },
  ],
  edges: [{ id: 'a__db', source: 'a', target: 'db', sync: true, callsPerRequest: 1 }],
});

describe('patch engine', () => {
  it('adds nodes and edges only when ids are unique and endpoints exist', () => {
    const d = base();
    const out = applyPatch(d, [
      { op: 'addNode', node: { id: 'cache', label: 'Cache', kind: 'cache' } },
      { op: 'addNode', node: { id: 'cache', label: 'Duplicate', kind: 'cache' } },
      { op: 'addEdge', edge: { id: 'a__cache', source: 'a', target: 'cache', sync: true, callsPerRequest: 1 } },
      { op: 'addEdge', edge: { id: 'a__ghost', source: 'a', target: 'ghost', sync: true, callsPerRequest: 1 } },
      { op: 'addEdge', edge: { id: 'a__cache', source: 'a', target: 'cache', sync: true, callsPerRequest: 2 } },
    ]);
    expect(out.nodes.map((n) => n.id)).toEqual(['a', 'db', 'cache']);
    expect(out.edges.map((e) => e.id)).toEqual(['a__db', 'a__cache']);
    expect(out.edges[1].callsPerRequest).toBe(1);
    expect(d.nodes).toHaveLength(2);
  });

  it('updates node fields, perf profiles, edges and removals', () => {
    const out = applyPatch(base(), [
      { op: 'updateNode', id: 'a', set: { label: 'Renamed', props: { team: 'core' } } },
      { op: 'updatePerf', id: 'a', perf: { instances: 5, concurrency: 20 } },
      { op: 'updateEdge', id: 'a__db', set: { callsPerRequest: 3, label: 'query' } },
      { op: 'removeEdge', id: 'a__db' },
    ]);
    expect(out.nodes[0]).toMatchObject({
      label: 'Renamed', props: { team: 'core' }, perf: { instances: 5, concurrency: 20 },
    });
    expect(out.edges).toEqual([]);
  });

  it('ignores operations that target missing ids', () => {
    const d = base();
    expect(applyPatch(d, [
      { op: 'removeEdge', id: 'missing' },
      { op: 'updateNode', id: 'missing', set: { label: 'x' } },
      { op: 'updatePerf', id: 'missing', perf: { instances: 9 } },
      { op: 'updateEdge', id: 'missing', set: { label: 'x' } },
    ])).toEqual(d);
  });

  it('applies multi-step patches from a critique finding without mutating the template', () => {
    const d = loadTemplate('notification-service');
    const patched = applyPatch(d, [
      { op: 'addNode', node: { id: 'dlq', label: 'DLQ', kind: 'queue' } },
      { op: 'addEdge', edge: { id: 'queue__dlq', source: 'queue', target: 'dlq', sync: false, callsPerRequest: 0.01 } },
    ]);
    expect(patched.nodes.some((n) => n.id === 'dlq')).toBe(true);
    expect(patched.edges.some((e) => e.id === 'queue__dlq')).toBe(true);
    expect(d.nodes.some((n) => n.id === 'dlq')).toBe(false);
  });
});
