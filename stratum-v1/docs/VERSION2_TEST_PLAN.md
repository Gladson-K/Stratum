# Version 2 test plan (stub)

Status: planning only. No v2 product code is on this branch. The v1 suites and Docker harness in this tree are the executable baseline and must stay green.

Theme: **Team-ready** (H1 2027), from `../../STRATUM_V10_VISION.md`.

## Capabilities to add on this branch

- Accounts, workspaces, SSO (WorkOS) and RBAC.
- Postgres metadata and S3 document snapshots; Hocuspocus relay with auth hooks.
- Version history, comments, group containers, ELK layout and Stripe billing.

## Test gates to implement

| Area | Test to add | Assertion |
|---|---|---|
| Auth | SSO callback rejects an invalid `state` or unbound email | No session is created |
| Auth | Viewer cannot edit a room; editor can | RBAC middleware returns 403 / 200 |
| Rooms | Signed room tokens expire and cannot be replayed | Expired or reused token is rejected |
| Persistence | Postgres snapshot survives a server restart | Room design is identical after restart |
| Persistence | S3 snapshot is written after the debounce and restored on cold start | Stored bytes match the Yjs update |
| Collaboration | Hocuspocus relay fans an update out to all workspace members | Every member receives the update once |
| History | Version history lists revisions and restores an older design | Restored design equals the selected revision |
| Comments | Anchors must reference an existing node id | Unknown anchors are rejected |
| Billing | Stripe webhook verifies its signature before provisioning seats | Invalid signature changes no seats |
| Layout | ELK layout keeps group containers non-overlapping | No two group boxes intersect |

The matching `it.todo` cases live in `packages/core/test/version2.contract.test.ts`. Replace each todo with a real test when its capability ships.
