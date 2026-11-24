# Stratum Version 10: Product Vision

**From diagramming tool to the system of record for how software is architected**

| | |
|---|---|
| Document type | Long-range product vision (Version 10) |
| Baseline | Stratum v1 MVP (included in this package as `stratum-v1/`) |
| Planning horizon | v1 (late 2026) to v10 (target 2031), with major versions roughly every six months |
| Status | Strategic draft for discussion. Figures are planning targets, not forecasts |

---

## 1. Executive summary

Stratum v1 proves a narrow, defensible idea. If a system design lives as a typed graph instead of as pixels, software can critique it, simulate it and keep it in sync with code. v1 ships that loop end to end: two-way Mermaid and Eraser-style code, five rule-based review agents with a devil's-advocate check, an M/M/c queueing simulator, and real-time CRDT collaboration.

Version 10 extends the same idea until Stratum becomes the place where an engineering organization's architecture is designed, decided, verified against production and governed. The v10 product has four layers:

1. **Design.** A multiplayer canvas and code workspace with branching, merging and review, used by architects, staff engineers, SREs and the AI agents that work beside them.
2. **Reason.** An Architecture Council of specialist agents. They carry organizational memory, debate trade-offs in a structured protocol, cite evidence, and are measured against an evaluation benchmark before every release.
3. **Verify.** A digital twin that combines a discrete-event simulator, replay of real OpenTelemetry traces, failure injection and a cost twin fed by cloud billing data. A design is not "approved" until the twin agrees it meets its SLOs and budget.
4. **Govern and ship.** Policy-as-code, compliance packs, architecture decision records and bidirectional infrastructure-as-code. Approved designs become pull requests, and live cloud drift becomes design diffs.

The v10 promise to a VP of Engineering is simple: every significant architecture change is designed, reviewed, simulated and traceable in one place, and production never silently diverges from the agreed design.

---

## 2. What changes from v1 to v10

| Dimension | v1 (shipping now) | v10 (target state) |
|---|---|---|
| Source of truth | Yjs document per room | Versioned architecture graph per organization, with branches, merges, history and links to repositories, services and cloud accounts |
| Diagram-as-code | Mermaid and Eraser-style, two-way | Every major dialect (Mermaid, Eraser, D2, PlantUML, Structurizr/C4, Terraform, Kubernetes, OpenAPI, AsyncAPI) via a pluggable parser SDK, round-trip safe |
| Critique | 5 rule agents, a devil's advocate and an optional single LLM reviewer | An Architecture Council of 12 or more specialists, an org-memory agent, a moderator, formal debate rounds, calibrated confidence and a published eval benchmark |
| Simulation | Analytical M/M/c with Monte Carlo latency | A discrete-event engine (Rust, WASM and server-side), trace replay, chaos scenarios, multi-region and failover modelling, capacity forecasting |
| Cost | Instance-hour estimate | A cost twin using real billing exports, reserved and spot pricing, unit economics per request, tenant and feature |
| Collaboration | Live cursors and presence, shared rooms | Branches, change requests, async review threads, meeting mode with voice-to-diagram, follow-the-presenter, and AI participants with visible presence |
| Output | Exported text files | Generated pull requests (IaC, service scaffolds, ADRs, runbooks), CI checks and drift alerts |
| Governance | None | Policy-as-code, compliance packs, approval workflows, an immutable audit log, and an architecture inventory with ownership |
| Deployment | Single Node server | Multi-region SaaS, single-tenant, self-hosted and air-gapped, with bring-your-own model |
| Ecosystem | Built-in templates | A marketplace of component packs, agents, policies, simulation models and dialect plugins, with revenue share |

---

## 3. Version timeline, v1 to v10

Each major version has one theme, a set of headline capabilities and a gating metric that must be met before the next version starts. Dates assume a release about every six months.

