# Version 3 test plan (stub)

Status: planning only. No v3 product code is on this branch. The v1 suites and Docker harness in this tree are the executable baseline and must stay green.

Theme: **Simulation you can trust** (H2 2027), from `../../STRATUM_V10_VISION.md`.

## Capabilities to add on this branch

- Rust discrete-event engine compiled to WASM, with native runs for large sweeps.
- Arrival distributions, service-time distributions, timeouts, retries with jitter, circuit breakers and back-pressure.
- Failure injection, multi-region latency matrix and a calibration suite against published benchmarks.

## Test gates to implement

| Area | Test to add | Assertion |
|---|---|---|
| Arrivals | Poisson and bursty sources at the same mean rate | Both converge to the configured mean over a long run |
| Timeouts | A slow dependency exceeds its timeout | The synchronous path aborts and records an error |
| Retries | Retry with jitter fails repeatedly | Attempt count never exceeds the configured maximum |
| Circuit breaker | Failures exceed the threshold, then a cooldown passes | Breaker opens, then moves to half-open |
| Stampede | Cache miss storm scenario | Downstream load rises by the modelled factor |
| Regions | Region failover scenario | Added latency matches the published matrix |
| Parity | DES and the v1 analytical fast estimate on four templates | Results agree within 10% at low utilization |
| Calibration | Twenty reference workloads | Simulated p99 within ±25% of measured p99 |
| Determinism | WASM and native engines, fixed seed | Identical event traces and percentiles |
| Reporting | Injected failure scenario | Report contains SLO impact and recovery time |

The matching `it.todo` cases live in `packages/core/test/version3.contract.test.ts`. Replace each todo with a real test when its capability ships. Trustworthy simulation is the gate before LLM agents gain authority in v4.
