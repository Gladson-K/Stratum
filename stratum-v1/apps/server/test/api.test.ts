import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadTemplate } from '@stratum/core';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratum-api-'));
let server: Server;
let base: string;

beforeAll(async () => {
  vi.stubEnv('STRATUM_DATA_DIR', dataDir);
  vi.stubEnv('STRATUM_LLM_API_KEY', '');
  const { createServer } = await import('../src/index');
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const post = (route: string, body: unknown) => fetch(`${base}${route}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('HTTP API', () => {
  it('reports health without an LLM key', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: '1.0.0', llm: false });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('lists the four built-in templates', async () => {
    const body = await (await fetch(`${base}/api/templates`)).json() as { id: string }[];
    expect(body.map((t) => t.id)).toEqual([
      'url-shortener', 'notification-service', 'ecommerce-checkout', 'chat-app',
    ]);
  });

  it('serves room snapshot, Mermaid and Eraser text', async () => {
    const snap = await (await fetch(`${base}/api/rooms/demo-1/snapshot`)).json() as { name: string };
    expect(snap.name).toBe('Untitled design');
    const mermaid = await (await fetch(`${base}/api/rooms/demo-1/mermaid`)).text();
    expect(mermaid).toContain('flowchart LR');
    const eraser = await (await fetch(`${base}/api/rooms/demo-1/eraser`)).text();
    expect(eraser).toContain('title Untitled design');
  });

  it('simulates a design and rejects malformed input', async () => {
    const design = loadTemplate('url-shortener');
    const ok = await post('/api/simulate', { design, samples: 200 });
    expect(ok.status).toBe(200);
    expect((await ok.json() as { rps: number }).rps).toBe(design.scenario.rps);
    expect((await post('/api/simulate', { design: { nodes: [] } })).status).toBe(400);
  });

  it('critiques, filters dismissed findings and validates designs', async () => {
    const design = loadTemplate('notification-service');
    const res = await post('/api/critique', { design, mode: 'deep', useLlm: false });
    const report = await res.json() as { findings: { key: string }[]; agentsRun: string[]; score: number };
    expect(res.status).toBe(200);
    expect(report.agentsRun).toContain('devils_advocate');
    expect(report.agentsRun).not.toContain('llm');
    expect(report.score).toBeLessThanOrEqual(100);

    const filtered = await (await post('/api/critique', {
      design, mode: 'deep', dismissed: ['spof:prefs'],
    })).json() as { findings: { key: string }[] };
    expect(filtered.findings.map((f) => f.key)).not.toContain('spof:prefs');

    const invalid = await post('/api/critique', {
      design: {
        name: 'invalid', groups: [], scenario: {},
        nodes: [{ id: 'a', label: 'A', kind: 'service' }, { id: 'a', label: 'B', kind: 'service' }], edges: [],
      },
    });
    expect(invalid.status).toBe(422);
  });

  it('generates designs offline and rejects empty prompts', async () => {
    const res = await post('/api/generate', { prompt: 'chat app at 20k rps' });
    const body = await res.json() as { source: string; design: { scenario: { rps: number } } };
    expect(body.source).toBe('offline');
    expect(body.design.scenario.rps).toBe(20000);
    expect((await post('/api/generate', { prompt: '   ' })).status).toBe(400);
  });

  it('answers CORS preflight and returns 404 for unknown routes', async () => {
    const preflight = await fetch(`${base}/api/health`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });
});
