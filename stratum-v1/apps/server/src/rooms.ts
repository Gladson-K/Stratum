import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import type { WebSocket } from 'ws';
import type { Design } from '@stratum/core';

/**
 * Collaboration rooms. Each room holds an authoritative Y.Doc (CRDT), relays
 * updates between clients, relays presence (awareness), and persists the
 * document to disk with a debounce.
 *
 * Wire protocol (binary frames, first byte = message type):
 *   0 SYNC_UPDATE   payload = Yjs update            (both directions)
 *   1 AWARENESS     payload = UTF-8 JSON {clientId, state}  (both directions)
 *   2 AWARENESS_DEL payload = UTF-8 JSON {clientId}         (server → client)
 */
export const MSG = { UPDATE: 0, AWARENESS: 1, AWARENESS_DEL: 2 } as const;

interface Client { ws: WebSocket; clientId?: string }
interface Room { id: string; doc: Y.Doc; clients: Set<Client>; awareness: Map<string, unknown>; saveTimer?: NodeJS.Timeout }

const rooms = new Map<string, Room>();
const DATA_DIR = path.resolve(process.env.STRATUM_DATA_DIR ?? 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'default';
const fileFor = (id: string) => path.join(DATA_DIR, `${safeId(id)}.ydoc`);

function frame(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 1);
  out[0] = type;
  out.set(payload, 1);
  return out;
}

export function getRoom(id: string): Room {
  const rid = safeId(id);
  let room = rooms.get(rid);
  if (room) return room;
  const doc = new Y.Doc();
  const file = fileFor(rid);
  if (fs.existsSync(file)) {
    try { Y.applyUpdate(doc, new Uint8Array(fs.readFileSync(file))); } catch (e) { console.warn(`[rooms] could not load ${file}:`, e); }
  }
  room = { id: rid, doc, clients: new Set(), awareness: new Map() };
  const r = room;
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    const msg = frame(MSG.UPDATE, update);
    for (const c of r.clients) if (c !== origin && c.ws.readyState === 1) c.ws.send(msg);
    clearTimeout(r.saveTimer);
    r.saveTimer = setTimeout(() => fs.writeFile(file, Y.encodeStateAsUpdate(doc), () => {}), 1000);
  });
  rooms.set(rid, room);
  return room;
}

export function joinRoom(id: string, ws: WebSocket) {
  const room = getRoom(id);
  const client: Client = { ws };
  room.clients.add(client);
  // initial state + current presence
  ws.send(frame(MSG.UPDATE, Y.encodeStateAsUpdate(room.doc)));
  for (const [clientId, state] of room.awareness) {
    ws.send(frame(MSG.AWARENESS, new TextEncoder().encode(JSON.stringify({ clientId, state }))));
  }
  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (!isBinary || data.length < 1) return;
    const buf = new Uint8Array(data);
    const type = buf[0];
    const payload = buf.subarray(1);
    if (type === MSG.UPDATE) {
      try { Y.applyUpdate(room.doc, payload, client); } catch (e) { console.warn('[rooms] bad update', e); }
    } else if (type === MSG.AWARENESS) {
      try {
        const { clientId, state } = JSON.parse(new TextDecoder().decode(payload));
        client.clientId = String(clientId);
        room.awareness.set(client.clientId, state);
        const msg = frame(MSG.AWARENESS, payload);
        for (const c of room.clients) if (c !== client && c.ws.readyState === 1) c.ws.send(msg);
      } catch { /* ignore */ }
    }
  });
  ws.on('close', () => {
    room.clients.delete(client);
    if (client.clientId) {
      room.awareness.delete(client.clientId);
      const msg = frame(MSG.AWARENESS_DEL, new TextEncoder().encode(JSON.stringify({ clientId: client.clientId })));
      for (const c of room.clients) if (c.ws.readyState === 1) c.ws.send(msg);
    }
  });
}

/** Read a plain Design snapshot from a room's CRDT document. */
export function roomSnapshot(id: string): Design {
  const doc = getRoom(id).doc;
  const meta = doc.getMap('meta');
  return {
    name: (meta.get('name') as string) ?? 'Untitled design',
    scenario: (meta.get('scenario') as Design['scenario']) ?? { rps: 1000 },
    groups: [...doc.getMap('groups').values()] as Design['groups'],
    nodes: [...doc.getMap('nodes').values()] as Design['nodes'],
    edges: [...doc.getMap('edges').values()] as Design['edges'],
  };
}

export function roomStats() {
  return [...rooms.values()].map((r) => ({ id: r.id, clients: r.clients.size, nodes: r.doc.getMap('nodes').size }));
}
