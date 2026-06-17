// Layout con elkjs: posiciona tablas (layered) y rutea aristas ortogonalmente
// conectándolas a puertos ubicados en la fila de cada columna.
import ELK from "elkjs/lib/elk.bundled.js";
import type { Model } from "./parser";

export const ROW_H = 28;
export const HEAD_H = 36;
export const NODE_W = 216;

export interface Pt {
  x: number;
  y: number;
}
export interface NodePos {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface EdgePath {
  pts: Pt[]; // polilínea ruteada por ELK (coords absolutas)
}
export interface LayoutResult {
  nodes: Record<string, NodePos>;
  edges: EdgePath[]; // mismo orden que model.refs
}

const elk = new ELK();

export function tableHeight(colCount: number): number {
  return HEAD_H + colCount * ROW_H;
}
function colRowY(model: Model, table: string, col: string): number {
  const t = model.tables.find((t) => t.name === table)!;
  const i = t.cols.findIndex((c) => c.name === col);
  return HEAD_H + i * ROW_H + ROW_H / 2;
}

export async function computeLayout(model: Model): Promise<LayoutResult> {
  const children = model.tables.map((t) => {
    const h = tableHeight(t.cols.length);
    const ports: any[] = [];
    model.refs.forEach((r, i) => {
      if (r.from === t.name) {
        const y = colRowY(model, t.name, r.fromCol);
        ports.push(port(`s${i}_e`, NODE_W, y, "EAST"));
        ports.push(port(`s${i}_w`, 0, y, "WEST"));
      }
      if (r.to === t.name) {
        const y = colRowY(model, t.name, r.toCol);
        ports.push(port(`t${i}_e`, NODE_W, y, "EAST"));
        ports.push(port(`t${i}_w`, 0, y, "WEST"));
      }
    });
    return {
      id: t.name,
      width: NODE_W,
      height: h,
      ports,
      properties: { "org.eclipse.elk.portConstraints": "FIXED_POS" },
    };
  });

  // source desde EAST, target hacia WEST (caso jerárquico común)
  const edges = model.refs.map((r, i) => ({
    id: "e" + i,
    sources: [`s${i}_e`],
    targets: [`t${i}_w`],
  }));

  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.spacing.nodeNode": "50",
      "elk.spacing.edgeNode": "25",
    },
    children,
    edges,
  };

  const res: any = await elk.layout(graph as any);
  const nodes: Record<string, NodePos> = {};
  for (const n of res.children) {
    nodes[n.id] = { x: n.x, y: n.y, w: n.width, h: n.height };
  }
  const edgePaths: EdgePath[] = res.edges.map((e: any) => {
    const sec = e.sections?.[0];
    if (!sec) return { pts: [] };
    const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint];
    return { pts };
  });
  return { nodes, edges: edgePaths };
}

function port(id: string, x: number, y: number, side: string) {
  return {
    id,
    x,
    y,
    width: 1,
    height: 1,
    properties: { "org.eclipse.elk.port.side": side },
  };
}
