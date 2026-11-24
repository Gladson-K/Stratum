import { describe, expect, it } from 'vitest';
import { buildCritiquePrompt, loadTemplate, parseLlmFindings, simulate } from '../src';

describe('LLM reviewer guardrails', () => {
  const design = loadTemplate('url-shortener');

  it('builds a prompt with the design and simulation summary', () => {
    const sim = simulate(design);
    const { system, user } = buildCritiquePrompt(design, sim);
    expect(system).toMatch(/Return ONLY JSON/);
    expect(system).toMatch(/reference only node ids/);
    expect(user).toContain('flowchart LR');
    expect(user).toContain(`Simulation at ${sim.rps} RPS`);
    expect(user).toContain('p99 latency:');
  });

  it('drops ungrounded targets and keeps grounded findings', () => {
    const raw = '```json\n{"findings":[{"title":"hot api","severity":"critical","category":"scalability","targets":["api","ghost"],"explanation":"load","suggestion":"scale"}]}\n```';
    const findings = parseLlmFindings(raw, design);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      agent: 'llm', severity: 'critical', category: 'scalability', targets: ['api'], key: 'llm:0:api',
    });
  });

  it('caps findings at six and applies safe defaults', () => {
    const findings = Array.from({ length: 9 }, (_, i) => ({
      title: `finding ${i}`, targets: ['api'], severity: 'bogus', category: 'unknown',
    }));
    const parsed = parseLlmFindings(JSON.stringify({ findings }), design);
    expect(parsed).toHaveLength(6);
    expect(parsed[0]).toMatchObject({ severity: 'medium', category: 'reliability', confidence: 0.6, status: 'open' });
  });

  it('returns no findings for malformed, unrelated or unanchored responses', () => {
    expect(parseLlmFindings('not json', design)).toEqual([]);
    expect(parseLlmFindings('{"other":1}', design)).toEqual([]);
    expect(parseLlmFindings('{"findings":[{"title":"no target"}]}', design)).toEqual([]);
  });
});
