import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratum-rooms-'));
let rooms: typeof import('../src/rooms');

beforeAll(async () => {
  vi.stubEnv('STRATUM_DATA_DIR', dataDir);
  vi.resetModules();
  rooms = await import('../src/rooms');
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: Uint8Array[] = [];

  send(data: Uint8Array) {
    this.sent.push(data);
  }

  emitMessage(data: Uint8Array) {
    this.emit('message', Buffer.from(data), true);
  }
}

const asWs = (socket: FakeSocket) => socket as unknown as WebSocket;
const framed = (type: number, payload: Uint8Array) => {
  const frame = new Uint8Array(payload.length + 1);
  frame[0] = type;
  frame.set(payload, 1);
  return frame;
};

describe('collaboration rooms', () => {
  it('sanitizes room ids and returns an empty snapshot for a new room', () => {
    const snapshot = rooms.roomSnapshot('bad/../id!');
    expect(snapshot.name).toBe('Untitled design');
    expect(snapshot.nodes).toEqual([]);
    expect(rooms.roomStats().some((r) => r.id === 'badid')).toBe(true);
  });

  it('sends the full state on join and relays CRDT updates to peers', () => {
    const a = new FakeSocket();
    const b = new FakeSocket();
    rooms.joinRoom('relay', asWs(a));
    expect(a.sent[0][0]).toBe(rooms.MSG.UPDATE);

    rooms.joinRoom('relay', asWs(b));
    const local = new Y.Doc();
    local.getMap('nodes').set('api', { id: 'api', label: 'API', kind: 'service' });
    a.emitMessage(framed(rooms.MSG.UPDATE, Y.encodeStateAsUpdate(local)));

    expect(b.sent.some((m) => m[0] === rooms.MSG.UPDATE && m.length > 1)).toBe(true);
    expect(rooms.roomSnapshot('relay').nodes).toHaveLength(1);
  });

  it('relays awareness and removes it when a peer disconnects', () => {
    const a = new FakeSocket();
    const b = new FakeSocket();
    rooms.joinRoom('presence', asWs(a));
    rooms.joinRoom('presence', asWs(b));
    const payload = new TextEncoder().encode(JSON.stringify({ clientId: 'client-a', state: { name: 'Ada' } }));
    a.emitMessage(framed(rooms.MSG.AWARENESS, payload));

    expect(b.sent.some((m) => m[0] === rooms.MSG.AWARENESS &&
      new TextDecoder().decode(m.subarray(1)).includes('Ada'))).toBe(true);

    a.emit('close');
    expect(b.sent.some((m) => m[0] === rooms.MSG.AWARENESS_DEL)).toBe(true);
  });

  it('persists a snapshot to disk after the debounce', async () => {
    const socket = new FakeSocket();
    rooms.joinRoom('persist', asWs(socket));
    const local = new Y.Doc();
    local.getMap('meta').set('name', 'Saved');
    socket.emitMessage(framed(rooms.MSG.UPDATE, Y.encodeStateAsUpdate(local)));

    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(fs.existsSync(path.join(dataDir, 'persist.ydoc'))).toBe(true);
    expect(rooms.roomSnapshot('persist').name).toBe('Saved');
  });
});
