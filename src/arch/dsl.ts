/** Маленький DSL для декларативного описания схем (блоки, порты, провода). */
import type { BlockDef, BlockType, PortDef, Side, SignalDef, SignalKind, WireDef, WireEnd } from '../core/types';

export const port = (id: string, side: Side, off: number, label?: string): PortDef => ({ id, side, off, label });

export function block(
  id: string,
  type: BlockType,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  ports: PortDef[],
  extra: Partial<BlockDef> = {},
): BlockDef {
  return { id, type, label, x, y, w, h, ports, ...extra };
}

type WireOpts = Omit<WireDef, 'id' | 'signal' | 'from' | 'to'>;

/** Счётчик для автоматических id проводов одного сигнала. */
export function wireFactory() {
  const seen = new Map<string, number>();
  return function wire(signal: string, from: WireEnd, to: WireEnd, opts: WireOpts = {}): WireDef {
    const n = (seen.get(signal) ?? 0) + 1;
    seen.set(signal, n);
    return { id: n === 1 ? signal : `${signal}#${n}`, signal, from, to, ...opts };
  };
}

export const sig = (width: number, kind: SignalKind = 'data', extra: Partial<SignalDef> = {}): SignalDef => ({
  width,
  kind,
  ...extra,
});

/** 2-входовый мультиплексор: порты in0, in1, sel (сверху или снизу), out. */
export function mux2(id: string, x: number, y: number, extra: Partial<BlockDef> = {}, selSide: Side = 't'): BlockDef {
  return block(id, 'mux', '', x, y, 22, 80, [port('in0', 'l', 20, '0'), port('in1', 'l', 60, '1'), port('sel', selSide, 11), port('out', 'r', 40)], extra);
}

/** 3-входовый мультиплексор высотой h. */
export function mux3(id: string, x: number, y: number, h: number, offs: [number, number, number], extra: Partial<BlockDef> = {}, selSide: Side = 't'): BlockDef {
  return block(
    id,
    'mux',
    '',
    x,
    y,
    22,
    h,
    [port('in0', 'l', offs[0], '00'), port('in1', 'l', offs[1], '01'), port('in2', 'l', offs[2], '10'), port('sel', selSide, 11), port('out', 'r', h / 2)],
    extra,
  );
}
