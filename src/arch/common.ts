/** Общие помощники движков. */
import type { Program, SignalId } from '../core/types';
import { hex, s32, u32 } from '../isa/rv32i';

export class Memory {
  private m = new Map<number, number>();
  constructor(init: Record<number, number> = {}) {
    for (const [a, v] of Object.entries(init)) this.m.set(Number(a) >>> 0, u32(v));
  }
  read(addr: number): number {
    return this.m.get(u32(addr) & ~3) ?? 0;
  }
  /** Значение ячейки или undefined, если в неё ещё не писали. */
  get(addr: number): number | undefined {
    return this.m.get(u32(addr) & ~3);
  }
  write(addr: number, v: number) {
    this.m.set(u32(addr) & ~3, u32(v));
  }
  /** Упомянуть адрес в снимке (чтобы чтение неинициализированной ячейки было видно в панели). */
  touch(addr: number) {
    const a = u32(addr) & ~3;
    if (!this.m.has(a)) this.m.set(a, 0);
  }
  snapshot(): Record<number, number> {
    const o: Record<number, number> = {};
    for (const [a, v] of [...this.m.entries()].sort((x, y) => x[0] - y[0])) o[a] = v;
    return o;
  }
}

export function initRegs(p: Program): number[] {
  const r = new Array<number>(32).fill(0);
  for (const [i, v] of Object.entries(p.initRegs)) if (Number(i) !== 0) r[Number(i)] = u32(v);
  return r;
}

/** Оставить в values только перечисленные сигналы. */
export function pick(all: Record<SignalId, number>, ids: Iterable<SignalId>): Record<SignalId, number> {
  const o: Record<SignalId, number> = {};
  for (const id of ids) if (id in all) o[id] = all[id];
  return o;
}

export const H = (x: number) => hex(x);
export const D = (x: number) => String(s32(x));
/** "0x2000 (8192)" — для пояснений. */
export const HD = (x: number) => (u32(x) < 10 ? String(u32(x)) : `${hex(x)} (${s32(x)})`);
export const bin = (x: number, w: number) => x.toString(2).padStart(w, '0');
