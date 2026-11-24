import { emitMermaid } from './dsl/mermaid';
import type { Design } from './sgm';
import type { SimulationResult } from './sim/analytical';
import type { Finding, Severity } from './critique/types';

/**
 * Helpers for the optional LLM reviewer. The server sends these prompts to any
 * OpenAI-compatible chat completions endpoint and validates the response so
 * the model can never reference nodes that do not exist.
 */

export function buildCritiquePrompt(design: Design, sim: SimulationResult): { system: string; user: string } {
  const system = `You are a principal software architect reviewing a system design.
Return ONLY JSON: {"findings":[{"title":string,"severity":"critical"|"high"|"medium"|"low","category":"scalability"|"reliability"|"security"|"consistency"|"cost","targets":[nodeId...],"explanation":string,"suggestion":string}]}
Rules: reference only node ids that exist in the design. At most 6 findings. Be specific and cite numbers from the simulation when relevant. Do not repeat generic advice.`;
  const simSummary = Object.values(sim.nodes)
    .filter((n) => n.lambda > 0)
    .map((n) => `${n.id}: ${n.lambda.toFixed(0)} req/s, utilization ${(n.utilization * 100).toFixed(0)}%`)
    .join('\n');
  const user = `Design (Mermaid with Stratum metadata):\n${emitMermaid(design)}\nSimulation at ${sim.rps} RPS:\n${simSummary}\np99 latency: ${sim.latency ? sim.latency.p99.toFixed(1) + ' ms' : 'unbounded (saturated)'}`;
  return { system, user };
}

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
const CATEGORIES = ['scalability', 'reliability', 'security', 'consistency', 'cost'] as const;

export function parseLlmFindings(raw: string, design: Design): Finding[] {
  const jsonText = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  let data: unknown;
  try { data = JSON.parse(jsonText); } catch { return []; }
  const list = (data as { findings?: unknown[] })?.findings;
  if (!Array.isArray(list)) return [];
  const ids = new Set(design.nodes.map((n) => n.id));
  const out: Finding[] = [];
  list.slice(0, 6).forEach((f, i) => {
    const x = f as Record<string, unknown>;
    const targets = Array.isArray(x.targets) ? (x.targets as unknown[]).map(String).filter((t) => ids.has(t)) : [];
    if (!targets.length || typeof x.title !== 'string') return; // reject ungrounded findings
    out.push({
      key: `llm:${i}:${targets.join(',')}`,
      agent: 'llm',
      severity: SEVERITIES.includes(x.severity as Severity) ? (x.severity as Severity) : 'medium',
      category: (CATEGORIES as readonly string[]).includes(String(x.category)) ? (x.category as Finding['category']) : 'reliability',
      title: x.title,
      explanation: String(x.explanation ?? ''),
      evidence: ['LLM review grounded on design graph and simulation summary'],
      targets,
      suggestion: String(x.suggestion ?? ''),
      confidence: 0.6,
      status: 'open',
    });
  });
  return out;
}
