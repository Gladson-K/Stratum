import { autoLayout } from './layout';
import { emptyDesign, type Design, type NodeKind, type SNode, type SEdge } from './sgm';

/**
 * Offline prompt → design generator (deterministic, no LLM required).
 * It extracts traffic numbers and capabilities from the prompt and assembles a
 * reference architecture. When an LLM is configured, the server uses
 * `buildGeneratePrompt` instead and validates the result with `validateLlmDesign`.
 */

function parseRate(prompt: string): number | null {
  const t = prompt.toLowerCase().replace(/,/g, '');
  const m = /(\d+(?:\.\d+)?)\s*(k|m|thousand|million)?\s*(?:req(?:uest)?s?|rps|qps|writes|reads|messages|events)?\s*(?:\/|per)\s*(s|sec|second|min|minute|day)/.exec(t);
  const m2 = m ?? /(\d+(?:\.\d+)?)\s*(k|m|thousand|million)?\s*(rps|qps)/.exec(t);
  if (!m2) return null;
  let v = parseFloat(m2[1]);
  const unit = m2[2];
  if (unit === 'k' || unit === 'thousand') v *= 1e3;
  if (unit === 'm' || unit === 'million') v *= 1e6;
  const per = m ? m[3] : 's';
  if (per.startsWith('min')) v /= 60;
  if (per === 'day') v = (v / 86400) * 5; // assume 5x peak factor over daily average
  return Math.round(v);
}

export interface GenerateResult { design: Design; assumptions: string[] }

export function generateFromPrompt(prompt: string): GenerateResult {
  const p = prompt.toLowerCase();
  const assumptions: string[] = [];
  const d = emptyDesign(prompt.slice(0, 60) || 'Generated design');
  const nodes: SNode[] = [];
  const edges: SEdge[] = [];
  const add = (id: string, label: string, kind: NodeKind, extra: Partial<SNode> = {}) => { nodes.push({ id, label, kind, ...extra }); return id; };
  const link = (s: string, t: string, sync = true, label?: string, calls = 1) => edges.push({ id: `${s}__${t}`, source: s, target: t, sync, callsPerRequest: calls, label });

  const rps = parseRate(prompt);
  d.scenario.rps = rps ?? 1000;
  assumptions.push(rps ? `Peak load ${rps.toLocaleString()} RPS (parsed from prompt).` : 'No traffic figure found; assuming 1,000 RPS peak.');

  const realtime = /chat|real.?time|websocket|live|presence|multiplayer/.test(p);
  const media = /video|image|upload|media|file|photo|stream(ing)? video/.test(p);
  const search = /search|query|discover/.test(p);
  const payments = /pay|checkout|order|billing|subscription/.test(p);
  const notify = /notif|email|sms|push/.test(p);
  const analytics = /analytic|metric|click|event|track|report/.test(p);
  const readHeavy = /read.?heavy|feed|timeline|shorten|catalog|profile|cache/.test(p) || true;

  add('client', 'Client', 'client');
  if (media) { add('cdn', 'CDN', 'cdn'); link('client', 'cdn'); assumptions.push('Static and media content served from a CDN.'); }
  add('lb', 'Load Balancer', 'load_balancer');
  link(media ? 'cdn' : 'client', 'lb');
  const edge = realtime ? add('ws', 'WebSocket Gateway', 'gateway', { perf: { instances: 4, concurrency: 5000, serviceTimeMs: 1 } }) : add('gw', 'API Gateway', 'gateway');
  link('lb', edge);
  const svcInstances = Math.max(2, Math.ceil((d.scenario.rps * 0.008) / 100 / 0.6));
  add('api', 'Core API Service', 'service', { perf: { instances: svcInstances } });
  link(edge, 'api');
  assumptions.push(`Core API sized at ${svcInstances} instances (8 ms service time, 100 concurrency, 60% target utilization).`);
  if (readHeavy) { add('cache', 'Redis Cache', 'cache', { perf: { instances: 2, hitRatio: 0.9 } }); link('api', 'cache'); }
  add('db', 'PostgreSQL Primary', 'database', { perf: { instances: 2 } });
  add('replica', 'Read Replica', 'database');
  link('api', 'db');
  link('db', 'replica', false, 'replication');
  if (media) { add('blob', 'Object Storage', 'storage'); link('api', 'blob', true, 'signed URLs'); }
  if (search) { add('search', 'Search Cluster', 'search'); add('indexer', 'Indexer', 'function'); link('api', 'search'); }
  if (payments) { add('payments', 'Payment Service', 'service'); add('psp', 'Payment Provider', 'external', { perf: { serviceTimeMs: 250, concurrency: Math.max(1000, Math.ceil((d.scenario.rps * 0.2 * 0.25) / 0.5)) } }); assumptions.push('Payment provider rate limit assumed high enough for peak (verify with your PSP).'); link('api', 'payments', true, undefined, 0.2); link('payments', 'psp'); assumptions.push('20% of requests involve payment.'); }
  if (notify || analytics || realtime || search) {
    add('events', 'Event Stream', 'stream');
    link('api', 'events', false, 'domain events');
    if (search) link('events', 'indexer', false);
    if (search) link('indexer', 'search', false);
    if (notify) { add('notifier', 'Notification Worker', 'function'); add('provider', 'Email / Push Provider', 'external', { perf: { concurrency: Math.max(1000, Math.ceil((d.scenario.rps * 0.1 * 0.12) / 0.5)) } }); link('events', 'notifier', false, undefined, 0.1); link('notifier', 'provider', false, 'send'); assumptions.push('About 10% of requests trigger a notification.'); }
    if (analytics) { add('olap', 'Analytics Store', 'database', { tech: 'ClickHouse' }); link('events', 'olap', false, 'ingest'); }
    if (realtime) { add('fanout', 'Fan-out Worker', 'function'); link('events', 'fanout', false); link('fanout', 'ws', false, 'deliver'); }
  }
  d.nodes = nodes;
  d.edges = edges;
  d.scenario.entry = ['client'];
  return { design: autoLayout(d), assumptions };
}
