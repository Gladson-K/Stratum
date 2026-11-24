import { cloneDesign, type Design } from '../sgm';
import type { PatchOp } from './types';

/** Apply a critique patch to a design, returning a new design. Invalid ops are skipped. */
export function applyPatch(design: Design, ops: PatchOp[]): Design {
  const d = cloneDesign(design);
  for (const op of ops) {
    switch (op.op) {
      case 'addNode':
        if (!d.nodes.some((n) => n.id === op.node.id)) d.nodes.push(structuredCloneSafe(op.node));
        break;
      case 'addEdge':
        if (!d.edges.some((e) => e.id === op.edge.id) &&
            d.nodes.some((n) => n.id === op.edge.source) && d.nodes.some((n) => n.id === op.edge.target)) {
          d.edges.push({ ...op.edge });
        }
        break;
      case 'removeEdge':
        d.edges = d.edges.filter((e) => e.id !== op.id);
        break;
      case 'updateNode': {
        const n = d.nodes.find((x) => x.id === op.id);
        if (n) Object.assign(n, op.set);
        break;
      }
      case 'updatePerf': {
        const n = d.nodes.find((x) => x.id === op.id);
        if (n) n.perf = { ...(n.perf ?? {}), ...op.perf };
        break;
      }
      case 'updateEdge': {
        const e = d.edges.find((x) => x.id === op.id);
        if (e) Object.assign(e, op.set);
        break;
      }
    }
  }
  return d;
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
