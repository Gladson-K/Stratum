import { perfOf, slugify, type Design, type SEdge, type SNode } from '../sgm';
import type { SimulationResult } from '../sim/analytical';
import type { AgentId, Finding, PatchOp } from './types';

export interface AgentContext {
  design: Design;
  sim: SimulationResult;
  byId: Map<string, SNode>;
  out: Map<string, SEdge[]>;
  incoming: Map<string, SEdge[]>;
}

export type Agent = (ctx: AgentContext) => Finding[];

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const fmt = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)}K` : x.toFixed(x < 10 ? 1 : 0));

function uniqueId(d: Design, base: string) {
  let id = slugify(base);
  let i = 2;
  while (d.nodes.some((n) => n.id === id)) id = `${slugify(base)}_${i++}`;
  return id;
}

function near(n: SNode, dx = 0, dy = 140) {
  return n.position ? { x: n.position.x + dx, y: n.position.y + dy } : undefined;
}

const STATEFUL = new Set(['database', 'cache', 'queue', 'stream', 'search', 'storage']);
const DATA = new Set(['database', 'storage', 'search']);
const MESSAGING = new Set(['queue', 'stream']);

// ------------------------------------------------------------------ Scalability
export const scalabilityAgent: Agent = ({ design, sim, byId, out }) => {
  const f: Finding[] = [];
  for (const n of design.nodes) {
    const r = sim.nodes[n.id];
    if (!r || r.lambda <= 0 || n.kind === 'client' || n.kind === 'external') continue;
    const p = perfOf(n);
    if (r.utilization >= 0.8) {
      const target = Math.ceil(p.instances * (r.utilization / 0.6));
      f.push({
        key: `saturation:${n.id}`, agent: 'scalability',
        severity: r.utilization >= 1 ? 'critical' : 'high', category: 'scalability',
        title: r.utilization >= 1 ? `${n.label} is saturated at ${fmt(sim.rps)} RPS` : `${n.label} runs hot at ${pct(r.utilization)} utilization`,
        explanation: `${n.label} receives ${fmt(r.lambda)} req/s against a capacity of ${fmt(r.capacityRps)} req/s. Above ~80% utilization, queueing delay grows sharply and tail latency becomes unstable.`,
        evidence: [`Simulated utilization ${pct(r.utilization)}`, `Capacity ${fmt(r.capacityRps)} req/s (${p.instances} instances × ${p.concurrency} concurrency at ${p.serviceTimeMs} ms)`],
        targets: [n.id],
        suggestion: STATEFUL.has(n.kind)
          ? `Scale ${n.label} to ${target} nodes/shards, add read replicas, or partition the data.`
          : `Scale ${n.label} horizontally to at least ${target} instances (target ≤ 60% utilization) and configure autoscaling.`,
        patch: [{ op: 'updatePerf', id: n.id, perf: { instances: target } }],
        confidence: 0.9, status: 'open',
      });
    }
  }
  for (const e of design.edges) {
    if (e.sync && e.callsPerRequest >= 5) {
      const s = byId.get(e.source), t = byId.get(e.target);
      if (!s || !t) continue;
      f.push({
        key: `fanout:${e.id}`, agent: 'scalability', severity: e.callsPerRequest >= 20 ? 'high' : 'medium', category: 'scalability',
        title: `High synchronous fan-out from ${s.label} to ${t.label}`,
        explanation: `Each request to ${s.label} makes ${e.callsPerRequest} synchronous calls to ${t.label} (an N+1 pattern). This multiplies load on ${t.label} and adds latency on every request.`,
        evidence: [`callsPerRequest = ${e.callsPerRequest}`, `${t.label} receives ${fmt(sim.nodes[t.id]?.lambda ?? 0)} req/s`],
        targets: [e.id, s.id, t.id],
        suggestion: `Batch the calls (one bulk request), cache results, or denormalize the data ${s.label} needs.`,
        patch: [{ op: 'updateEdge', id: e.id, set: { callsPerRequest: 1, label: `${e.label ? e.label + ' ' : ''}(batched)`.trim() } }],
        confidence: 0.8, status: 'open',
      });
    }
  }
  // Hot database without a cache in front of it
  for (const db of design.nodes.filter((n) => DATA.has(n.kind) && n.kind !== 'storage')) {
    const r = sim.nodes[db.id];
    if (!r || r.lambda < 1500) continue;
    const callers = design.edges.filter((e) => e.target === db.id && e.sync).map((e) => byId.get(e.source)!).filter(Boolean);
    const uncached = callers.filter((c) => !(out.get(c.id) ?? []).some((e) => byId.get(e.target)?.kind === 'cache'));
    if (!uncached.length) continue;
    const cacheId = uniqueId(design, `${db.label} cache`);
    const patch: PatchOp[] = [
      { op: 'addNode', node: { id: cacheId, label: `${db.label} Cache`, kind: 'cache', tech: 'Redis', perf: { instances: 2, hitRatio: 0.85 }, position: near(db, 220, 0), group: db.group } },
      ...uncached.map((c) => ({ op: 'addEdge' as const, edge: { id: `${c.id}__${cacheId}`, source: c.id, target: cacheId, sync: true, callsPerRequest: 1, label: 'cache-aside' } })),
    ];
    f.push({
      key: `nocache:${db.id}`, agent: 'scalability', severity: 'medium', category: 'scalability',
      title: `${db.label} serves ${fmt(r.lambda)} req/s with no cache`,
      explanation: `${uncached.map((c) => c.label).join(', ')} read from ${db.label} directly. A cache-aside layer typically absorbs 80–95% of repeated reads and protects the database during spikes.`,
      evidence: [`${db.label} load ${fmt(r.lambda)} req/s`, `Utilization ${pct(r.utilization)}`],
      targets: [db.id, ...uncached.map((c) => c.id)],
      suggestion: `Add a Redis cache in front of ${db.label} with explicit TTLs and invalidation on write.`,
      patch, confidence: 0.65, status: 'open',
    });
  }
  return f;
};

// ------------------------------------------------------------------ Reliability
export const reliabilityAgent: Agent = ({ design, sim, byId, out, incoming }) => {
  const f: Finding[] = [];
  const critical = new Set(['database', 'cache', 'load_balancer', 'gateway']);
  for (const n of design.nodes) {
    if (['client', 'external', 'cdn', 'storage', 'function'].includes(n.kind)) continue;
    const p = perfOf(n);
    if (p.instances > 1) continue;
    const hasReplica = (out.get(n.id) ?? []).some((e) => byId.get(e.target)?.kind === n.kind && /replic/i.test(`${byId.get(e.target)?.label} ${e.label ?? ''}`));
    if (hasReplica) continue;
    let patch: PatchOp[];
    if (n.kind === 'database') {
      const rid = uniqueId(design, `${n.label} replica`);
      patch = [
        { op: 'addNode', node: { id: rid, label: `${n.label} Replica`, kind: 'database', tech: n.tech, position: near(n, 0, 150), group: n.group } },
        { op: 'addEdge', edge: { id: `${n.id}__${rid}`, source: n.id, target: rid, sync: false, callsPerRequest: 1, label: 'replication' } },
      ];
    } else {
      patch = [{ op: 'updatePerf', id: n.id, perf: { instances: 2 } }];
    }
    f.push({
      key: `spof:${n.id}`, agent: 'reliability', severity: critical.has(n.kind) ? 'high' : 'medium', category: 'reliability',
      title: `${n.label} is a single point of failure`,
      explanation: `${n.label} runs as a single instance. A crash, deploy, or zone outage takes down every path that depends on it (${(incoming.get(n.id) ?? []).length} upstream dependencies).`,
      evidence: [`instances = 1`, `kind = ${n.kind}`],
      targets: [n.id],
      suggestion: n.kind === 'database'
        ? `Add a standby/read replica in a second availability zone with automated failover.`
        : `Run at least 2 instances across availability zones behind health checks.`,
      patch, confidence: 0.85, status: 'open',
    });
  }
  // Long synchronous chains
  const depthMemo = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    seen.add(id);
    const d = 1 + Math.max(0, ...(out.get(id) ?? []).filter((e) => e.sync).map((e) => depth(e.target, seen)));
    seen.delete(id);
    depthMemo.set(id, d);
    return d;
  };
  for (const id of sim.entry) {
    const d = depth(id, new Set());
    if (d > 6) {
      f.push({
        key: `chain:${id}`, agent: 'reliability', severity: 'medium', category: 'reliability',
        title: `Synchronous call chain is ${d} hops deep`,
        explanation: `A request from ${byId.get(id)?.label} passes through ${d} synchronous hops. Availability multiplies along the chain (e.g. 0.999^${d} ≈ ${(0.999 ** d * 100).toFixed(2)}%), and any slow hop stalls the whole request.`,
        evidence: [`Longest sync path depth ${d}`],
        targets: [id],
        suggestion: 'Move non-critical steps to asynchronous messaging, and set timeouts plus circuit breakers on each hop.',
        confidence: 0.7, status: 'open',
      });
    }
  }
  // Slow external dependency on the hot path
  for (const e of design.edges) {
    const t = byId.get(e.target), s = byId.get(e.source);
    if (!t || !s || !e.sync || t.kind !== 'external' || (sim.nodes[s.id]?.lambda ?? 0) <= 0) continue;
    if (s.kind === 'client') continue;
    const qid = uniqueId(design, `${t.label} jobs`);
    f.push({
      key: `external-sync:${e.id}`, agent: 'reliability', severity: 'medium', category: 'reliability',
      title: `${s.label} calls ${t.label} synchronously`,
      explanation: `Third-party APIs have latency and availability you do not control (modeled at ${perfOf(t).serviceTimeMs} ms). When ${t.label} slows down, ${s.label} threads pile up and the failure cascades upstream.`,
      evidence: [`Sync edge ${s.id} → ${t.id}`, `Modeled service time ${perfOf(t).serviceTimeMs} ms`],
      targets: [e.id, t.id],
      suggestion: `Put a queue between ${s.label} and ${t.label} if the result is not needed in the response; otherwise add timeouts, retries with jitter, and a circuit breaker.`,
      patch: [
        { op: 'removeEdge', id: e.id },
        { op: 'addNode', node: { id: qid, label: `${t.label} Jobs`, kind: 'queue', tech: 'SQS', position: near(t, -160, 0) } },
        { op: 'addEdge', edge: { id: `${s.id}__${qid}`, source: s.id, target: qid, sync: false, callsPerRequest: e.callsPerRequest, label: 'enqueue' } },
        { op: 'addEdge', edge: { id: `${qid}__${t.id}`, source: qid, target: t.id, sync: false, callsPerRequest: 1, label: 'worker' } },
      ],
      confidence: 0.6, status: 'open',
    });
  }
  // Messaging without dead-letter handling
  for (const q of design.nodes.filter((n) => MESSAGING.has(n.kind) && !/dlq|dead/i.test(n.label))) {
    const consumers = out.get(q.id) ?? [];
    if (!consumers.length) continue;
    const hasDlq = consumers.some((e) => /dlq|dead/i.test(byId.get(e.target)?.label ?? ''));
    if (hasDlq) continue;
    const dlqId = uniqueId(design, `${q.label} dlq`);
    f.push({
      key: `dlq:${q.id}`, agent: 'reliability', severity: 'low', category: 'reliability',
      title: `${q.label} has no dead-letter queue`,
      explanation: `Messages that repeatedly fail processing will either block the partition or be retried forever. A dead-letter queue isolates poison messages for inspection.`,
      evidence: [`${consumers.length} consumer(s), no DLQ edge`],
      targets: [q.id],
      suggestion: `Add a dead-letter queue with a max-receive count (e.g. 5) and an alert on DLQ depth.`,
      patch: [
        { op: 'addNode', node: { id: dlqId, label: `${q.label} DLQ`, kind: 'queue', position: near(q, 0, 130), group: q.group } },
        { op: 'addEdge', edge: { id: `${q.id}__${dlqId}`, source: q.id, target: dlqId, sync: false, callsPerRequest: 0.01, label: 'failed messages' } },
      ],
      confidence: 0.75, status: 'open',
    });
  }
  return f;
};

// ------------------------------------------------------------------ Security
export const securityAgent: Agent = ({ design, byId }) => {
  const f: Finding[] = [];
  const backend = new Set(['database', 'cache', 'queue', 'stream', 'search']);
  for (const e of design.edges) {
    const s = byId.get(e.source), t = byId.get(e.target);
    if (!s || !t || s.kind !== 'client') continue;
    if (backend.has(t.kind)) {
      f.push({
        key: `client-data:${e.id}`, agent: 'security', severity: 'critical', category: 'security',
        title: `${s.label} connects directly to ${t.label}`,
        explanation: `Clients must never hold credentials or network access to data stores. This exposes ${t.label} to the internet and bypasses authorization logic.`,
        evidence: [`Edge ${s.id} → ${t.id}`],
        targets: [e.id, t.id],
        suggestion: `Route access through an authenticated API service; keep ${t.label} in a private subnet.`,
        confidence: 0.95, status: 'open',
      });
    } else if (t.kind === 'service' || t.kind === 'function') {
      const gwId = uniqueId(design, 'API Gateway');
      f.push({
        key: `no-gateway:${e.id}`, agent: 'security', severity: 'medium', category: 'security',
        title: `${t.label} is exposed to clients without a gateway`,
        explanation: `Traffic from ${s.label} reaches ${t.label} without an API gateway or load balancer. Authentication, rate limiting, TLS termination, and WAF rules end up re-implemented (or missing) per service.`,
        evidence: [`Edge ${s.id} → ${t.id}`],
        targets: [e.id, t.id],
        suggestion: `Front public traffic with an API gateway that handles authN, rate limits, and request validation.`,
        patch: [
          { op: 'removeEdge', id: e.id },
          { op: 'addNode', node: { id: gwId, label: 'API Gateway', kind: 'gateway', position: near(t, -200, 0) } },
          { op: 'addEdge', edge: { id: `${s.id}__${gwId}`, source: s.id, target: gwId, sync: true, callsPerRequest: e.callsPerRequest, label: 'HTTPS' } },
          { op: 'addEdge', edge: { id: `${gwId}__${t.id}`, source: gwId, target: t.id, sync: true, callsPerRequest: 1 } },
        ],
        confidence: 0.7, status: 'open',
      });
    }
  }
  for (const n of design.nodes) {
    if (n.props?.pii === true && n.props?.encrypted !== true) {
      f.push({
        key: `pii:${n.id}`, agent: 'security', severity: 'high', category: 'security',
        title: `${n.label} stores PII without declared encryption`,
        explanation: `${n.label} is marked as holding personal data but has no encryption-at-rest property. Most compliance regimes (GDPR, DPDP, HIPAA) require it.`,
        evidence: ['prop.pii = true', 'prop.encrypted not set'],
        targets: [n.id],
        suggestion: 'Enable encryption at rest with KMS-managed keys, and restrict access with least-privilege IAM roles.',
        patch: [{ op: 'updateNode', id: n.id, set: { props: { ...(n.props ?? {}), encrypted: true } } }],
        confidence: 0.9, status: 'open',
      });
    }
  }
  return f;
};

// ------------------------------------------------------------------ Data consistency
export const consistencyAgent: Agent = ({ design, byId, out }) => {
  const f: Finding[] = [];
  for (const n of design.nodes) {
    if (!['service', 'function'].includes(n.kind) || n.props?.outbox === true) continue;
    const edges = out.get(n.id) ?? [];
    const dbWrites = edges.filter((e) => byId.get(e.target)?.kind === 'database');
    const pubs = edges.filter((e) => MESSAGING.has(byId.get(e.target)?.kind ?? 'service') && !/dlq|dead/i.test(byId.get(e.target)?.label ?? ''));
    if (dbWrites.length && pubs.length) {
      const db = byId.get(dbWrites[0].target)!, q = byId.get(pubs[0].target)!;
      f.push({
        key: `dualwrite:${n.id}`, agent: 'consistency', severity: 'high', category: 'consistency',
        title: `${n.label} dual-writes to ${db.label} and ${q.label}`,
        explanation: `Writing to a database and publishing to a broker are two separate operations. If the process crashes between them, the event is lost or published for a write that rolled back, leaving consumers inconsistent.`,
        evidence: [`Edges ${n.id} → ${db.id} and ${n.id} → ${q.id}`],
        targets: [n.id, dbWrites[0].id, pubs[0].id],
        suggestion: `Use the transactional outbox pattern: write the event to an outbox table in the same transaction, and relay it to ${q.label} with CDC (e.g. Debezium).`,
        patch: [
          { op: 'updateNode', id: n.id, set: { props: { ...(n.props ?? {}), outbox: true } } },
          { op: 'updateEdge', id: pubs[0].id, set: { label: 'via outbox (CDC)', sync: false } },
        ],
        confidence: 0.8, status: 'open',
      });
    }
  }
  // Shared database between multiple services
  for (const db of design.nodes.filter((n) => n.kind === 'database')) {
    const writers = design.edges.filter((e) => e.target === db.id && byId.get(e.source)?.kind === 'service');
    if (writers.length >= 3) {
      f.push({
        key: `shareddb:${db.id}`, agent: 'consistency', severity: 'medium', category: 'consistency',
        title: `${writers.length} services share ${db.label}`,
        explanation: `Several services reading and writing the same schema couple their deployments and make ownership of data invariants unclear.`,
        evidence: writers.map((w) => `${byId.get(w.source)?.label} → ${db.label}`),
        targets: [db.id, ...writers.map((w) => w.source)],
        suggestion: `Give each service ownership of its tables, and expose data to others through APIs or events.`,
        confidence: 0.55, status: 'open',
      });
    }
  }
  return f;
};

// ------------------------------------------------------------------ Cost
export const costAgent: Agent = ({ design, sim }) => {
  const f: Finding[] = [];
  for (const n of design.nodes) {
    const r = sim.nodes[n.id];
    const p = perfOf(n);
    if (!r || p.instances < 3 || r.utilization >= 0.1 || n.kind === 'client') continue;
    const target = Math.max(2, Math.ceil(p.instances * (r.utilization / 0.5)));
    if (target >= p.instances) continue;
    const saving = (p.costPerHour ?? 0) * (p.instances - target) * 730;
    f.push({
      key: `overprov:${n.id}`, agent: 'cost', severity: 'low', category: 'cost',
      title: `${n.label} is over-provisioned (${pct(r.utilization)} utilized)`,
      explanation: `${n.label} runs ${p.instances} instances but uses ${pct(r.utilization)} of capacity at the modeled load. Right-sizing to ${target} instances keeps headroom while cutting cost.`,
      evidence: [`Utilization ${pct(r.utilization)}`, `Estimated saving ~$${saving.toFixed(0)}/month`],
      targets: [n.id],
      suggestion: `Reduce to ${target} instances and rely on autoscaling for peaks.`,
      patch: [{ op: 'updatePerf', id: n.id, perf: { instances: target } }],
      confidence: 0.6, status: 'open',
    });
  }
  return f;
};

/** Cross-examines other agents' findings to reduce false positives. */
export function devilsAdvocate(ctx: AgentContext, findings: Finding[]): Finding[] {
  const { design, sim, byId } = ctx;
  return findings.map((fd) => {
    const node = byId.get(fd.targets[0]);
    const r = node ? sim.nodes[node.id] : undefined;
    let rebuttal: string | undefined;
    if (fd.key.startsWith('spof:') && (design.scenario.rps < 50 || node?.props?.env === 'dev')) {
      rebuttal = `Traffic is ${design.scenario.rps} RPS${node?.props?.env === 'dev' ? ' in a dev environment' : ''}; a managed single instance with backups may be acceptable until the SLA requires HA.`;
    } else if (fd.key.startsWith('nocache:') && r && r.utilization < 0.3) {
      rebuttal = `${node?.label} is only ${pct(r.utilization)} utilized. A cache adds an invalidation problem; adding a read replica or an index may be simpler.`;
    } else if (fd.key.startsWith('overprov:') && node && STATEFUL.has(node.kind)) {
      rebuttal = `Stateful tiers need headroom for failover and rebalancing; low steady-state utilization may be intentional.`;
    } else if (fd.key.startsWith('external-sync:') && /auth|payment|charge|checkout/i.test(`${node?.label} ${design.edges.find((e) => fd.targets.includes(e.id))?.label ?? ''}`)) {
      rebuttal = `If the response depends on this call (for example payment authorization), it cannot be made async; prefer timeouts plus a circuit breaker.`;
    } else if (fd.key.startsWith('shareddb:')) {
      rebuttal = `For a small team, a shared database with schema-per-service conventions can be a pragmatic first step.`;
    }
    if (rebuttal) return { ...fd, status: 'contested' as const, rebuttal };
    return { ...fd, agreedBy: [...(fd.agreedBy ?? []), 'devils_advocate' as AgentId] };
  });
}

export const AGENTS: Record<Exclude<AgentId, 'orchestrator' | 'devils_advocate' | 'llm'>, Agent> = {
  scalability: scalabilityAgent,
  reliability: reliabilityAgent,
  security: securityAgent,
  consistency: consistencyAgent,
  cost: costAgent,
};
