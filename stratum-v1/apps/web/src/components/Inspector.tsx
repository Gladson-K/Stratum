import { NODE_KINDS, perfOf, type Design, type NodeKind, type SimulationResult } from '@stratum/core';
import type { CollabClient } from '../lib/collab';
import { KIND_META, KindIcon, fmtMs, fmtNum } from '../lib/kinds';

interface Props { design: Design; selection: string | null; collab: CollabClient; sim: SimulationResult | null; onSelect: (id: string | null) => void }

function Num({ label, value, onChange, step = 1, min = 0, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={Number.isFinite(value) ? value : 0} step={step} min={min} max={max}
             onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </label>
  );
}

export function Palette() {
  return (
    <div className="palette" aria-label="Component palette">
      {NODE_KINDS.map((k) => (
        <div key={k} className="palette__item" draggable title={`Drag ${KIND_META[k].label} onto the canvas`}
             onDragStart={(e) => { e.dataTransfer.setData('application/stratum-kind', k); e.dataTransfer.effectAllowed = 'move'; }}>
          <KindIcon kind={k} size={16} /><span>{KIND_META[k].label}</span>
        </div>
      ))}
    </div>
  );
}

export function Inspector({ design, selection, collab, sim, onSelect }: Props) {
  const node = design.nodes.find((n) => n.id === selection);
  const edge = !node ? design.edges.find((e) => e.id === selection) : undefined;

  if (node) {
    const perf = perfOf(node);
    const r = sim?.nodes[node.id];
    const setPerf = (p: Partial<typeof perf>) => collab.setNode({ ...node, perf: { ...node.perf, ...p } });
    return (
      <div className="inspector">
        <div className="inspector__title"><KindIcon kind={node.kind} size={20} /><code>{node.id}</code></div>
        <label className="field"><span>Label</span>
          <input value={node.label} onChange={(e) => collab.setNode({ ...node, label: e.target.value })} /></label>
        <label className="field"><span>Kind</span>
          <select value={node.kind} onChange={(e) => collab.setNode({ ...node, kind: e.target.value as NodeKind, perf: undefined })}>
            {NODE_KINDS.map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
          </select></label>
        <label className="field"><span>Technology</span>
          <input value={node.tech ?? ''} placeholder="e.g. PostgreSQL 16" onChange={(e) => collab.setNode({ ...node, tech: e.target.value || undefined })} /></label>
        <h4 className="subhead">Performance profile</h4>
        <div className="grid2">
          <Num label="Instances" value={perf.instances} min={1} onChange={(v) => setPerf({ instances: Math.max(1, Math.round(v)) })} />
          <Num label="Concurrency / inst." value={perf.concurrency} min={1} onChange={(v) => setPerf({ concurrency: Math.max(1, Math.round(v)) })} />
          <Num label="Service time (ms)" value={perf.serviceTimeMs} step={0.5} onChange={(v) => setPerf({ serviceTimeMs: Math.max(0.01, v) })} />
          <Num label="Cost / inst. / hr ($)" value={perf.costPerHour ?? 0} step={0.01} onChange={(v) => setPerf({ costPerHour: Math.max(0, v) })} />
          {node.kind === 'cache' && <Num label="Hit ratio" value={perf.hitRatio ?? 0} step={0.05} max={1} onChange={(v) => setPerf({ hitRatio: Math.min(1, Math.max(0, v)) })} />}
        </div>
        <label className="check"><input type="checkbox" checked={!!node.props?.pii} onChange={(e) => collab.setNode({ ...node, props: { ...node.props, pii: e.target.checked } })} /> Stores personal data (PII)</label>
        {node.props?.pii && (
          <label className="check"><input type="checkbox" checked={!!node.props?.encrypted} onChange={(e) => collab.setNode({ ...node, props: { ...node.props, encrypted: e.target.checked } })} /> Encrypted at rest</label>
        )}
        {r && (
          <dl className="kv">
            <dt>Arrival rate</dt><dd>{fmtNum(r.lambda)} req/s</dd>
            <dt>Capacity</dt><dd>{fmtNum(r.capacityRps)} req/s</dd>
            <dt>Utilization</dt><dd>{(r.utilization * 100).toFixed(1)}%</dd>
            <dt>Queue wait</dt><dd>{fmtMs(r.meanWaitMs)}</dd>
            <dt>Monthly cost</dt><dd>${fmtNum(r.monthlyCost)}</dd>
          </dl>
        )}
        <button className="btn btn--danger" onClick={() => { collab.removeNode(node.id); onSelect(null); }}>Delete component</button>
      </div>
    );
  }

  if (edge) {
    return (
      <div className="inspector">
        <div className="inspector__title"><code>{edge.source} → {edge.target}</code></div>
        <label className="field"><span>Label</span>
          <input value={edge.label ?? ''} onChange={(e) => collab.setEdge({ ...edge, label: e.target.value || undefined })} /></label>
        <label className="check"><input type="checkbox" checked={edge.sync} onChange={(e) => collab.setEdge({ ...edge, sync: e.target.checked })} /> Synchronous (adds to request latency)</label>
        <div className="grid2">
          <Num label="Calls per request" value={edge.callsPerRequest} step={0.1} onChange={(v) => collab.setEdge({ ...edge, callsPerRequest: Math.max(0, v) })} />
          <Num label="Network latency (ms)" value={edge.latencyMs ?? 0} step={0.5} onChange={(v) => collab.setEdge({ ...edge, latencyMs: Math.max(0, v) })} />
        </div>
        <button className="btn btn--danger" onClick={() => { collab.removeEdge(edge.id); onSelect(null); }}>Delete connection</button>
      </div>
    );
  }

  return (
    <div className="inspector">
      <p className="muted">Select a component or connection to edit it, or drag a new component onto the canvas.</p>
      <Palette />
    </div>
  );
}
