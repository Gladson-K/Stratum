import { describe, it } from 'vitest';

describe('v2 team-ready contracts (planned)', () => {
  it.todo('SSO callback rejects an invalid state and an unbound email');
  it.todo('a viewer cannot edit a room while an editor can');
  it.todo('signed room tokens expire and cannot be replayed');
  it.todo('a Postgres room snapshot survives a server restart');
  it.todo('an S3 snapshot is written on debounce and restored on cold start');
  it.todo('the Hocuspocus relay fans an update out to every workspace member');
  it.todo('version history lists revisions and restores an older design');
  it.todo('comments anchor only to existing node ids');
  it.todo('a Stripe webhook verifies its signature before provisioning seats');
  it.todo('ELK layout keeps group containers non-overlapping');
});
