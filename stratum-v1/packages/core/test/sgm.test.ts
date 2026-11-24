import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERF, NODE_KINDS, cloneDesign, edgeId, emptyDesign,
  inferKind, perfOf, slugify, validateDesign, type Design,
} from '../src';

describe('Stratum Graph Model', () => {
  it('creates an empty design with conservative defaults', () => {
    expect(emptyDesign()).toEqual({
      name: 'Untitled design', nodes: [], edges: [], groups: [], scenario: { rps: 1000, sloP99Ms: 300 },
    });
    expect(emptyDesign('Checkout').name).toBe('Checkout');
  });

  it('defines a usable default profile for every node kind', () => {
    for (const kind of NODE_KINDS) {
      const p = DEFAULT_PERF[kind];
      expect(p.instances, kind).toBeGreaterThan(0);
      expect(p.concurrency, kind).toBeGreaterThan(0);
      expect(p.serviceTimeMs, kind).toBeGreaterThanOrEqual(0);
    }
  });

  it('merges per-node overrides without mutating the shared defaults', () => {
    const node = { id: 'api', label: 'API', kind: 'service' as const, perf: { instances: 7, hitRatio: 0.4 } };
    expect(perfOf(node)).toMatchObject({ ...DEFAULT_PERF.service, instances: 7, hitRatio: 0.4 });
    expect(DEFAULT_PERF.service.instances).toBe(3);
    expect(perfOf({ id: 'db', label: 'DB', kind: 'database' })).toEqual(DEFAULT_PERF.database);
  });

  it.each([
    ['Browser', 'client'],
    ['Redis Cache', 'cache'],
    ['Kafka events', 'stream'],
    ['S3 Bucket', 'storage'],
    ['PostgreSQL', 'database'],
    ['Stripe', 'external'],
    ['Lambda worker', 'function'],
    ['API Gateway', 'gateway'],
    ['Nginx', 'load_balancer'],
    ['Elasticsearch', 'search'],
  ])('infers %s as %s', (label, kind) => {
    expect(inferKind(label)).toBe(kind);
  });

  it('uses the shape hint and falls back to a generic service', () => {
    expect(inferKind('mystery', 'queue')).toBe('queue');
    expect(inferKind('mystery')).toBe('service');
  });

  it('slugifies labels and falls back for empty input', () => {
    expect(slugify('  Order API  ')).toBe('order_api');
    expect(slugify('a/b?c')).toBe('a_b_c');
    expect(slugify('!!')).toBe('node');
  });

  it('generates unique edge ids for repeated source and target pairs', () => {
    const ids = new Set<string>();
    expect(edgeId('a', 'b', ids)).toBe('a__b');
    expect(edgeId('a', 'b', ids)).toBe('a__b_2');
    expect(edgeId('a', 'b', ids)).toBe('a__b_3');
    expect([...ids]).toEqual(['a__b', 'a__b_2', 'a__b_3']);
  });

  it('reports duplicate ids, dangling edges and negative fan-out', () => {
    const d: Design = {
      name: 'bad', groups: [], scenario: { rps: 10 },
      nodes: [
        { id: 'a', label: 'A', kind: 'service' },
        { id: 'a', label: 'again', kind: 'service' },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'ghost', sync: true, callsPerRequest: 1 },
        { id: 'e2', source: 'ghost', target: 'a', sync: true, callsPerRequest: -1 },
      ],
    };
    const messages = validateDesign(d).map((i) => i.message);
    expect(messages.some((m) => m.includes('Duplicate node id'))).toBe(true);
    expect(messages.some((m) => m.includes('missing source'))).toBe(true);
    expect(messages.some((m) => m.includes('missing target'))).toBe(true);
    expect(messages.some((m) => m.includes('negative callsPerRequest'))).toBe(true);
  });

  it('clones deeply so callers cannot mutate the source design', () => {
    const d = emptyDesign('orig');
    d.nodes.push({ id: 'a', label: 'A', kind: 'service', perf: { instances: 2 } });
    const copy = cloneDesign(d);
    copy.nodes[0].perf!.instances = 9;
    copy.name = 'copy';
    expect(d.name).toBe('orig');
    expect(d.nodes[0].perf!.instances).toBe(2);
  });
});
