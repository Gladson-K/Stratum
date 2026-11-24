import { describe, expect, it } from 'vitest';
import { generateFromPrompt, simulate, validateDesign } from '../src';

describe('offline prompt-to-design', () => {
  it('parses plain, suffixed and per-day traffic rates', () => {
    expect(generateFromPrompt('service 500 rps').design.scenario.rps).toBe(500);
    expect(generateFromPrompt('chat app, 20k rps').design.scenario.rps).toBe(20000);
    expect(generateFromPrompt('ingest 3 million events per day').design.scenario.rps).toBeGreaterThan(0);
    expect(generateFromPrompt('no traffic mentioned').design.scenario.rps).toBe(1000);
  });

  it('adds capability-specific components and states assumptions', () => {
    const { design, assumptions } = generateFromPrompt('video chat app with search billing and push notifications at 10k rps');
    expect(design.nodes.map((n) => n.id)).toEqual(expect.arrayContaining([
      'cdn', 'ws', 'search', 'payments', 'psp', 'events', 'notifier', 'provider', 'fanout',
    ]));
    expect(assumptions.some((a) => /Peak load 10,000 RPS/.test(a))).toBe(true);
    expect(assumptions.some((a) => /payment/i.test(a))).toBe(true);
    expect(design.scenario.entry).toEqual(['client']);
    expect(validateDesign(design)).toEqual([]);
  });

  it('produces a simulatable, deterministic design', () => {
    const a = generateFromPrompt('read-heavy url shortener 50k rps');
    const b = generateFromPrompt('read-heavy url shortener 50k rps');
    expect(a.design).toEqual(b.design);
    expect(a.assumptions).toEqual(b.assumptions);
    expect(simulate(a.design).latency).not.toBeNull();
  });

  it('handles an empty prompt safely', () => {
    const { design } = generateFromPrompt('   ');
    expect(design.name).toBe('   ');
    expect(design.nodes.length).toBeGreaterThan(0);
    expect(validateDesign(design)).toEqual([]);
  });
});
