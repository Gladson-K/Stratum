/**
 * Stratum Graph Model (SGM)
 * The typed, canonical representation of a system design. Every feature
 * (canvas, diagram-as-code, simulation, critique) reads and writes this model.
 */

export type NodeKind =
  | 'client'
  | 'cdn'
  | 'load_balancer'
  | 'gateway'
  | 'service'
  | 'function'
  | 'database'
  | 'cache'
  | 'queue'
  | 'stream'
  | 'storage'
  | 'search'
  | 'external';

export const NODE_KINDS: NodeKind[] = [
  'client', 'cdn', 'load_balancer', 'gateway', 'service', 'function',
  'database', 'cache', 'queue', 'stream', 'storage', 'search', 'external',
];

export interface PerfProfile {
  /** Number of instances / replicas. */
  instances: number;
  /** Concurrent requests one instance can serve (workers, threads, connections). */
  concurrency: number;
  /** Mean service time in milliseconds for one request at this node. */
  serviceTimeMs: number;
  /** Cache hit ratio (0..1), only meaningful for kind = cache. */
  hitRatio?: number;
  /** Estimated cost per instance per hour in USD. */
  costPerHour?: number;
}

export interface Position { x: number; y: number }

export interface SNode {
  id: string;
  label: string;
  kind: NodeKind;
  tech?: string;
  group?: string;
  perf?: Partial<PerfProfile>;
  position?: Position;
  /** Free-form properties, e.g. { pii: true, region: "eu-west-1" }. */
  props?: Record<string, string | number | boolean>;
}

export interface SEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  /** Synchronous calls contribute to request latency; async ones do not. */
  sync: boolean;
  /** How many calls the source makes to the target per incoming request. */
  callsPerRequest: number;
  /** Extra network latency for the hop, in ms. */
  latencyMs?: number;
}

export interface SGroup { id: string; label: string }

export interface Scenario {
  /** Requests per second arriving at each entry node. */
  rps: number;
  /** Entry nodes. If empty, nodes with no incoming edges are used. */
  entry?: string[];
  /** Target p99 latency for SLO checks, in ms. */
  sloP99Ms?: number;
}

export interface Design {
  name: string;
  nodes: SNode[];
  edges: SEdge[];
  groups: SGroup[];
  scenario: Scenario;
}

export function emptyDesign(name = 'Untitled design'): Design {
  return { name, nodes: [], edges: [], groups: [], scenario: { rps: 1000, sloP99Ms: 300 } };
}

/** Default performance profiles by kind. Values are conservative planning estimates. */
export const DEFAULT_PERF: Record<NodeKind, PerfProfile> = {
  client:        { instances: 1, concurrency: 1_000_000, serviceTimeMs: 0,   costPerHour: 0 },
  cdn:           { instances: 1, concurrency: 1_000_000, serviceTimeMs: 2,   costPerHour: 0.5 },
  load_balancer: { instances: 2, concurrency: 50_000,    serviceTimeMs: 0.5, costPerHour: 0.03 },
  gateway:       { instances: 2, concurrency: 2_000,     serviceTimeMs: 1.5, costPerHour: 0.1 },
  service:       { instances: 3, concurrency: 100,       serviceTimeMs: 8,   costPerHour: 0.17 },
  function:      { instances: 1, concurrency: 1_000,     serviceTimeMs: 25,  costPerHour: 0.2 },
  database:      { instances: 1, concurrency: 200,       serviceTimeMs: 3,   costPerHour: 0.48 },
  cache:         { instances: 1, concurrency: 5_000,     serviceTimeMs: 0.5, costPerHour: 0.2, hitRatio: 0.9 },
  queue:         { instances: 1, concurrency: 10_000,    serviceTimeMs: 2,   costPerHour: 0.1 },
  stream:        { instances: 3, concurrency: 10_000,    serviceTimeMs: 3,   costPerHour: 0.25 },
  storage:       { instances: 1, concurrency: 5_000,     serviceTimeMs: 20,  costPerHour: 0.05 },
  search:        { instances: 3, concurrency: 200,       serviceTimeMs: 12,  costPerHour: 0.35 },
  external:      { instances: 1, concurrency: 1_000,     serviceTimeMs: 120, costPerHour: 0 },
};

export function perfOf(node: SNode): PerfProfile {
  return { ...DEFAULT_PERF[node.kind], ...(node.perf ?? {}) } as PerfProfile;
}

/** Infer a node kind from its label / tech / shape hint. */
export function inferKind(text: string, hint?: NodeKind): NodeKind {
  const t = text.toLowerCase();
  const rules: [RegExp, NodeKind][] = [
    [/\b(client|browser|mobile|web app|user|frontend|ios|android)\b/, 'client'],
    [/\b(cdn|cloudfront|akamai|fastly|edge)\b/, 'cdn'],
    [/\b(load balancer|lb|elb|alb|nlb|haproxy|nginx)\b/, 'load_balancer'],
    [/\b(gateway|api gateway|kong|envoy|apigee)\b/, 'gateway'],
    [/\b(redis|memcached|cache|valkey|elasticache)\b/, 'cache'],
    [/\b(kafka|kinesis|pulsar|stream|events|event bus|event stream|eventbridge)\b/, 'stream'],
    [/\b(queue|sqs|rabbitmq|amqp|nats|pubsub|dlq|dead.letter)\b/, 'queue'],
    [/\b(s3|blob|bucket|object storage|gcs|storage)\b/, 'storage'],
    [/\b(elasticsearch|opensearch|solr|search|meilisearch|typesense)\b/, 'search'],
    [/\b(postgres|postgresql|mysql|mariadb|aurora|dynamo|dynamodb|mongo|mongodb|cassandra|database|db|sql|clickhouse|spanner|cockroach|replica)\b/, 'database'],
    [/\b(lambda|function|cloud function|serverless|worker)\b/, 'function'],
    [/\b(stripe|twilio|sendgrid|third.party|external|provider|apns|fcm|payment provider)\b/, 'external'],
  ];
  for (const [re, kind] of rules) if (re.test(t)) return kind;
  return hint ?? 'service';
}

export function slugify(s: string): string {
  const slug = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'node';
}

export function edgeId(source: string, target: string, existing: Set<string>): string {
  let base = `${source}__${target}`;
  let id = base;
  let i = 2;
  while (existing.has(id)) id = `${base}_${i++}`;
  existing.add(id);
  return id;
}

export interface ValidationIssue { level: 'error' | 'warning'; message: string; ref?: string }

export function validateDesign(d: Design): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  for (const n of d.nodes) {
    if (ids.has(n.id)) issues.push({ level: 'error', message: `Duplicate node id "${n.id}"`, ref: n.id });
    ids.add(n.id);
  }
  for (const e of d.edges) {
    if (!ids.has(e.source)) issues.push({ level: 'error', message: `Edge ${e.id} references missing source "${e.source}"`, ref: e.id });
    if (!ids.has(e.target)) issues.push({ level: 'error', message: `Edge ${e.id} references missing target "${e.target}"`, ref: e.id });
    if (e.callsPerRequest < 0) issues.push({ level: 'error', message: `Edge ${e.id} has negative callsPerRequest`, ref: e.id });
  }
  return issues;
}

/** Stable deep clone (designs are plain JSON). */
export function cloneDesign(d: Design): Design {
  return JSON.parse(JSON.stringify(d));
}
