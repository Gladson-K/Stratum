import { describe, expect, it } from 'vitest';
import { autoLayout, loadTemplate, parseMermaid, preservePositions } from '../src';

const design = (source: string) => parseMermaid(source).design;

describe('layout', () => {
  it('places nodes in dependency layers with configurable spacing', () => {
    const d = autoLayout(design('flowchart LR\n  a([Client]) --> b[API] --> c[(Postgres)]'), { dx: 100, dy: 50 });
    const pos = Object.fromEntries(d.nodes.map((n) => [n.id, n.position!]));
    expect(pos.a.x).toBe(0);
    expect(pos.b.x).toBe(100);
    expect(pos.c.x).toBe(200);
    expect(pos.a.y).toBe(pos.b.y);
  });

  it('preserves existing positions unless force is set', () => {
    const d = design('flowchart LR\n  a[API] --> b[DB]');
    d.nodes[0].position = { x: 7, y: 9 };
    expect(autoLayout(d).nodes[0].position).toEqual({ x: 7, y: 9 });
    expect(autoLayout(d, { force: true }).nodes[0].position).not.toEqual({ x: 7, y: 9 });
  });

  it('copies positions from a previous design by node id', () => {
    const prev = autoLayout(design('flowchart LR\n  a[API] --> b[DB]'));
    const next = design('flowchart LR\n  b[DB v2] --> c[Worker]');
    const merged = preservePositions(next, prev);
    expect(merged.nodes.find((n) => n.id === 'b')!.position).toEqual(prev.nodes.find((n) => n.id === 'b')!.position);
    expect(merged.nodes.find((n) => n.id === 'c')!.position).toBeDefined();
    expect(preservePositions(next, null).nodes.every((n) => n.position)).toBe(true);
  });

  it('lays out cyclic graphs without hanging or duplicating nodes', () => {
    const d = design(`flowchart LR
  a[API] --> b[Worker]
  b --> a`);
    const out = autoLayout(d);
    expect(out.nodes).toHaveLength(2);
    expect(out.nodes.every((n) => n.position && Number.isFinite(n.position.x))).toBe(true);
  });

  it('lays out built-in templates deterministically', () => {
    const t = loadTemplate('chat-app');
    expect(autoLayout(t, { force: true }).nodes).toEqual(autoLayout(t, { force: true }).nodes);
  });
});
