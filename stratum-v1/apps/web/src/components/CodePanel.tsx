import { useEffect, useRef, useState } from 'react';
import { emit, parse, preservePositions, type Design, type Dialect, type ParseError } from '@stratum/core';

interface Props { design: Design; onApply: (d: Design) => void }

/**
 * Diagram-as-code editor with two-way sync.
 * Typing re-parses (debounced) and updates the shared canvas; canvas edits
 * re-emit code whenever the editor holds no unapplied local edits.
 */
export function CodePanel({ design, onApply }: Props) {
  const [dialect, setDialect] = useState<Dialect>('mermaid');
  const [code, setCode] = useState(() => emit(design, 'mermaid'));
  const [errors, setErrors] = useState<ParseError[]>([]);
  const [focused, setFocused] = useState(false);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const designRef = useRef(design);
  designRef.current = design;

  // canvas → code
  useEffect(() => {
    if (focused && dirty.current) return;
    if (focused) return; // never rewrite text under the caret
    setCode(emit(design, dialect));
    setErrors([]);
  }, [design, dialect, focused]);

  const apply = (text: string) => {
    const res = parse(text, dialect);
    setErrors(res.errors);
    if (res.errors.some((e) => (e.severity ?? 'error') === 'error')) return;
    const current = designRef.current;
    const next = preservePositions(res.design, current);
    // Mermaid has no title syntax; keep the current design name unless the code sets one.
    if (dialect === 'mermaid' || !/^\s*title\s+/m.test(text)) next.name = current.name;
    dirty.current = false;
    onApply(next);
  };

  const onChange = (text: string) => {
    setCode(text);
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => apply(text), 450);
  };

  const switchDialect = (d: Dialect) => {
    if (dirty.current) apply(code);
    setDialect(d);
    setCode(emit(designRef.current, d));
    setErrors([]);
  };

  const lines = code.split('\n').length;
  const errLines = new Set(errors.map((e) => e.line));

  return (
    <section className="panel code-panel" aria-label="Diagram as code">
      <header className="panel__head">
        <div className="tabs" role="tablist">
          {(['mermaid', 'eraser'] as Dialect[]).map((d) => (
            <button key={d} role="tab" aria-selected={dialect === d} className={`tab${dialect === d ? ' is-active' : ''}`} onClick={() => switchDialect(d)}>
              {d === 'mermaid' ? 'Mermaid' : 'Eraser DSL'}
            </button>
          ))}
        </div>
        <span className={`sync-dot${errors.some((e) => (e.severity ?? 'error') === 'error') ? ' is-error' : dirty.current ? ' is-pending' : ''}`}>
          {errors.some((e) => (e.severity ?? 'error') === 'error') ? 'Parse error' : dirty.current ? 'Syncing' : 'In sync'}
        </span>
      </header>
      <div className="editor">
        <div className="editor__gutter" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className={errLines.has(i + 1) ? 'is-error' : ''}>{i + 1}</div>
          ))}
        </div>
        <textarea
          className="editor__text" spellCheck={false} value={code} aria-label={`${dialect} source`}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); if (dirty.current) apply(code); }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const t = e.currentTarget; const s = t.selectionStart;
              const v = code.slice(0, s) + '  ' + code.slice(t.selectionEnd);
              onChange(v);
              requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
            }
          }}
        />
      </div>
      {errors.length > 0 && (
        <ul className="editor__errors">
          {errors.slice(0, 6).map((e, i) => (
            <li key={i} className={(e.severity ?? 'error') === 'error' ? 'is-error' : 'is-warn'}>
              <span className="mono">L{e.line}</span> {e.message}
            </li>
          ))}
        </ul>
      )}
      <footer className="panel__foot mono">
        {dialect === 'mermaid'
          ? 'A[Label] --> B[(DB)]  ·  -.-> async  ·  %% @node id instances=3'
          : 'Name [icon: aws-ec2]  ·  A > B: label  ·  A --> B async'}
      </footer>
    </section>
  );
}
