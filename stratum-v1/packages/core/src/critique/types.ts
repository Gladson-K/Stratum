import type { SEdge, SNode, PerfProfile } from '../sgm';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export type AgentId =
  | 'orchestrator'
  | 'scalability'
  | 'reliability'
  | 'security'
  | 'consistency'
  | 'cost'
  | 'devils_advocate'
  | 'llm';

export const AGENT_LABELS: Record<AgentId, string> = {
  orchestrator: 'Orchestrator',
  scalability: 'Scalability Reviewer',
  reliability: 'Reliability (SRE) Reviewer',
  security: 'Security Reviewer',
  consistency: 'Data Consistency Reviewer',
  cost: 'Cost (FinOps) Reviewer',
  devils_advocate: "Devil's Advocate",
  llm: 'LLM Reviewer',
};

export type PatchOp =
  | { op: 'addNode'; node: SNode }
  | { op: 'addEdge'; edge: SEdge }
  | { op: 'removeEdge'; id: string }
  | { op: 'updateNode'; id: string; set: Partial<Omit<SNode, 'id' | 'perf'>> }
  | { op: 'updatePerf'; id: string; perf: Partial<PerfProfile> }
  | { op: 'updateEdge'; id: string; set: Partial<Omit<SEdge, 'id'>> };

export interface Finding {
  /** Stable key used for de-duplication and dismiss tracking, e.g. "spof:redis". */
  key: string;
  agent: AgentId;
  severity: Severity;
  category: 'scalability' | 'reliability' | 'security' | 'consistency' | 'cost';
  title: string;
  explanation: string;
  evidence: string[];
  /** Node or edge ids this finding is anchored to on the canvas. */
  targets: string[];
  suggestion: string;
  patch?: PatchOp[];
  /** 0..1 confidence from the raising agent. */
  confidence: number;
  status: 'open' | 'contested';
  rebuttal?: string;
  agreedBy?: AgentId[];
}

export interface CritiqueReport {
  mode: 'quick' | 'deep';
  agentsRun: AgentId[];
  findings: Finding[];
  score: number;
  summary: string;
  durationMs: number;
  plan: string[];
}