| Version | Target | Theme | Headline capabilities | Gate to next version |
|---|---|---|---|---|
| **v1** | Late 2026 | Prove the loop | Canvas with Mermaid and Eraser two-way sync, 5 rule agents, devil's advocate, M/M/c simulator, Yjs rooms, prompt to diagram, templates | 40% of new users run a critique in their first session, and 25% return in week 2 |
| **v2** | H1 2027 | Team-ready | Accounts, workspaces, SSO (WorkOS), RBAC, Postgres/S3 persistence, Hocuspocus, ELK layout, group containers, comments, version history, Stripe billing | 300 paying teams, and 30-day team retention above 70% |
| **v3** | H2 2027 | Simulation you can trust | Rust discrete-event engine in WASM, arrival distributions, timeouts, retries, circuit breakers, failure injection, multi-region latency matrix, a calibration suite against published benchmarks | Simulated p99 within ±25% of measured p99 on 20 reference workloads |
| **v4** | H1 2028 | Agents with judgment | LLM specialist agents with tool use (simulator, pricing, docs), a structured debate protocol, calibrated confidence, the StratumBench eval suite, and per-finding citations | Fix acceptance rate above 45%, and false-positive rate below 10% on StratumBench |
| **v5** | H2 2028 | Design meets code | D2, PlantUML, C4 and OpenAPI dialects, a GitHub/GitLab app, architecture-as-code in repos, CI checks ("this PR violates the approved design"), ADR generation | 35% of Team workspaces connect a repository |
| **v6** | H1 2029 | Reality sync | Read-only cloud import (AWS, GCP, Azure, Kubernetes), drift detection, OpenTelemetry service-map import, and trace replay into the simulator | 50% of Enterprise accounts connect at least one production environment |
| **v7** | H2 2029 | Governance | A policy-as-code engine (CEL/Rego), compliance packs (SOC 2, ISO 27001, HIPAA, PCI DSS, GDPR, India DPDP), approval workflows, an audit log and an architecture inventory | First 25 enterprises run their formal architecture review board inside Stratum |
| **v8** | H1 2030 | Design to production | Terraform, Pulumi, CDK and Helm generation as pull requests, service scaffolds, runbook and SLO generation, and safe bidirectional IaC sync | 20% of approved designs ship through a Stratum-generated pull request |
| **v9** | H2 2030 | Ecosystem | A marketplace (component packs, agents, policies, sim models, dialects), public API and SDK, partner integrations (Datadog, Backstage, PagerDuty, Jira, Linear), revenue share | 500 published marketplace items, and 15% of revenue influenced by marketplace items |
| **v10** | 2031 | Architecture system of record | Living architecture graph, the Architecture Council, a continuous verification twin, the governance plane, autonomous change proposals, and self-hosted and air-gapped editions | See section 9 |

The order matters. Trustworthy simulation (v3) comes before LLM agents get real authority (v4), because agents that cite a calibrated simulator are believable and agents that cite only themselves are not. Reality sync (v6) comes before generating infrastructure (v8), because you should not write to production systems you cannot yet read accurately.

---

## 4. Version 10 product pillars

### 4.1 Living architecture graph

The v1 Stratum Graph Model (SGM) grows into an organization-wide graph.

- **Entities.** The graph holds services, data stores, queues, external dependencies, teams, owners, SLOs, data classifications, cost centres, regions and environments. Each component links to its repository, deploy target, dashboards and runbooks.
- **Branches and change requests.** Designs branch and merge in a git-like way. A change request shows a semantic diff ("adds a synchronous dependency from Checkout to Fraud Scoring, so p99 rises by an estimated 38 ms"), not a pixel diff.
- **Views, not copies.** C4 context, container and component views, data-flow views, threat-model views and cost views are all projections of one graph, so they cannot disagree.
- **Time travel.** You can view the architecture as it was at any date, as it is in production now (from reality sync), or as it is planned for next quarter.

### 4.2 The Architecture Council (multi-agent critique, evolved)

v1's five rule agents become a council of specialists with a moderator and explicit rules of engagement.

