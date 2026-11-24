import * as Y from 'yjs';
import type { Design, SEdge, SNode, SGroup } from '@stratum/core';

/**
 * Real-time collaboration client.
 * The Y.Doc is the source of truth for the shared design:
 *   meta:   Y.Map  { name, scenario }
 *   nodes:  Y.Map  id -> SNode (plain JSON)
 *   edges:  Y.Map  id -> SEdge
 *   groups: Y.Map  id -> SGroup
 * Concurrent edits to different nodes merge; edits to the same node converge
 * deterministically (CRDT last-writer-wins per key).
 */

const MSG = { UPDATE: 0, AWARENESS: 1, AWARENESS_DEL: 2 } as const;

export interface Presence {
  name: string;
  color: string;
  cursor?: { x: number; y: number } | null;
  selected?: string | null;
}

export type ConnStatus = 'connecting' | 'online' | 'offline';

const COLORS = ['#f97316', '#22c55e', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#f43f5e', '#6366f1'];
const ANIMALS = ['Otter', 'Falcon', 'Lynx', 'Heron', 'Orca', 'Ibex', 'Koala', 'Puma', 'Raven', 'Gecko'];

export function randomIdentity(): Presence {
  const saved = localStorage.getItem('stratum:identity');
  if (saved) try { return JSON.parse(saved); } catch { /* ignore */ }
  const id = { name: `${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]} ${Math.floor(Math.random() * 90 + 10)}`, color: COLORS[Math.floor(Math.random() * COLORS.length)] };
  localStorage.setItem('stratum:identity', JSON.stringify(id));
  return id;
}

export class CollabClient {
  readonly doc = new Y.Doc();
  readonly clientId = String(this.doc.clientID);
  readonly peers = new Map<string, Presence>();
  status: ConnStatus = 'connecting';
  private ws?: WebSocket;
  private retry = 0;
  private closed = false;
  private listeners = new Set<() => void>();
  private local: Presence;
  private synced = false;

  constructor(private room: string, identity: Presence) {
    this.local = identity;
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote' && this.ws?.readyState === WebSocket.OPEN) this.send(MSG.UPDATE, update);
      this.emit();
    });
    this.connect();
  }

  get nodes() { return this.doc.getMap<SNode>('nodes'); }
  get edges() { return this.doc.getMap<SEdge>('edges'); }
  get groups() { return this.doc.getMap<SGroup>('groups'); }
  get meta() { return this.doc.getMap<unknown>('meta'); }
  get isSynced() { return this.synced; }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const l of this.listeners) l(); }

  private connect() {
    if (this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const base = (import.meta.env.VITE_STRATUM_WS as string | undefined) ?? `${proto}://${location.host}`;
    let ws: WebSocket;
    try { ws = new WebSocket(`${base}/collab/${this.room}`); } catch { this.scheduleReconnect(); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.status = 'connecting';
    this.emit();
    ws.onopen = () => {
      this.retry = 0;
      this.status = 'online';
      // push our full state so offline edits merge, then announce presence
      this.send(MSG.UPDATE, Y.encodeStateAsUpdate(this.doc));
      this.setPresence({});
      this.emit();
    };
    ws.onmessage = (ev) => {
      const buf = new Uint8Array(ev.data as ArrayBuffer);
      const type = buf[0];
      const payload = buf.subarray(1);
      if (type === MSG.UPDATE) {
        Y.applyUpdate(this.doc, payload, 'remote');
        this.synced = true;
        this.emit();
      } else if (type === MSG.AWARENESS) {
        const { clientId, state } = JSON.parse(new TextDecoder().decode(payload));
        if (clientId !== this.clientId) { this.peers.set(String(clientId), state); this.emit(); }
      } else if (type === MSG.AWARENESS_DEL) {
        const { clientId } = JSON.parse(new TextDecoder().decode(payload));
        this.peers.delete(String(clientId));
        this.emit();
      }
    };
    ws.onclose = () => { this.status = 'offline'; this.peers.clear(); this.emit(); this.scheduleReconnect(); };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    if (this.closed) return;
    const delay = Math.min(10_000, 500 * 2 ** this.retry++);
    setTimeout(() => this.connect(), delay);
  }

  private send(type: number, payload: Uint8Array) {
    const out = new Uint8Array(payload.length + 1);
    out[0] = type;
    out.set(payload, 1);
    this.ws?.send(out);
  }

  setPresence(patch: Partial<Presence>) {
    this.local = { ...this.local, ...patch };
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send(MSG.AWARENESS, new TextEncoder().encode(JSON.stringify({ clientId: this.clientId, state: this.local })));
    }
  }

  get presence() { return this.local; }

  destroy() { this.closed = true; this.ws?.close(); this.doc.destroy(); }

  // ---------------------------------------------------------------- design API
  snapshot(): Design {
    return {
      name: (this.meta.get('name') as string) ?? 'Untitled design',
      scenario: (this.meta.get('scenario') as Design['scenario']) ?? { rps: 1000, sloP99Ms: 300 },
      groups: [...this.groups.values()],
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
    };
  }

  isEmpty() { return this.nodes.size === 0 && !this.meta.get('name'); }

  /** Replace the shared design with minimal diffs, as one undoable transaction. */
  replace(d: Design) {
    this.doc.transact(() => {
      if (this.meta.get('name') !== d.name) this.meta.set('name', d.name);
      if (JSON.stringify(this.meta.get('scenario')) !== JSON.stringify(d.scenario)) this.meta.set('scenario', d.scenario);
      syncMap(this.nodes, d.nodes);
      syncMap(this.edges, d.edges);
      syncMap(this.groups, d.groups);
    });
  }

  setNode(n: SNode) { this.doc.transact(() => this.nodes.set(n.id, n)); }
  removeNode(id: string) {
    this.doc.transact(() => {
      this.nodes.delete(id);
      for (const [eid, e] of this.edges) if (e.source === id || e.target === id) this.edges.delete(eid);
    });
  }
  setEdge(e: SEdge) { this.doc.transact(() => this.edges.set(e.id, e)); }
  removeEdge(id: string) { this.doc.transact(() => this.edges.delete(id)); }
  setName(name: string) { this.meta.set('name', name); }
  setScenario(s: Design['scenario']) { this.meta.set('scenario', s); }
}

function syncMap<T extends { id: string }>(map: Y.Map<T>, items: T[]) {
  const next = new Map(items.map((x) => [x.id, x]));
  for (const key of [...map.keys()]) if (!next.has(key)) map.delete(key);
  for (const [id, item] of next) {
    const prev = map.get(id);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(item)) map.set(id, item);
  }
}
