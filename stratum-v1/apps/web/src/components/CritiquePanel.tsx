import { useState } from 'react';
import { AGENT_LABELS, type CritiqueReport, type Design, type Finding } from '@stratum/core';

interface Props {
  design: Design;
  report: CritiqueReport | null;
  running: boolean;
  note: string | null;
  onRun: (mode: 'quick' | 'deep') => void;
  onAccept: (f: Finding) => void;
  onDismiss: (f: Finding) => void;
  onFocus: (id: string) => void;
}

function FindingCard({ f, onAccept, onDismiss, onFocus }: { f: Finding; onAccept: () => void; onDismiss: () => void; onFocus: (id: string) => void }) {
  const [open, setOpen] = useState(f.severity === 'critical' || f.severity === 'high');
  return (
    <article className={`finding finding--${f.severity}${f.status === 'contested' ? ' is-contested' : ''}`}>
      <header onClick={() => setOpen(!open)}>
        <span className={`sev sev--${f.severity}`}>{f.severity}</span>
        <h4>{f.title}</h4>
        <span className="finding__agent">{AGENT_LABELS[f.agent]}{f.agreedBy?.length ? ` +${f.agreedBy.length}` : ''}</span>
      </header>
      {open && (
        <div className="finding__body">
          <p>{f.explanation}</p>
          {f.evidence.length > 0 && <ul className="evidence">{f.evidence.map((e, i) => <li key={i} className="mono">{e}</li>)}</ul>}
          <p className="suggest"><b>Suggested fix:</b> {f.suggestion}</p>
          {f.status === 'contested' && f.rebuttal && <p className="rebuttal"><b>Devil's advocate:</b> {f.rebuttal}</p>}
          <div className="finding__actions">
            {f.patch?.length ? <button className="btn btn--primary" onClick={onAccept}>Apply fix</button> : null}
            {f.targets.slice(0, 3).map((t) => <button key={t} className="btn btn--ghost" onClick={() => onFocus(t)}>Show {t}</button>)}
            <button className="btn btn--ghost" onClick={onDismiss}>Dismiss</button>
            <span className="conf">{Math.round(f.confidence * 100)}% confidence</span>
          </div>
        </div>
      )}
    </article>
  );
}

export function CritiquePanel({ design, report, running, note, onRun, onAccept, onDismiss, onFocus }: Props) {
  return (
    <div className="critique">
      <div className="critique__run">
        <button className="btn btn--primary" disabled={running || !design.nodes.length} onClick={() => onRun('quick')}>Quick review</button>
        <button className="btn" disabled={running || !design.nodes.length} onClick={() => onRun('deep')}>Deep review</button>
        {running && <span className="spinner" aria-label="Reviewing" />}
      </div>
      <p className="muted small">Five specialist reviewers (scalability, reliability, security, consistency, cost) examine the design and the simulation. A devil's-advocate agent challenges weak findings. Deep review adds an LLM reviewer when the server has a model configured.</p>
      {note && <p className="banner banner--warn">{note}</p>}
      {report && (
        <>
          <div className="score">
            <div className="score__ring" style={{ ['--p' as string]: report.score }}><b>{report.score}</b><span>/100</span></div>
            <div>
              <p>{report.summary}</p>
              <p className="muted small">{report.agentsRun.map((a) => AGENT_LABELS[a]).join(' · ')} · {report.durationMs} ms</p>
            </div>
          </div>
          {report.plan.length > 0 && (
            <details className="plan"><summary>Remediation plan ({report.plan.length} {report.plan.length === 1 ? 'step' : 'steps'})</summary><ol>{report.plan.map((p, i) => <li key={i}>{p}</li>)}</ol></details>
          )}
          {report.findings.length === 0 && <p className="banner banner--ok">No open findings. Try raising traffic in the simulator to stress the design.</p>}
          {report.findings.map((f) => (
            <FindingCard key={f.key} f={f} onAccept={() => onAccept(f)} onDismiss={() => onDismiss(f)} onFocus={onFocus} />
          ))}
        </>
      )}
    </div>
  );
}