| Seat | Focus | Primary tools |
|---|---|---|
| Moderator | Plans the review, assigns seats, runs debate rounds, writes the verdict | Graph query, review history |
| Scalability | Saturation, fan-out, hot keys, partitioning | Digital twin, load models |
| Reliability (SRE) | SPOFs, blast radius, retries, timeouts, failover | Twin failure injection, incident history |
| Security | Trust boundaries, authN/Z, secrets, supply chain | Threat-model templates, CVE feeds |
| Privacy and compliance | PII flows, residency, retention, lawful basis | Data classification, policy packs |
| Data consistency | Transactions, outbox, idempotency, ordering | Pattern library |
| Cost and FinOps | Unit economics, commitments, waste | Cost twin, billing data |
| Performance | Latency budgets, critical path, caching | Twin trace replay |
| Operability | Observability, on-call load, runbooks | OpenTelemetry, incident data |
| Evolvability | Coupling, team topology, migration paths | Repo and ownership graph |
| Sustainability | Carbon intensity per region and workload | Grid carbon data |
| Org memory | "We tried this in 2028, see ADR-114" | ADRs, past reviews, postmortems |
| Devil's advocate | Challenges every high-severity finding before it reaches a human | All of the above |

How it works:

1. **Evidence or it did not happen.** Every finding must cite at least one verifiable artifact: a twin run, a policy rule, an ADR, a trace, a pricing record or a documentation link. Findings without evidence are shown as hypotheses and do not count toward the score. This generalizes v1's rule that LLM findings referencing unknown components are rejected.
2. **Structured debate.** For contested findings the moderator runs up to three rounds of claim, rebuttal and test. The test step is concrete: the twin re-runs the scenario with the proposed fix and both outcomes are shown.
3. **Calibrated confidence.** Each seat's confidence is calibrated against its historical acceptance rate in this organization, so "80% confident" means it is right about 80% of the time.
4. **StratumBench.** This is a public benchmark of about 1,000 designs with labelled flaws, drawn from postmortems, textbook failures and seeded mutations. Every model or prompt change must not regress precision or recall on it. Results are published with each release.
5. **Humans decide.** Agents propose and humans approve. Org admins set which classes of fix may be auto-applied (for example "add a DLQ to any queue without one") and which always need a named approver.

### 4.3 Continuous verification twin (simulation, evolved)

- **Discrete-event engine.** This is a Rust core compiled to WASM for interactive runs in the browser and run natively for large server-side sweeps. It models arrival processes (Poisson, bursty, diurnal), service-time distributions, connection pools, timeouts, retries with jitter, circuit breakers, autoscaling lag, cold starts and back-pressure.
- **Trace replay.** You import an hour of OpenTelemetry traces, fit per-span service-time distributions, and replay real traffic at 1x, 3x or 10x against a proposed design.
- **Failure scenarios.** You can test a zone loss, a region failover, a dependency brownout, a cache stampede, a thundering herd after a deploy, or a 30-minute slowdown at a third-party provider. Each scenario reports SLO impact, error budget burn and recovery time.
- **Cost twin.** It ingests billing exports and pricing APIs, then models on-demand, reserved, savings-plan and spot pricing. It reports cost per request, per tenant and per feature, and forecasts cost at the next growth milestone.
- **Continuous verification.** Approved designs have twin assertions ("p99 under 250 ms at 3x peak", "survives one-zone loss", "under $0.40 per 1,000 orders"). These run in CI on every change request and nightly against reality-synced production data, and they alert when a drift breaks an assertion.
- **Honest uncertainty.** Every result shows a confidence band and the calibration status of the inputs. Assumed values are visually distinct from measured ones.

### 4.4 Design to production

- **Bidirectional IaC.** Stratum generates Terraform, Pulumi, CDK, Helm or Crossplane from approved designs as reviewable pull requests, and imports existing IaC back into the graph. It never applies changes directly. Changes always go through the customer's existing pipeline.
- **Scaffolds and contracts.** It generates service skeletons, OpenAPI and AsyncAPI contracts, client SDK stubs, SLO definitions, dashboards and alert rules from the design.
- **Architecture decision records.** Every approved change request emits an ADR with context, options considered, council findings, twin evidence and the decision, linked from the graph.
- **Drift detection.** Live cloud and Kubernetes state is compared against the approved design. Each drift is classified as expected (in an approved change), benign, or a violation, and violations open a change request or an alert.

### 4.5 Governance plane

