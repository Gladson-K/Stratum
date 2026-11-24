# Stratum v1 architecture

## Principles

1. One model, many views. Everything reads and writes the Stratum Graph Model (SGM) in `packages/core/src/sgm.ts`. The canvas, both code dialects, the simulator and the critique agents are projections of the same typed graph. That is what makes two-way diagram-as-code sync tractable.
2. The engine is pure and portable. `@stratum/core` has zero runtime dependencies and no DOM or Node APIs. The same code runs in the browser (instant quick review and live simulation on every edit) and on the server (API, CI exports, LLM-augmented deep review).
3. AI proposes, determinism verifies. Rule-based agents are the backbone because they are fast, explainable and testable. The LLM reviewer is additive, and its output is schema-checked and rejected if it references components that do not exist. Every patch, whether it comes from a rule or an LLM, goes through the same `applyPatch` engine.
4. Local-first collaboration. The Yjs document is the source of truth on each client, so the app keeps working offline and merges on reconnect.

## Data flow

```
   Mermaid / Eraser text ──parse──▶ ┌──────────────┐ ◀──drag/edit── Canvas (React Flow)
              ▲                     │ Yjs Y.Doc    │
              └──────emit────────── │ meta/nodes/  │ ──WebSocket──▶ Server relay ──▶ other clients
                                    │ edges/groups │                  │
                                    └──────┬───────┘                  └─ persisted to data/<room>.ydoc
                                           │ snapshot() → Design (SGM)
                         ┌─────────────────┼───────────────────┐
                         ▼                 ▼                   ▼
                  simulate()        runCritique()        /api/critique (deep)
                  (browser)          (browser)           rules + LLM reviewer
```

## Collaboration protocol

Each room is one `Y.Doc` with four top-level maps (`meta`, `nodes`, `edges`, `groups`). Values are plain JSON per entity, which gives last-writer-wins per component. That is the right granularity for architecture diagrams, because two people rarely edit the same component's same field at the same time, and when they do one value deterministically wins on every replica.

Frames are binary, and the first byte is the message type:

| Byte 0 | Payload | Direction |
|---|---|---|
| `0` UPDATE | Yjs update (on connect the server sends the full state, and the client sends its full state so offline edits merge) | both |
| `1` AWARENESS | UTF-8 JSON `{ clientId, state: { name, color, cursor, selected } }` | both, relayed by the server |
| `2` AWARENESS_DEL | UTF-8 JSON `{ clientId }` | server to clients when a peer disconnects |

The server applies updates to its own copy of the doc, relays them to the other peers, and persists a full snapshot after a short debounce. Undo uses `Y.UndoManager`, scoped to local transactions only, so you never undo a teammate's work.

## Critique pipeline

1. The orchestrator builds a context with adjacency maps and the current simulation.
2. The agents run: scalability, reliability, security, consistency and cost (all five in quick mode, and deep mode adds the LLM reviewer server-side).
3. Findings are de-duplicated by a stable `key`, for example `spof:prefs`. When several agents raise the same key, the strongest finding is kept and the others are recorded in `agreedBy`.
4. Devil's advocate. Low-confidence findings, and findings where the context weakens the claim (for example a missing cache on a store with little load), are marked `contested` with a written rebuttal instead of being silently dropped.
5. Ranking and score. Findings are sorted by severity and confidence, then the score is computed as 100 minus a weighted penalty, and a remediation plan is ordered by impact.
6. Patches. Accepting a finding applies typed `PatchOp`s (`addNode`, `addEdge`, `removeEdge`, `updateNode`, `updatePerf`, `updateEdge`) and then re-lays out new nodes. The tests assert that applying each patch resolves the finding it targets.

## Simulator

Per component: `c = instances × concurrency`, `μ = 1000 / serviceTimeMs`, `ρ = λ / (c·μ)`. Erlang C is computed with a numerically stable Erlang B recursion, which gives the wait probability and the mean queue wait. The steps are:

1. Load propagates along edges, multiplied by `callsPerRequest`, and caches reduce load on sibling data stores by their hit ratio.
2. Monte Carlo sampling (seeded, so it is deterministic) walks synchronous edges from the entry nodes, drawing exponential service times and queueing delay with probability equal to the wait probability.
3. Saturation on the synchronous path makes latency unbounded and fails the SLO. Saturation on an async consumer is reported as an unbounded backlog instead.
4. `maxRps` is the entry rate at which the first component reaches ρ = 1, and `safeRps` is 80% of that.

## Known v1 limitations, and their v2 plan

| Limitation | v2 plan |
|---|---|
| Closed-form M/M/c model, no retries, timeouts or bursty arrivals | A Rust discrete-event engine compiled to WASM, with arrival distributions, retry storms, circuit breakers and failure injection |
| Per-entity last-writer-wins | Field-level Y.Maps for perf and props, and Hocuspocus with auth hooks |
| Rooms are public by link | Workspaces, SSO (WorkOS), RBAC and signed room tokens |
| File-based persistence | Postgres for metadata, S3 for doc snapshots, and Redis pub/sub for multi-node relays |
| Layered layout is simple | ELK.js layout with group containers and orthogonal routing |
| Groups are shown as labels, not containers | Group/subgraph containers on the canvas with drag-into-group |
