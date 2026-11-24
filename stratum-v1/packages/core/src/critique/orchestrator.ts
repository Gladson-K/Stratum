import type { Design, SEdge } from '../sgm';
import { simulate, type SimulationResult } from '../sim/analytical';
import { AGENTS, devilsAdvocate, type AgentContext } from './agents';
import { SEVERITY_ORDER, type AgentId, type CritiqueReport, type Finding } from './types';

const SEVERITY_WEIGHT = { critical: 25, high: 12, medium: 5, low: 2, info: 0 } as const;

export interface CritiqueOptions {
  mode?: 'quick' | 'deep';
  sim?: SimulationResult;
  dismissed?: string[];
  extraFindings?: Finding[];
}

export function buildContext(design: Design, sim: SimulationResult): AgentContext {
  const byId = new Map(design.nodes.map((n) => [n.id, n]));
  const out = new Map<string, SEdge[]>();
  const incoming = new Map<string, SEdge[]>();
  for (const e of design.edges) {
    out.set(e.source, [...(out.get(e.source) ?? []), e]);
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
  }
  return { design, sim, byId, out, incoming };
}

/** Orchestrator: plans the review, runs agents, cross-examines, de-duplicates, and ranks. */
export function runCritique(design: Design, opts: CritiqueOptions = {}): CritiqueReport {
  const t0 = Date.now();
  const mode = opts.mode ?? 'quick';
  const sim = opts.sim ?? simulate(design);
  const ctx = buildContext(design, sim);
  const plan: string[] = [];

  const agentIds: (keyof typeof AGENTS)[] = mode === 'quick'
    ? ['scalability', 'reliability', 'security']
    : ['scalability', 'reliability', 'security', 'consistency', 'cost'];

  const hasMessaging = design.nodes.some((n) => n.kind === 'queue' || n.kind === 'stream');
  const hasDb = design.nodes.some((n) => n.kind === 'database');
  if (mode === 'deep' && !hasMessaging && !hasDb) {
    agentIds.splice(agentIds.indexOf('consistency'), 1);
    plan.push('Skipping Data Consistency Reviewer: no databases or brokers in design.');
  }
  plan.push(`Running ${agentIds.length} reviewers (${mode} mode) on ${design.nodes.length} nodes and ${design.edges.length} edges at ${sim.rps} RPS.`);

  let findings: Finding[] = [];
  for (const id of agentIds) findings.push(...AGENTS[id](ctx));
  if (opts.extraFindings?.length) findings.push(...opts.extraFindings);

  // De-duplicate by key, merging agreement
  const merged = new Map<string, Finding>();
  for (const f of findings) {
    const prev = merged.get(f.key);
    if (!prev) merged.set(f.key, f);
    else if (SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(prev.severity)) merged.set(f.key, { ...f, agreedBy: [prev.agent] });
    else prev.agreedBy = [...(prev.agreedBy ?? []), f.agent];
  }
  findings = [...merged.values()];

  const agentsRun: AgentId[] = ['orchestrator', ...agentIds];
  if (mode === 'deep') {
    findings = devilsAdvocate(ctx, findings);
    agentsRun.push('devils_advocate');
    const contested = findings.filter((f) => f.status === 'contested').length;
    plan.push(`Devil's Advocate contested ${contested} finding(s).`);
  }

  const dismissed = new Set(opts.dismissed ?? []);
  findings = findings.filter((f) => !dismissed.has(f.key));
  findings.sort((a, b) =>
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
    (a.status === 'contested' ? 1 : 0) - (b.status === 'contested' ? 1 : 0) ||
    b.confidence - a.confidence);

  const penalty = findings.reduce((s, f) => s + SEVERITY_WEIGHT[f.severity] * (f.status === 'contested' ? 0.5 : 1), 0);
  const score = Math.max(0, Math.round(100 - penalty));
  const counts = SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length] as const).filter(([, c]) => c > 0);
  const summary = findings.length
    ? `${findings.length} finding(s): ${counts.map(([s, c]) => `${c} ${s}`).join(', ')}. Design score ${score}/100.`
    : `No issues found at ${sim.rps} RPS. Design score ${score}/100.`;

  return { mode, agentsRun, findings, score, summary, durationMs: Date.now() - t0, plan };
}