- **Policy-as-code** in CEL or Rego, with a visual editor. Example: "Any store tagged `pii` must be encrypted, in an approved region, and reachable only through a gateway with authentication."
- **Compliance packs** for SOC 2, ISO 27001, HIPAA, PCI DSS, GDPR and India's DPDP Act. Each maps controls to graph checks and produces auditor-ready evidence exports.
- **Review workflows**, with configurable architecture review boards, required approvers by risk tier, SLAs and escalation.
- **Immutable audit log** of every design change, agent action, approval and export.
- **Architecture inventory**, a searchable catalogue of every service, dependency and data flow with its owner. It integrates with Backstage and existing CMDBs.

### 4.6 Collaboration, evolved

- **Meeting mode.** You talk through a design and Stratum drafts it live from speech, with a visible "AI is editing" presence and a one-click revert of anything it did.
- **Async reviews.** These work like code review: threaded comments anchored to components, suggested changes, and "request changes" or "approve".
- **AI teammates as participants.** Council agents appear in presence, can be @-mentioned on a component ("@reliability what happens if this queue backs up?") and answer with linked twin runs.
- **Scale targets.** 100 concurrent editors per design and 50,000 components per organization graph, with p95 under 100 ms for local operations.

### 4.7 Ecosystem and platform

- **Marketplace.** It offers component packs (for example "AWS serverless", "Kafka at scale", "Indian UPI payments"), agent seats, policy packs, simulation models (calibrated profiles for popular databases and brokers) and dialect plugins. Creators get a 70/30 revenue share.
- **Public API and SDK** to read and write the graph, run critiques and twin scenarios, and subscribe to events. This lets platform teams build internal tools on top of Stratum.
- **Integrations** with GitHub, GitLab, Bitbucket, AWS, GCP, Azure, Kubernetes, Datadog, Grafana, Honeycomb, PagerDuty, Backstage, Jira, Linear, Slack, Teams, Confluence and Notion.

### 4.8 Deployment and trust

- **Editions.** Multi-region SaaS (US, EU, India), single-tenant SaaS, self-hosted on Kubernetes, and air-gapped with bundled open-weight models.
- **Bring your own model.** Supported options are OpenAI-compatible endpoints, Azure OpenAI, AWS Bedrock, Vertex AI and local inference. No customer data is used to train shared models. A per-organization memory store is isolated and deletable.
- **Certifications by v10:** SOC 2 Type II, ISO 27001 and ISO 42001 (AI management), with HIPAA BAA available.

---

## 5. Target users at v10

| Persona | v1 relationship | v10 relationship |
|---|---|---|
| **Senior or staff engineer** (the v1 primary persona) | Sketches and stress-tests designs | Owns change requests, debates the Council, ships via generated pull requests |
| **Engineering manager or tech lead** | Reviews shared links | Runs design reviews, tracks decisions and ownership |
| **SRE or platform engineer** | Occasional simulator user | Primary user of the twin, failure scenarios and drift detection |
| **Principal architect or ARB chair** | Not served | Runs the architecture review board, owns policies and standards |
| **Security and compliance lead** | Not served | Owns policy packs and audit evidence |
| **FinOps lead** | Not served | Uses the cost twin for forecasts and unit economics |
| **VP Engineering or CTO** | Not served | Architecture health dashboard, risk register and investment planning |
| **Students and interview candidates** | Free tier learners | Free tier remains, as the top of the funnel and future champions |

---

## 6. v10 platform architecture

