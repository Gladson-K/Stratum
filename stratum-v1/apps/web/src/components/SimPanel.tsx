import { useMemo } from 'react';
import { loadCurve, type Design, type SimulationResult } from '@stratum/core';
import type { CollabClient } from '../lib/collab';
import { fmtMs, fmtNum, utilColor } from '../lib/kinds';

interface Props { design: Design; sim: SimulationResult | null; collab: CollabClient; heat: boolean; setHeat: (v: boolean) => void; onFocus: (id: string) => void }

// log-scale slider: 1 .. 1,000,000 rps
const toSlider = (rps: number) => Math.round((Math.log10(Math.max(1, rps)) / 6) * 1000);
const fromSlider = (v: number) => {
  const raw = 10 ** ((v / 1000) * 6);
  const mag = 10 ** Math.floor(Math.log10(raw));
  return Math.max(1, Math.round(raw / (mag / 10)) * (mag / 10));
};

function Curve({ design }: { design: Design }) {
  const pts = useMemo(() => (design.nodes.length ? loadCurve(design) : []), [design]);
  if (!pts.length) return null;
  const W = 320, H = 130, P = 44;
  const maxX = Math.max(...pts.map((p) => p.rps));
  const finite = pts.map((p) => p.p99).filter((x): x is number => x !== null && Number.isFinite(x));
  const maxY = Math.max(design.scenario.sloP99Ms ?? 0, ...finite, 1) * 1.1;
  const x = (v: number) => P + (v / maxX) * (W - P - 8);
  const y = (v: number) => H - P + 4 - (Math.min(v, maxY) / maxY) * (H - P - 4);
  const line = (key: 'p50' | 'p99') =>
    pts.filter((p) => p[key] !== null && Number.isFinite(p[key]!)).map((p, i) => `${i ? 'L' : 'M'}${x(p.rps).toFixed(1)},${y(p[key]!).toFixed(1)}`).join(' ');
  const sat = pts.find((p) => p.maxUtilization >= 1);
  const slo = design.scenario.sloP99Ms;
  return (
    <figure className="curve">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Latency versus load curve">
        <line x1={P} x2={W - 8} y1={H - P + 4} y2={H - P + 4} stroke="#334155" />
        <line x1={P} x2={P} y1={4} y2={H - P + 4} stroke="#334155" />
        {slo && <><line x1={P} x2={W - 8} y1={y(slo)} y2={y(slo)} stroke="#f97316" strokeDasharray="4 3" /><text x={W - 10} y={y(slo) - 4} textAnchor="end" className="curve__t" fill="#f97316">SLO {slo} ms</text></>}
        {sat && <><rect x={x(sat.rps)} y={4} width={W - 8 - x(sat.rps)} height={H - P} fill="rgba(239,68,68,0.08)" /><text x={x(sat.rps) + 4} y={16} className="curve__t" fill="#ef4444">saturated</text></>}
        <path d={line('p50')} fill="none" stroke="#38bdf8" strokeWidth="1.6" />
        <path d={line('p99')} fill="none" stroke="#a78bfa" strokeWidth="1.8" />
        <text x={P} y={H - 6} className="curve__t" fill="#64748b">0</text>
        <text x={W - 8} y={H - 6} textAnchor="end" className="curve__t" fill="#64748b">{fmtNum(maxX)} rps</text>
        <text x={P - 4} y={12} textAnchor="end" className="curve__t" fill="#64748b">{fmtMs(maxY)}</text>
      </svg>
      <figcaption><span className="lg lg--p50" />p50 <span className="lg lg--p99" />p99 across 0.25x to 10x current load</figcaption>
    </figure>
  );
}

export function SimPanel({ design, sim, collab, heat, setHeat, onFocus }: Props) {
  if (!design.nodes.length) return <p className="muted pad">Add components to run a simulation.</p>;
  const s = design.scenario;
  const rows = sim ? Object.values(sim.nodes).filter((r) => r.lambda > 0).sort((a, b) => b.utilization - a.utilization) : [];
  const label = (id: string) => design.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <div className="sim">
      <div className="sim__controls">
        <label className="field">
          <span>Entry traffic <b className="mono">{fmtNum(s.rps)} req/s</b></span>
          <input type="range" min={0} max={1000} value={toSlider(s.rps)} aria-label="Requests per second"
                 onChange={(e) => collab.setScenario({ ...s, rps: fromSlider(Number(e.target.value)) })} />
        </label>
        <div className="grid2">
          <label className="field"><span>Exact req/s</span>
            <input type="number" min={1} value={s.rps} onChange={(e) => collab.setScenario({ ...s, rps: Math.max(1, Number(e.target.value) || 1) })} /></label>
          <label className="field"><span>p99 SLO (ms)</span>
            <input type="number" min={1} value={s.sloP99Ms ?? 300} onChange={(e) => collab.setScenario({ ...s, sloP99Ms: Math.max(1, Number(e.target.value) || 1) })} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={heat} onChange={(e) => setHeat(e.target.checked)} /> Show utilization heatmap on canvas</label>
      </div>

      {sim && (
        <>
          <div className="stats">
            <div className="stat"><span>p50</span><b>{fmtMs(sim.latency?.p50)}</b></div>
            <div className="stat"><span>p95</span><b>{fmtMs(sim.latency?.p95)}</b></div>
            <div className={`stat${sim.slo && !sim.slo.pass ? ' is-bad' : sim.slo ? ' is-good' : ''}`}><span>p99</span><b>{fmtMs(sim.latency?.p99)}</b></div>
            <div className="stat"><span>Safe ceiling</span><b>{fmtNum(sim.safeRps)}</b><small>req/s at 80%</small></div>
            <div className="stat"><span>Saturates at</span><b>{fmtNum(sim.maxRps)}</b><small>req/s</small></div>
            <div className="stat"><span>Monthly cost</span><b>${fmtNum(sim.monthlyCost)}</b><small>${sim.costPerMillionRequests.toFixed(2)} per 1M req</small></div>
          </div>
          {sim.slo && (
            <p className={`banner ${sim.slo.pass ? 'banner--ok' : 'banner--bad'}`}>
              {sim.slo.pass ? `Meets the ${sim.slo.targetP99Ms} ms p99 SLO at ${fmtNum(sim.rps)} req/s.` : `Misses the ${sim.slo.targetP99Ms} ms p99 SLO at ${fmtNum(sim.rps)} req/s.`}
              {sim.bottleneck && <> Bottleneck: <button className="link" onClick={() => onFocus(sim.bottleneck!.id)}>{label(sim.bottleneck.id)}</button> at {(sim.bottleneck.utilization * 100).toFixed(0)}%.</>}
            </p>
          )}
          {sim.warnings.map((w, i) => <p key={i} className="banner banner--warn">{w}</p>)}
          <Curve design={design} />
          <table className="util-table">
            <thead><tr><th>Component</th><th>Load</th><th>Util.</th><th>Wait</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => onFocus(r.id)}>
                  <td>{label(r.id)}</td>
                  <td className="mono">{fmtNum(r.lambda)}</td>
                  <td><span className="util-pill" style={{ background: utilColor(r.utilization) }}>{r.saturated ? 'SAT' : `${(r.utilization * 100).toFixed(0)}%`}</span></td>
                  <td className="mono">{fmtMs(r.meanWaitMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Analytical M/M/c queueing model (Erlang C) with Monte Carlo sampling of synchronous paths. Treat results as planning estimates, not benchmarks.</p>
        </>
      )}
    </div>
  );
}
