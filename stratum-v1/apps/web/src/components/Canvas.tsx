import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType, ViewportPortal,
  applyNodeChanges, useReactFlow, useNodesInitialized,
  type Node, type Edge, type NodeChange, type NodeProps, type Connection, type EdgeChange,
} from '@xyflow/react';
import type { Design, NodeKind, SimulationResult, Finding } from '@stratum/core';
import { KIND_META, KindIcon, utilColor } from '../lib/kinds';
import type { CollabClient, Presence } from '../lib/collab';

type SysNodeData = {
  label: string; kind: NodeKind; tech?: string; group?: string;
  utilization?: number; saturated?: boolean; findings: number; worst?: string; heat: boolean;
};

const SEV_COLOR: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#38bdf8', info: '#94a3b8' };

const SysNode = memo(({ data, selected }: NodeProps<Node<SysNodeData>>) => {
  const meta = KIND_META[data.kind];
  const u = data.utilization ?? 0;
  return (
    <div className={`sys-node${selected ? ' is-selected' : ''}${data.saturated ? ' is-saturated' : ''}`}
         style={{ ['--kind' as string]: meta.color, ['--heat' as string]: data.heat ? utilColor(u) : 'transparent' }}>
      <Handle type="target" position={Position.Left} />
      <div className="sys-node__head">
        <KindIcon kind={data.kind} />
        <span className="sys-node__label">{data.label}</span>
        {data.findings > 0 && (
          <span className="sys-node__badge" style={{ background: SEV_COLOR[data.worst ?? 'info'] }} title={`${data.findings} critique finding(s)`}>{data.findings}</span>
        )}
      </div>
      <div className="sys-node__sub">
        <span>{data.tech ?? meta.label}</span>
        {data.group && <span className="sys-node__group">{data.group}</span>}
      </div>
      {data.heat && data.kind !== 'client' && (
        <div className="sys-node__util" title={`Utilization ${(u * 100).toFixed(0)}%`}>
          <div style={{ width: `${Math.min(100, u * 100)}%`, background: utilColor(u) }} />
          <span>{(u * 100).toFixed(0)}%</span>
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

const nodeTypes = { sys: SysNode };

interface Props {
  design: Design;
  collab: CollabClient;
  sim: SimulationResult | null;
  findings: Finding[];
  heat: boolean;
  selection: string | null;
  onSelect: (id: string | null) => void;
  peers: [string, Presence][];
  focusId: string | null;
}

export function Canvas({ design, collab, sim, findings, heat, selection, onSelect, peers, focusId }: Props) {
  const rf = useReactFlow();
  const [nodes, setNodes] = useState<Node<SysNodeData>[]>([]);

  const findingsByTarget = useMemo(() => {
    const m = new Map<string, Finding[]>();
    for (const f of findings) for (const t of f.targets) m.set(t, [...(m.get(t) ?? []), f]);
    return m;
  }, [findings]);

  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return design.nodes.map((n, i) => {
        const fs = findingsByTarget.get(n.id) ?? [];
        const r = sim?.nodes[n.id];
        const p = prevById.get(n.id);
        return {
          id: n.id,
          type: 'sys',
          position: p?.dragging ? p.position : n.position ?? { x: (i % 5) * 240, y: Math.floor(i / 5) * 120 },
          selected: selection === n.id,
          dragging: p?.dragging,
          data: {
            label: n.label, kind: n.kind, tech: n.tech,
            group: design.groups.find((g) => g.id === n.group)?.label,
            utilization: r?.utilization, saturated: !!r?.saturated && heat,
            findings: fs.length, worst: fs[0]?.severity, heat,
          },
        };
      });
    });
  }, [design, sim, findingsByTarget, heat, selection]);

  useEffect(() => {
    if (!focusId) return;
    const n = design.nodes.find((x) => x.id === focusId);
    if (n?.position) rf.setCenter(n.position.x + 90, n.position.y + 30, { zoom: 1.2, duration: 400 });
    else {
      const e = design.edges.find((x) => x.id === focusId);
      const s = e && design.nodes.find((x) => x.id === e.source);
      if (s?.position) rf.setCenter(s.position.x + 120, s.position.y + 30, { zoom: 1.1, duration: 400 });
    }
  }, [focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fit when the set of components changes (template load, generation, code paste, peer edits).
  const idKey = design.nodes.map((n) => n.id).sort().join('|');
  const prevKey = useRef('');
  const pendingFit = useRef(false);
  useEffect(() => {
    const prev = new Set(prevKey.current ? prevKey.current.split('|') : []);
    prevKey.current = idKey;
    if (!idKey) return;
    const next = idKey.split('|');
    const changed = next.filter((id) => !prev.has(id)).length + [...prev].filter((id) => !next.includes(id)).length;
    if (prev.size && changed < 2) return; // single add/remove: keep the user's viewport
    pendingFit.current = true;
  }, [idKey]);
  const initialized = useNodesInitialized();
  useEffect(() => {
    if (!initialized || !pendingFit.current) return;
    pendingFit.current = false;
    setTimeout(() => rf.fitView({ padding: 0.18, duration: 250, maxZoom: 1.15 }), 150);
  }, [initialized, idKey, rf]);

  const edges: Edge[] = useMemo(() => design.edges.map((e) => {
    const hot = heat && sim ? Math.max(sim.nodes[e.target]?.utilization ?? 0, 0) : 0;
    const flagged = findingsByTarget.has(e.id);
    return {
      id: e.id, source: e.source, target: e.target,
      label: [e.label, e.callsPerRequest !== 1 ? `×${e.callsPerRequest}` : ''].filter(Boolean).join(' '),
      animated: !e.sync,
      selected: selection === e.id,
      style: {
        stroke: flagged ? '#f97316' : heat && hot >= 0.8 ? utilColor(hot) : e.sync ? '#64748b' : '#7c8db5',
        strokeWidth: selection === e.id ? 2.5 : 1.6,
        strokeDasharray: e.sync ? undefined : '6 4',
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b', width: 16, height: 16 },
      labelStyle: { fill: '#cbd5e1', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
      labelBgStyle: { fill: '#0b1220' },
    };
  }), [design.edges, heat, sim, selection, findingsByTarget]);

  const onNodesChange = useCallback((changes: NodeChange<Node<SysNodeData>>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    for (const c of changes) {
      if (c.type === 'position' && c.dragging === false && c.position) {
        const n = design.nodes.find((x) => x.id === c.id);
        if (n) collab.setNode({ ...n, position: { x: Math.round(c.position.x), y: Math.round(c.position.y) } });
      }
      if (c.type === 'remove') collab.removeNode(c.id);
    }
  }, [design.nodes, collab]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const c of changes) if (c.type === 'remove') collab.removeEdge(c.id);
  }, [collab]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    let id = `${c.source}__${c.target}`;
    let i = 2;
    while (design.edges.some((e) => e.id === id)) id = `${c.source}__${c.target}_${i++}`;
    collab.setEdge({ id, source: c.source, target: c.target, sync: true, callsPerRequest: 1 });
    onSelect(id);
  }, [design.edges, collab, onSelect]);

  const onMouseMove = useCallback((ev: React.MouseEvent) => {
    const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
    collab.setPresence({ cursor: { x: Math.round(p.x), y: Math.round(p.y) } });
  }, [rf, collab]);

  const onDrop = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    const kind = ev.dataTransfer.getData('application/stratum-kind') as NodeKind;
    if (!kind) return;
    const pos = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
    const base = kind;
    let id: string = base; let i = 2;
    while (design.nodes.some((n) => n.id === id)) id = `${base}_${i++}`;
    collab.setNode({ id, label: KIND_META[kind].label, kind, position: { x: Math.round(pos.x - 80), y: Math.round(pos.y - 25) } });
    onSelect(id);
  }, [rf, design.nodes, collab, onSelect]);

  return (
    <div className="canvas" onMouseMove={onMouseMove} onMouseLeave={() => collab.setPresence({ cursor: null })}
         onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
        onNodeClick={(_, n) => { onSelect(n.id); collab.setPresence({ selected: n.id }); }}
        onEdgeClick={(_, e) => onSelect(e.id)}
        onPaneClick={() => { onSelect(null); collab.setPresence({ selected: null }); }}
        fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.2} maxZoom={2.5}
        deleteKeyCode={['Delete', 'Backspace']} proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background gap={24} size={1} color="#1e293b" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(n) => KIND_META[(n.data as SysNodeData).kind]?.color ?? '#64748b'} maskColor="rgba(2,6,23,0.7)" />
        <ViewportPortal>
          {peers.filter(([, p]) => p.cursor).map(([id, p]) => (
            <div key={id} className="peer-cursor" style={{ transform: `translate(${p.cursor!.x}px, ${p.cursor!.y}px)`, ['--c' as string]: p.color }}>
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 1l5 14l2-6l6-2z" fill={p.color} stroke="#0b1220" strokeWidth="1" /></svg>
              <span>{p.name}</span>
            </div>
          ))}
        </ViewportPortal>
      </ReactFlow>
      {!design.nodes.length && (
        <div className="canvas__empty">
          <p>Drag a component from the palette, write Mermaid or Eraser-style code on the left, or generate a design from a prompt.</p>
        </div>
      )}
    </div>
  );
}