```
┌───────────────────────────── Clients ─────────────────────────────────┐
│ Web app (React, WebGPU canvas) · Desktop (Tauri) · VS Code / JetBrains │
│ CLI · CI action · Slack/Teams apps · Public API & SDKs                 │
└───────────────┬───────────────────────────────┬───────────────────────┘
                │ CRDT sync (Yjs, Hocuspocus)    │ REST / GraphQL / events
┌───────────────▼───────────────┐  ┌────────────▼──────────────────────────┐
│ Collaboration tier            │  │ API gateway · AuthN (WorkOS) · RBAC   │
│ room shards, presence, branch │  │ rate limits · tenant routing          │
└───────────────┬───────────────┘  └────────────┬──────────────────────────┘
                │                               │
┌───────────────▼───────────────────────────────▼───────────────────────┐
│ Architecture Graph Service (versioned SGM, branches, semantic diff)    │
│ Postgres (metadata) · S3 (snapshots) · graph index · event log         │
└──┬────────────┬─────────────┬──────────────┬─────────────┬────────────┘
   │            │             │              │             │
┌──▼───────┐ ┌──▼─────────┐ ┌─▼──────────┐ ┌─▼─────────┐ ┌─▼────────────┐
│ Council  │ │ Twin       │ │ Governance │ │ Codegen & │ │ Reality sync │
│ moderator│ │ DES (Rust) │ │ policy eng.│ │ IaC sync  │ │ cloud/K8s/   │
│ + seats  │ │ trace      │ │ compliance │ │ PR bot,   │ │ OTel import, │
│ eval gate│ │ replay,    │ │ workflows, │ │ ADR gen   │ │ drift engine │
│ org mem. │ │ cost twin  │ │ audit log  │ │           │ │              │
└──┬───────┘ └──┬─────────┘ └────────────┘ └───────────┘ └──────────────┘
   │            │
┌──▼────────────▼────────────────────────────────────────────────────────┐
│ Shared runtime: Temporal workflows · model router (BYO model) ·         │
│ vector + org memory store · ClickHouse (telemetry, twin results) ·      │
│ Redis · object storage · secrets/KMS · per-region data planes           │
└─────────────────────────────────────────────────────────────────────────┘
```

### How v1 modules evolve

| v1 module (in `stratum-v1/`) | v10 descendant |
|---|---|
| `packages/core/src/sgm.ts` | Architecture Graph Service schema (SGM v10), with a backward-compatible importer for v1 JSON |
| `packages/core/src/dsl/*` | Dialect plugin SDK. Mermaid and Eraser remain first-party plugins |
| `packages/core/src/sim/analytical.ts` | The "fast estimate" mode of the twin, still used for instant feedback while the DES runs in the background |
| `packages/core/src/critique/agents.ts` | Deterministic "rule seats" inside the Council, used as low-cost first-pass reviewers and as regression oracles for StratumBench |
| `packages/core/src/critique/patch.ts` | The change-request engine. `PatchOp` becomes the semantic diff format |
| `packages/core/src/llm.ts` validation | The Council evidence gate (no citation means no score impact) |
| `apps/server/src/rooms.ts` | Sharded collaboration tier on Hocuspocus with Redis fan-out |
| `apps/web` | Web client, with the canvas renderer migrated to WebGPU for 50,000-node graphs |

---

## 7. Pricing and packaging at v10

v1 launched with Free, Pro ($15 monthly when billed annually, $19 monthly), Team ($29 or $36) and Enterprise (from about $45). v10 keeps seat-based simplicity for individuals and teams, and adds platform pricing for organizations that run governance and the twin at scale.

| Plan | Who | Price (planning) | Includes |
|---|---|---|---|
| **Free** | Students, individuals | $0 | 5 designs, quick critique, analytical simulator, Mermaid and Eraser |
| **Pro** | Individual engineers | $19 per user per month | Unlimited designs, Council (standard seats), DES twin (interactive), all dialects |
| **Team** | Product teams | $39 per user per month | Branches and change requests, repo integration, CI checks, ADRs, shared org memory |
| **Business** | Platform and multi-team orgs | $69 per user per month | Reality sync, drift detection, trace replay, IaC pull requests, policy-as-code (standard packs) |
| **Enterprise** | Regulated and large orgs | Custom (typically $150K to $1M+ per year) | Compliance packs, ARB workflows, audit log, single-tenant or self-hosted, BYO model, SLA, support |
| **Usage add-ons** | All paid plans | Metered | Twin compute (large sweeps, trace replay hours), premium Council seats, marketplace items |

Pricing principles:

1. Seats pay for collaboration, and usage pays for compute. Heavy simulation and agent work is metered so that light users are not subsidizing heavy ones.
2. Governance, compliance and deployment options are the enterprise differentiators. Core design quality is never paywalled behind Enterprise.
3. Free stays generous for students and interview preparation, because they become the champions who bring Stratum into their companies.

---

## 8. Business model at v10 (illustrative targets)

These are planning targets used to size the investment, not forecasts.

