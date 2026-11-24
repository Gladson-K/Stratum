# Stratum v1

Stratum is an AI-assisted system design workspace. You sketch an architecture on a shared canvas or write it as code, a panel of review agents critiques it, and a queueing simulator tells you where it breaks and what it costs.

This repository is the Version 1 (MVP) implementation of the product described in the Stratum product specification. It runs fully offline. An LLM is optional and only adds an extra reviewer and better prompt-to-diagram output.

## What works in v1

| Capability | What you get |
|---|---|
| Diagram-as-code | Two-way sync between the canvas and Mermaid `flowchart` or an Eraser-style DSL. Edit either side and the other updates. Performance metadata is stored in comments, so the code stays valid Mermaid. |
| Multi-agent critique | Five specialist reviewers (scalability, reliability, security, consistency, cost) plus a devil's-advocate agent that challenges weak findings. Findings carry evidence, a confidence score, canvas anchors and a one-click patch. |
| Throughput and latency simulation | M/M/c queueing (Erlang C) per component, cache hit-ratio propagation, fan-out, Monte Carlo p50/p95/p99 over synchronous paths, saturation point, safe ceiling, SLO check, monthly cost and cost per million requests, and a load curve from 0.25x to 10x. |
| Real-time collaboration | Yjs CRDT document per room, a WebSocket relay, presence avatars, live cursors, offline editing with merge on reconnect, and server-side persistence. |
| Prompt to diagram | Describe a system ("chat app, 20k rps, search, push notifications") and get a sized starting architecture with stated assumptions. Uses the LLM when configured, with a deterministic offline generator as fallback. |
| Templates and export | URL shortener, notification service (with deliberate flaws to find), e-commerce checkout and chat. Export to `.mmd`, `.eraser`, Stratum JSON, and the critique report as JSON. |

## Quick start

Requirements: Node.js 20.19 or newer, npm 10.

```bash
npm install
npm run build      # builds the web app into apps/web/dist
npm start          # serves the app + API + collaboration on http://localhost:8787
```

Open http://localhost:8787. The URL gets a `#room=<id>` hash; share it (or click Share) and anyone who opens it edits the same design live.

For development with hot reload:

```bash
npm run dev        # server on :8787 (tsx watch) and Vite on :5173 with /api and /collab proxied
```

Run the checks:

```bash
npm test           # vitest suite for the core engine
npm run typecheck  # tsc across core, server and web
```

## Enabling the LLM reviewer (optional)

Set these before `npm start` (any OpenAI-compatible endpoint works, including Azure OpenAI, OpenRouter, vLLM and Ollama):

```bash
export STRATUM_LLM_API_KEY=sk-...
export STRATUM_LLM_BASE_URL=https://api.openai.com/v1   # default
export STRATUM_LLM_MODEL=gpt-4o-mini                    # default
```

With a key set, Deep review adds an LLM reviewer whose findings are validated against the design (any finding that references a non-existent component is discarded) before being merged with the rule-based agents. Without a key, Deep review still runs all rule-based agents and the cross-examination step.

See `.env.example` for all variables. `PORT` defaults to 8787 and `STRATUM_DATA_DIR` defaults to `./data` relative to the server's working directory.

## Repository layout

```
stratum-v1/
├── packages/core/            # Framework-free engine, shared by browser and server
│   ├── src/sgm.ts            # Stratum Graph Model: typed nodes, edges, perf profiles
│   ├── src/dsl/              # Mermaid and Eraser-style parsers/emitters + metadata comments
│   ├── src/sim/analytical.ts # Queueing simulator and load curve
│   ├── src/critique/         # Agents, orchestrator, devil's advocate, patch engine
│   ├── src/layout.ts         # Layered auto-layout
│   ├── src/generate.ts       # Offline prompt-to-design generator
│   ├── src/llm.ts            # LLM prompt builder and strict finding validation
│   ├── src/templates.ts      # Starter designs
│   └── test/core.test.ts     # vitest suite
├── apps/server/              # Node HTTP API + WebSocket collaboration relay
│   ├── src/index.ts          # Routes, static hosting, WS upgrade
│   ├── src/rooms.ts          # Yjs rooms, awareness relay, persistence
│   └── src/llm.ts            # OpenAI-compatible client
├── apps/web/                 # React 19 + React Flow + Yjs client
│   ├── src/App.tsx           # Shell, top bar, review orchestration
│   ├── src/lib/collab.ts     # Yjs document and WebSocket provider
│   └── src/components/       # Canvas, CodePanel, Inspector, SimPanel, CritiquePanel
└── docs/ARCHITECTURE.md      # Design notes and v1 to v2 upgrade path
```

## HTTP API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | | `{ ok, version, llm, rooms }` |
| GET | `/api/templates` | | Template list |
| GET | `/api/rooms/:id/snapshot` | | Current design JSON for a room |
| GET | `/api/rooms/:id/mermaid` | | Room design as Mermaid text |
| GET | `/api/rooms/:id/eraser` | | Room design as Eraser-style text |
| POST | `/api/simulate` | `{ design, rps?, samples? }` | `SimulationResult` |
| POST | `/api/critique` | `{ design, mode: "quick" \| "deep", dismissed?, rps? }` | `CritiqueReport` |
| POST | `/api/generate` | `{ prompt }` | `{ design, assumptions, source }` |

The room endpoints make Stratum usable from CI. For example, `curl localhost:8787/api/rooms/abc/mermaid > docs/architecture.mmd` keeps a repo diagram in sync with the team's live design.

## Diagram-as-code reference

Mermaid (subset of `flowchart`):

```
flowchart LR
  %% @scenario rps=3000 sloP99Ms=400 entry=web
  web([Web App]) --> api[Order API]
  api --> cache[(Redis)]
  api --> db[(Postgres)]
  api -.-> q[[Events]]
  subgraph payments [Payments]
    pay[Payment Service] --> psp((Stripe))
  end
  api --> pay
  %% @node api instances=3 concurrency=100 serviceTimeMs=8
  %% @edge api pay calls=0.2 latencyMs=2
```

Shapes map to component kinds: `([ ])` client, `[( )]` database, `[[ ]]` queue, `(( ))` external, `[/ /]` storage, `{{ }}` gateway, and `[ ]` is inferred from the label (for example "Redis" becomes a cache). `-->` is a synchronous call and `-.->` is asynchronous.

Eraser-style:

```
title Checkout
Web App [icon: browser]
Payments {
  Payment Service [icon: aws-lambda]
  Stripe [icon: stripe]
}
Web App > Order API: place order
Order API > Payment Service > Stripe
Order API --> Events: async
```

`>` is synchronous, `-->` is asynchronous, `<` reverses direction, `<>` is bidirectional, and comma lists fan in or fan out.

## Simulator model and limits

Each component is an M/M/c queue with `c = instances × concurrency` and service rate `1000 / serviceTimeMs`. Arrival rates propagate along edges multiplied by `callsPerRequest`. Cache hit ratios reduce the load that reaches sibling data stores. End-to-end latency is sampled over synchronous paths only, and asynchronous work affects capacity and cost but not request latency. Results are planning estimates, not benchmarks. Real systems have correlated service times, retries, GC pauses and noisy neighbours that a closed-form model ignores. The v2 roadmap replaces this with a discrete-event engine (see `docs/ARCHITECTURE.md`).

## License

MIT, see `LICENSE`.
