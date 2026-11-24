import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  runCritique, simulate, generateFromPrompt, buildCritiquePrompt, parseLlmFindings,
  validateDesign, autoLayout, TEMPLATES, emitMermaid, emitEraser, type Design,
} from '@stratum/core';
import { joinRoom, roomSnapshot, roomStats } from './rooms';
import { llmEnabled, chat } from './llm';

const PORT = Number(process.env.PORT ?? 8787);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '../../web/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon',
};

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage, limit = 2_000_000): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function isDesign(x: any): x is Design {
  return x && Array.isArray(x.nodes) && Array.isArray(x.edges) && typeof x.scenario === 'object';
}

/** Build the HTTP + WebSocket server without binding a port, so tests can listen on :0. */
export function createServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' });
      return res.end();
    }
    try {
      if (url.pathname === '/api/health') return send(res, 200, { ok: true, version: '1.0.0', llm: llmEnabled(), rooms: roomStats() });
      if (url.pathname === '/api/templates') return send(res, 200, TEMPLATES.map(({ id, name, description }) => ({ id, name, description })));

      const snap = /^\/api\/rooms\/([\w-]+)\/(snapshot|mermaid|eraser)$/.exec(url.pathname);
      if (snap && req.method === 'GET') {
        const d = roomSnapshot(snap[1]);
        if (snap[2] === 'snapshot') return send(res, 200, d);
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(snap[2] === 'mermaid' ? emitMermaid(d) : emitEraser(d));
      }

      if (url.pathname === '/api/simulate' && req.method === 'POST') {
        const body = await readJson(req);
        if (!isDesign(body.design)) return send(res, 400, { error: 'design is required' });
        return send(res, 200, simulate(body.design, { rps: body.rps, samples: Math.min(Number(body.samples) || 8000, 50_000) }));
      }

      if (url.pathname === '/api/critique' && req.method === 'POST') {
        const body = await readJson(req);
        const design = body.design;
        if (!isDesign(design)) return send(res, 400, { error: 'design is required' });
        const errors = validateDesign(design).filter((i) => i.level === 'error');
        if (errors.length) return send(res, 422, { error: 'invalid design', issues: errors });
        const mode = body.mode === 'deep' ? 'deep' : 'quick';
        const sim = simulate(design, { rps: body.rps });
        let extra = [] as ReturnType<typeof parseLlmFindings>;
        let llmError: string | undefined;
        if (mode === 'deep' && llmEnabled() && body.useLlm !== false) {
          try {
            const { system, user } = buildCritiquePrompt(design, sim);
            extra = parseLlmFindings(await chat(system, user), design);
          } catch (e) { llmError = (e as Error).message; }
        }
        const report = runCritique(design, { mode, sim, dismissed: body.dismissed, extraFindings: extra });
        if (extra.length) report.agentsRun.push('llm');
        return send(res, 200, { ...report, llmError });
      }

      if (url.pathname === '/api/generate' && req.method === 'POST') {
        const body = await readJson(req);
        const prompt = String(body.prompt ?? '').slice(0, 2000);
        if (!prompt.trim()) return send(res, 400, { error: 'prompt is required' });
        if (llmEnabled()) {
          try {
            const system = `You design software architectures. Return ONLY JSON matching:
{"name":string,"assumptions":[string],"scenario":{"rps":number,"sloP99Ms":number,"entry":[nodeId]},
 "nodes":[{"id":snake_case,"label":string,"kind":"client|cdn|load_balancer|gateway|service|function|database|cache|queue|stream|storage|search|external","tech":string,"perf":{"instances":number}}],
 "edges":[{"source":id,"target":id,"sync":boolean,"callsPerRequest":number,"label":string}]}
Use 6-16 nodes. Every edge must reference existing node ids.`;
            const raw = await chat(system, prompt);
            const data = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
            const ids = new Set<string>((data.nodes ?? []).map((n: any) => String(n.id)));
            const design: Design = {
              name: String(data.name ?? 'Generated design'),
              scenario: { rps: Number(data.scenario?.rps) || 1000, sloP99Ms: Number(data.scenario?.sloP99Ms) || 300, entry: (data.scenario?.entry ?? []).filter((x: string) => ids.has(x)) },
              groups: [],
              nodes: (data.nodes ?? []).map((n: any) => ({ id: String(n.id), label: String(n.label ?? n.id), kind: n.kind, tech: n.tech, perf: n.perf })),
              edges: (data.edges ?? []).filter((e: any) => ids.has(e.source) && ids.has(e.target)).map((e: any, i: number) => ({
                id: `${e.source}__${e.target}_${i}`, source: e.source, target: e.target, sync: e.sync !== false, callsPerRequest: Number(e.callsPerRequest) || 1, label: e.label,
              })),
            };
            if (!validateDesign(design).some((i) => i.level === 'error') && design.nodes.length) {
              return send(res, 200, { design: autoLayout(design), assumptions: data.assumptions ?? [], source: 'llm' });
            }
          } catch (e) {
            console.warn('[generate] LLM failed, falling back to offline generator:', (e as Error).message);
          }
        }
        return send(res, 200, { ...generateFromPrompt(prompt), source: 'offline' });
      }

      if (req.method === 'GET' && fs.existsSync(WEB_DIST)) {
        let file = path.join(WEB_DIST, decodeURIComponent(url.pathname));
        if (!file.startsWith(WEB_DIST)) return send(res, 403, { error: 'forbidden' });
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIST, 'index.html');
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
        return fs.createReadStream(file).pipe(res);
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: (e as Error).message });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 5 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const m = /^\/collab\/([\w-]+)$/.exec(url.pathname);
    if (!m) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => joinRoom(m[1], ws));
  });

  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Stratum server listening on http://localhost:${PORT}`);
    console.log(`  LLM reviewer: ${llmEnabled() ? `enabled (${process.env.STRATUM_LLM_MODEL ?? 'gpt-4o-mini'})` : 'disabled (set STRATUM_LLM_API_KEY to enable)'}`);
    if (fs.existsSync(WEB_DIST)) console.log(`  Serving web app from ${WEB_DIST}`);
  });
}