| Metric | v1 plan (month 12) | v10 target (2031) |
|---|---|---|
| ARR | About $0.6M | $60M to $80M |
| Paying organizations | About 600 | 9,000 or more |
| Enterprise accounts (> $100K ACV) | 0 | 150 or more |
| Revenue mix (seats / usage / marketplace) | 100 / 0 / 0 | 65 / 25 / 10 |
| Net revenue retention | n/a | 125% or more |
| Gross margin | About 75% | 78% or more, with AI and compute cost under 15% of revenue |
| Free-to-paid conversion | 3% to 4% | 5% or more |

Growth comes from the same bottom-up loop v1 relies on (engineers adopt Free and Pro, teams upgrade to share and review), extended with a top-down motion from v6 onward. Once reality sync and governance exist, platform, security and FinOps leaders have budget reasons to buy.

---

## 9. Success metrics for v10

**North star:** the share of an organization's production architecture changes that were designed, reviewed and verified in Stratum before shipping. The target is 60% or more in Business and Enterprise accounts.

| Area | Metric | v10 target |
|---|---|---|
| Council quality | Precision and recall on StratumBench | ≥ 0.85 precision, ≥ 0.75 recall |
| Council usefulness | Share of findings accepted or acted on | ≥ 50% |
| Twin accuracy | Simulated vs. measured p99 on customer replays | Within ±15% for 80% of runs |
| Prevention | Customer-reported incidents traced to a flaw Stratum flagged but nobody acted on, vs. one it missed | Ratio published quarterly, with missed flaws decreasing every release |
| Drift | Median time from production drift to a detected and classified change | < 1 hour |
| Delivery | Approved designs shipped via a generated pull request | ≥ 30% |
| Governance | Enterprise ARBs run in Stratum | ≥ 70% of Enterprise accounts |
| Collaboration | p95 local operation latency at 100 concurrent editors | < 100 ms |
| Trust | AI actions reverted by humans | < 5%, and trending down |

---

## 10. Risks and how v10 addresses them

| Risk | Mitigation |
|---|---|
| **Hallucinated critique erodes trust** | Evidence-gated findings, a devil's-advocate seat, calibrated confidence, the public StratumBench and human approval by default |
| **Simulation is precise but wrong** | Calibration against measured traces, visible confidence bands, distinct styling for assumed and measured inputs, and the fast analytical model kept as a sanity check |
| **Write access to infrastructure is dangerous** | No direct applies. Everything goes through pull requests in the customer's pipeline. Read-only cloud roles by default, and scoped, audited credentials |
| **Platform incumbents bundle "good enough" diagramming plus AI** | Win on depth they will not build: twin accuracy, Council quality, governance and bidirectional IaC. Interoperate with their formats instead of fighting them |
| **AI cost grows faster than revenue** | A model router (small models for rule-like checks, frontier models only for debate), caching of findings per graph hash, metered usage add-ons, and BYO model for Enterprise |
| **Data sensitivity (architecture maps are a security asset)** | Regional data planes, single-tenant and air-gapped editions, customer-managed keys, an isolated and deletable org memory, and no training on customer data |
| **Scope creep into a generic developer portal** | Stay anchored on architecture decisions and verification. Integrate with Backstage and CMDBs rather than replacing them |

---

## 11. What Stratum v10 will deliberately not do

- Deploy or mutate production infrastructure directly. Pull requests only.
- Replace observability tools. Stratum consumes telemetry and links to dashboards, it does not store raw logs.
- Replace general-purpose whiteboards. Freeform drawing stays minimal, and the canvas is for typed architecture.
- Let agents approve their own changes. Every approval is attributable to a human or a human-authored policy.

---

## 12. Next steps from v1

1. Ship v1 to design partners and instrument the gating metric (critique run in first session, week-2 return).
2. Start StratumBench now, seeding it with the flaws the v1 rule agents already detect plus 100 postmortem-derived cases, so agent quality is measurable before LLM agents gain authority in v4.
3. Prototype the Rust discrete-event engine against the v1 analytical simulator's outputs on the four built-in templates, to establish the calibration harness that v3 depends on.
4. Freeze the SGM v1 JSON schema and publish an importer contract, so every design created in v1 opens in v10.
