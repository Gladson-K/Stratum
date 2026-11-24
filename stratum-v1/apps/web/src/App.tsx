import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import * as Y from 'yjs';
import {
  TEMPLATES, loadTemplate, simulate, runCritique, applyPatch, autoLayout, generateFromPrompt, emit,
  type CritiqueReport, type Design, type Finding,
} from '@stratum/core';
import { CollabClient, randomIdentity, type Presence } from './lib/collab';
import { Canvas } from './components/Canvas';
import { CodePanel } from './components/CodePanel';
import { Inspector } from './components/Inspector';
import { SimPanel } from './components/SimPanel';
import { CritiquePanel } from './components/CritiquePanel';

function roomFromUrl(): string {
  const m = /room=([\w-]+)/.exec(location.hash) ?? /room=([\w-]+)/.exec(location.search);
  if (m) return m[1];
  const id = Math.random().toString(36).slice(2, 10);
  history.replaceState(null, '', `#room=${id}`);
  return id;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function download(name: string, text: string, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

type Tab = 'inspect' | 'simulate' | 'critique';

export default function App() {
  const [room] = useState(roomFromUrl);
  const collab = useMemo(() => new CollabClient(room, randomIdentity()), [room]);
  useEffect(() => () => collab.destroy(), [collab]);

  const undo = useMemo(() => new Y.UndoManager([collab.nodes, collab.edges, collab.groups, collab.meta], { captureTimeout: 400 }), [collab]);

  // Subscribe to the CRDT; snapshot is memoised per document version.
  const version = useRef({ n: 0, design: collab.snapshot() });
  const subscribe = useCallback((fn: () => void) => collab.subscribe(() => { version.current = { n: version.current.n + 1, design: collab.snapshot() }; fn(); }), [collab]);
  const ver = useSyncExternalStore(subscribe, () => version.current);
  const design = ver.design;
  const peers = [...collab.peers.entries()] as [string, Presence][];

  // Seed an empty room with a starter template once we know the server has nothing.
  useEffect(() => {
    const t = setTimeout(() => { if (collab.isEmpty()) collab.replace(autoLayout(loadTemplate('notification-service'))); }, 900);
    return () => clearTimeout(t);
  }, [collab]);

  const [selection, setSelection] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('critique');
  const [heat, setHeat] = useState(true);
  const [report, setReport] = useState<CritiqueReport | null>(null);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [promptOpen, setPromptOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const simDesign = useDebounced(design, 120);
  const sim = useMemo(() => (simDesign.nodes.length ? simulate(simDesign, { samples: 4000 }) : null), [simDesign]);

  const focus = (id: string) => { setSelection(id); setFocusId(id); setTimeout(() => setFocusId(null), 50); };
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  const runReview = async (mode: 'quick' | 'deep', d: Design = design, dis = dismissed) => {
    setRunning(true); setNote(null);
    try {
      if (mode === 'deep') {
        const res = await fetch('/api/critique', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ design: d, mode, dismissed: dis }) });
        if (!res.ok) throw new Error(`server returned ${res.status}`);
        const r = await res.json();
        if (r.llmError) setNote(`LLM reviewer failed (${r.llmError}); showing rule-based agents only.`);
        else if (!r.agentsRun.includes('llm')) setNote('No LLM is configured on the server, so deep review ran the rule-based agents with full cross-examination. Set STRATUM_LLM_API_KEY to add the LLM reviewer.');
        setReport(r);
      } else {
        setReport(runCritique(d, { mode, dismissed: dis }));
      }
    } catch (e) {
      setNote(`Server unavailable (${(e as Error).message}); ran the review locally in the browser.`);
      setReport(runCritique(d, { mode, dismissed: dis }));
    } finally { setRunning(false); }
  };

  // Keep an existing report fresh as the design changes (quick mode is local and cheap).
  useEffect(() => {
    if (report && report.mode === 'quick') setReport(runCritique(simDesign, { mode: 'quick', dismissed }));
  }, [simDesign]); // eslint-disable-line react-hooks/exhaustive-deps

  const accept = (f: Finding) => {
    if (!f.patch) return;
    const next = autoLayout(applyPatch(design, f.patch));
    collab.replace(next);
    flash(`Applied: ${f.suggestion.split('.')[0]}`);
    setReport(runCritique(next, { mode: report?.mode ?? 'quick', dismissed }));
  };
  const dismiss = (f: Finding) => {
    const dis = [...dismissed, f.key];
    setDismissed(dis);
    setReport((r) => r && { ...r, findings: r.findings.filter((x) => x.key !== f.key) });
  };

  const loadTpl = (id: string) => {
    if (!id) return;
    collab.replace(autoLayout(loadTemplate(id), { force: true }));
    setReport(null); setDismissed([]); setSelection(null);
    flash(`Loaded template: ${TEMPLATES.find((t) => t.id === id)?.name}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.closest('input, textarea, select')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? undo.redo() : undo.undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); undo.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  const slug = design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';
  const openFindings = report?.findings.length ?? 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-label="Stratum"><rect width="32" height="32" rx="7" fill="#0f172a" stroke="#1e293b" /><path d="M7 11h18M7 16h13M7 21h8" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" /></svg>
          <span>Stratum</span>
        </div>
        <input className="design-name" value={design.name} aria-label="Design name" onChange={(e) => collab.setName(e.target.value)} />
        <div className="topbar__actions">
          <select className="select" value="" onChange={(e) => loadTpl(e.target.value)} aria-label="Load template">
            <option value="">Templates</option>
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="btn" onClick={() => setPromptOpen(true)}>Generate from prompt</button>
          <button className="btn btn--ghost" onClick={() => collab.replace(autoLayout(design, { force: true }))} title="Auto-arrange components">Tidy layout</button>
          <button className="btn btn--ghost" onClick={() => undo.undo()} title="Undo (Ctrl+Z)">Undo</button>
          <details className="menu">
            <summary className="btn btn--ghost">Export</summary>
            <div className="menu__list">
              <button onClick={() => download(`${slug}.mmd`, emit(design, 'mermaid'))}>Mermaid (.mmd)</button>
              <button onClick={() => download(`${slug}.eraser`, emit(design, 'eraser'))}>Eraser DSL (.eraser)</button>
              <button onClick={() => download(`${slug}.json`, JSON.stringify(design, null, 2), 'application/json')}>Stratum model (.json)</button>
              {report && <button onClick={() => download(`${slug}-critique.json`, JSON.stringify(report, null, 2), 'application/json')}>Critique report (.json)</button>}
            </div>
          </details>
        </div>
        <div className="presence">
          <span className={`conn conn--${collab.status}`} title={`Room ${room}`}>{collab.status === 'online' ? 'Live' : collab.status === 'connecting' ? 'Connecting' : 'Offline, editing locally'}</span>
          <div className="avatars">
            <span className="avatar" style={{ background: collab.presence.color }} title={`${collab.presence.name} (you)`}>{collab.presence.name[0]}</span>
            {peers.slice(0, 5).map(([id, p]) => <span key={id} className="avatar" style={{ background: p.color }} title={p.name}>{p.name[0]}</span>)}
            {peers.length > 5 && <span className="avatar avatar--more">+{peers.length - 5}</span>}
          </div>
          <button className="btn btn--primary" onClick={() => { navigator.clipboard?.writeText(location.href); flash('Room link copied. Anyone with the link can edit.'); }}>Share</button>
        </div>
      </header>

      <main className="workspace">
        <CodePanel design={design} onApply={(d) => collab.replace(d)} />
        <ReactFlowProvider>
          <Canvas design={design} collab={collab} sim={heat ? sim : null} findings={report?.findings ?? []} heat={heat}
                  selection={selection} onSelect={(id) => { setSelection(id); if (id) setTab('inspect'); }} peers={peers} focusId={focusId} />
        </ReactFlowProvider>
        <aside className="panel side">
          <nav className="tabs tabs--full" role="tablist">
            <button role="tab" aria-selected={tab === 'inspect'} className={`tab${tab === 'inspect' ? ' is-active' : ''}`} onClick={() => setTab('inspect')}>Inspect</button>
            <button role="tab" aria-selected={tab === 'simulate'} className={`tab${tab === 'simulate' ? ' is-active' : ''}`} onClick={() => setTab('simulate')}>
              Simulate {sim?.slo && <span className={`dot ${sim.slo.pass ? 'dot--ok' : 'dot--bad'}`} />}
            </button>
            <button role="tab" aria-selected={tab === 'critique'} className={`tab${tab === 'critique' ? ' is-active' : ''}`} onClick={() => setTab('critique')}>
              Critique {openFindings > 0 && <span className="count">{openFindings}</span>}
            </button>
          </nav>
          <div className="side__body">
            {tab === 'inspect' && <Inspector design={design} selection={selection} collab={collab} sim={sim} onSelect={setSelection} />}
            {tab === 'simulate' && <SimPanel design={design} sim={sim} collab={collab} heat={heat} setHeat={setHeat} onFocus={focus} />}
            {tab === 'critique' && <CritiquePanel design={design} report={report} running={running} note={note} onRun={(m) => runReview(m)} onAccept={accept} onDismiss={dismiss} onFocus={focus} />}
          </div>
        </aside>
      </main>

      {promptOpen && <PromptDialog onClose={() => setPromptOpen(false)} onResult={(d, assumptions) => {
        collab.replace(autoLayout(d, { force: true }));
        setReport(null); setDismissed([]); setPromptOpen(false);
        flash(assumptions.length ? `Generated. Assumptions: ${assumptions.slice(0, 2).join('; ')}` : 'Generated design.');
      }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function PromptDialog({ onClose, onResult }: { onClose: () => void; onResult: (d: Design, assumptions: string[]) => void }) {
  const [text, setText] = useState('A ride-sharing backend handling 20k requests per second with real-time driver locations, payments via Stripe and push notifications');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: text }) });
      if (!res.ok) throw new Error(String(res.status));
      const r = await res.json();
      onResult(r.design, r.assumptions ?? []);
    } catch {
      const r = generateFromPrompt(text);
      onResult(r.design, r.assumptions);
    } finally { setBusy(false); }
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Generate design from prompt" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__card">
        <h3>Describe the system</h3>
        <p className="muted small">Mention traffic (for example "50k rps"), data stores, third parties and features. Stratum drafts an architecture you can then critique and simulate. The current design in this room is replaced; use Undo to restore it.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} autoFocus />
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={busy || !text.trim()} onClick={go}>{busy ? 'Generating' : 'Generate design'}</button>
        </div>
      </div>
    </div>
  );
}
