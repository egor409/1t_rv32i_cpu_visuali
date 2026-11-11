/** Геометрия схемы: позиции портов, трассировка проводов, связи блок ↔ сигнал. */
import type { BlockDef, MicroarchDef, SignalId, WireDef, WireEnd } from './types';

export type Pt = [number, number];

/** Доля высоты, на которую скошены верх/низ у мультиплексора и АЛУ/сумматора. */
export const SLANT = { mux: 0.18, alu: 0.25, adder: 0.25 } as const;

export function portPos(b: BlockDef, portId: string): Pt {
  const p = b.ports.find((q) => q.id === portId);
  if (!p) throw new Error(`Нет порта ${b.id}.${portId}`);
  const slant = (SLANT as Record<string, number>)[b.type] ?? 0;
  switch (p.side) {
    case 'l':
      return [b.x, b.y + p.off];
    case 'r':
      return [b.x + b.w, b.y + p.off];
    case 't':
      return [b.x + p.off, b.y + (p.off / b.w) * slant * b.h];
    case 'b':
      return [b.x + p.off, b.y + b.h - (p.off / b.w) * slant * b.h];
  }
}

export function blockMap(def: MicroarchDef): Map<string, BlockDef> {
  return new Map(def.blocks.map((b) => [b.id, b]));
}

function endPos(blocks: Map<string, BlockDef>, e: WireEnd): Pt {
  if (typeof e !== 'string') return e;
  const [bid, pid] = e.split('.');
  const b = blocks.get(bid);
  if (!b) throw new Error(`Нет блока ${bid} (провод ${e})`);
  return portPos(b, pid);
}

/** Полная ломаная провода с автоматически вставленными углами. */
export function wirePoints(blocks: Map<string, BlockDef>, w: WireDef): Pt[] {
  const raw: Pt[] = [endPos(blocks, w.from), ...(w.via ?? []), endPos(blocks, w.to)];
  const pts: Pt[] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const a = pts[pts.length - 1];
    const b = raw[i];
    if (Math.abs(a[0] - b[0]) > 0.5 && Math.abs(a[1] - b[1]) > 0.5) {
      pts.push(w.vFirst ? [a[0], b[1]] : [b[0], a[1]]);
    }
    pts.push(b);
  }
  return pts;
}

export interface BlockIO {
  inputs: { port: string; signal: SignalId }[];
  outputs: { port: string; signal: SignalId }[];
}

/** Входы/выходы блоков, выведенные из проводов (для окна детализации). */
export function blockIO(def: MicroarchDef): Map<string, BlockIO> {
  const io = new Map<string, BlockIO>(def.blocks.map((b) => [b.id, { inputs: [], outputs: [] }]));
  const push = (list: { port: string; signal: SignalId }[], port: string, signal: SignalId) => {
    if (!list.some((x) => x.port === port)) list.push({ port, signal });
  };
  for (const w of def.wires) {
    if (typeof w.from === 'string') {
      const [b, p] = w.from.split('.');
      push(io.get(b)!.outputs, p, w.signal);
    }
    if (typeof w.to === 'string') {
      const [b, p] = w.to.split('.');
      push(io.get(b)!.inputs, p, w.signal);
    }
  }
  // порядок — как порты объявлены в блоке
  for (const b of def.blocks) {
    const order = (port: string) => b.ports.findIndex((p) => p.id === port);
    const x = io.get(b.id)!;
    x.inputs.sort((p, q) => order(p.port) - order(q.port));
    x.outputs.sort((p, q) => order(p.port) - order(q.port));
  }
  return io;
}
