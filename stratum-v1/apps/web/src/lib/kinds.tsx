import type { NodeKind } from '@stratum/core';

export const KIND_META: Record<NodeKind, { label: string; color: string; glyph: string }> = {
  client:        { label: 'Client',        color: '#94a3b8', glyph: 'M4 5h16v11H4zM9 20h6M12 16v4' },
  cdn:           { label: 'CDN',           color: '#38bdf8', glyph: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18' },
  load_balancer: { label: 'Load balancer', color: '#2dd4bf', glyph: 'M12 4v5M12 9l-6 6M12 9l6 6M12 9v6M5 15h2v4H5zM11 15h2v4h-2zM17 15h2v4h-2z' },
  gateway:       { label: 'API gateway',   color: '#22d3ee', glyph: 'M4 12h4M16 12h4M8 7h8v10H8zM12 7v10' },
  service:       { label: 'Service',       color: '#818cf8', glyph: 'M4 5h16v6H4zM4 13h16v6H4zM7 8h.01M7 16h.01' },
  function:      { label: 'Function',      color: '#c084fc', glyph: 'M9 4c-2 0-2 2-2 4v2c0 1-1 2-2 2c1 0 2 1 2 2v2c0 2 0 4 2 4M15 4c2 0 2 2 2 4v2c0 1 1 2 2 2c-1 0-2 1-2 2v2c0 2 0 4-2 4' },
  database:      { label: 'Database',      color: '#60a5fa', glyph: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3v12c0 1.7-3.1 3-7 3s-7-1.3-7-3zM5 6c0 1.7 3.1 3 7 3s7-1.3 7-3M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3' },
  cache:         { label: 'Cache',         color: '#f87171', glyph: 'M13 3L5 14h6l-1 7l8-11h-6z' },
  queue:         { label: 'Queue',         color: '#fbbf24', glyph: 'M4 8h4v8H4zM10 8h4v8h-4zM16 8h4v8h-4z' },
  stream:        { label: 'Stream',        color: '#fb923c', glyph: 'M3 8c3-3 6 3 9 0s6 3 9 0M3 13c3-3 6 3 9 0s6 3 9 0M3 18c3-3 6 3 9 0s6 3 9 0' },
  storage:       { label: 'Object storage',color: '#a3e635', glyph: 'M4 7l8-4l8 4v10l-8 4l-8-4zM4 7l8 4l8-4M12 11v10' },
  search:        { label: 'Search',        color: '#f472b6', glyph: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M16 16l4 4' },
  external:      { label: 'External API',  color: '#e2e8f0', glyph: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5' },
};

export function KindIcon({ kind, size = 18 }: { kind: NodeKind; size?: number }) {
  const m = KIND_META[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={m.color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={m.glyph} />
    </svg>
  );
}

export function utilColor(u: number): string {
  if (u >= 1) return '#ef4444';
  if (u >= 0.8) return '#f97316';
  if (u >= 0.6) return '#eab308';
  if (u > 0) return '#22c55e';
  return '#475569';
}

export const fmtNum = (x: number) =>
  !Number.isFinite(x) ? '∞' : x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}K` : x.toFixed(x < 10 ? 1 : 0);

export const fmtMs = (x: number | null | undefined) =>
  x === null || x === undefined ? '∞' : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${x.toFixed(x < 10 ? 1 : 0)} ms`;
