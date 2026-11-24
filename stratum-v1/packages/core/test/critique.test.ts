import { describe, expect, it } from 'vitest';
import { applyPatch, buildContext, loadTemplate, parseMermaid, runCritique, simulate, type Finding } from '../src';

const design = (source: string) => parseMermaid(source).design;

describe('critique orchestration', () => {
  it('runs three reviewers in quick mode and five plus the advocate in deep mode', () => {
    const d = loadTemplate('notification-service');
    const quick = runCritique(d, { mode: 'quick' });
    const deep = runCritique(d, { mode: 'deep' });
    expect(quick.agentsRun).toEqual(['orchestrator', 'scalability', 'reliability', 'security']);
    expect(deep.agentsRun).toContain('consistency');
    expect(deep.agentsRun).toContain('cost');
    expect(deep.agentsRun).toContain('devils_advocate');
    expect(deep.plan.some((p) => /Devil's Advocate contested/.test(p))).toBe(true);
  });

  it('builds adjacency context for the agents', () => {
    const d = design(`flowchart LR
  a[API] --> db[(Postgres)]
  a --> q[[Events]]`);
    const ctx = buildContext(d, simulate(d));
    expect(ctx.byId.get('a')?.label).toBe('API');
    expect(ctx.out.get('a')?.map((e) => e.target)).toEqual(['db', 'q']);
    expect(ctx.incoming.get('db')?.map((e) => e.source)).toEqual(['a']);
  });

  it('keeps the strongest duplicate finding and records agreement', () => {
    const d = loadTemplate('url-shortener');
    const base: Finding = {
      key: 'shared:api', agent: 'scalability', severity: 'low', category: 'cost',
      title: 'low', explanation: '', evidence: [], targets: ['api'], suggestion: '', confidence: 0.2, status: 'open',
    };
    const report = runCritique(d, {
      mode: 'quick',
      extraFindings: [base, { ...base, agent: 'cost', severity: 'critical', title: 'high' }],
    });
    const found = report.findings.find((f) => f.key === 'shared:api')!;
    expect(report.findings.filter((f) => f.key === 'shared:api')).toHaveLength(1);
    expect(found.title).toBe('high');
    expect(found.severity).toBe('critical');
    expect(found.agreedBy).toContain('scalability');
  });

  it('marks a weak single point of failure as contested with a rebuttal', () => {
    const d = design(`flowchart LR
  %% @scenario rps=20 entry=c
  c([Client]) --> db[(Postgres)]`);
    const report = runCritique(d, { mode: 'deep' });
    const finding = report.findings.find((f) => f.key === 'spof:db')!;
    expect(finding).toBeTruthy();
    expect(finding.status).toBe('contested');
    expect(finding.rebuttal).toMatch(/Traffic is 20 RPS/);
  });

  it('flags PII without encryption and the patch resolves it', () => {
    const d = design(`flowchart LR
  %% @node db prop.pii=true
  a[API] --> db[(Postgres)]`);
    const before = runCritique(d, { mode: 'quick' });
    const finding = before.findings.find((f) => f.key === 'pii:db')!;
    expect(finding.severity).toBe('high');
    const after = runCritique(applyPatch(d, finding.patch!), { mode: 'quick' });
    expect(after.findings.map((f) => f.key)).not.toContain('pii:db');
  });

  it('batches high fan-out and reduces downstream load', () => {
    const d = design(`flowchart LR
  %% @edge api db calls=10
  c([Client]) --> api[API]
  api --> db[(Postgres)]`);
    const finding = runCritique(d, { mode: 'quick' }).findings.find((f) => f.key.startsWith('fanout:'))!;
    expect(finding.severity).toBe('medium');
    const patched = applyPatch(d, finding.patch!);
    expect(simulate(patched).nodes.db.lambda).toBeLessThan(simulate(d).nodes.db.lambda);
    expect(runCritique(patched, { mode: 'quick' }).findings.map((f) => f.key)).not.toContain(finding.key);
  });

  it('produces a bounded score and a human-readable summary', () => {
    const report = runCritique(loadTemplate('notification-service'), { mode: 'deep' });
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(report.summary).toMatch(/Design score \d+\/100/);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    for (const f of report.findings) expect(f.confidence).toBeGreaterThan(0);
  });

  it('skips the consistency reviewer when the design has no state or messaging', () => {
    const report = runCritique(design('flowchart LR\n  c([Client]) --> api[API]'), { mode: 'deep' });
    expect(report.agentsRun).not.toContain('consistency');
    expect(report.plan.some((p) => /Skipping Data Consistency/.test(p))).toBe(true);
  });
});
