import type { SignalDef } from '../core/types';
import { s32, u32 } from '../isa/rv32i';

export type NumFmt = 'hex' | 'dec';

export function fmtNum(v: number, mode: NumFmt, pad = 0): string {
  if (mode === 'dec') return String(s32(v));
  const s = u32(v).toString(16).toUpperCase();
  return '0x' + (pad ? s.padStart(pad, '0') : s);
}

/** Значение сигнала для подписи на схеме. */
export function fmtSignal(id: string, def: SignalDef | undefined, v: number | undefined, mode: NumFmt): string {
  if (v === undefined) return '';
  if (!def) return fmtNum(v, mode);
  if (def.fmt === 'reg') return `x${v}`;
  if (def.fmt === 'bin' || def.width <= 3) return u32(v).toString(2).padStart(def.width, '0');
  if (id.startsWith('Instr')) return fmtNum(v, 'hex', 8);
  if (id.startsWith('ImmIn')) return fmtNum(v, 'hex');
  return fmtNum(v, mode);
}

/** Развёрнутое значение для тултипа/окна детализации. */
export function fmtFull(def: SignalDef | undefined, v: number | undefined): string {
  if (v === undefined) return 'ещё не вычислено в этой фазе';
  const w = def?.width ?? 32;
  if (def?.fmt === 'reg') return `x${v} (${u32(v).toString(2).padStart(5, '0')})`;
  if (w <= 7) return `${u32(v).toString(2).padStart(w, '0')}₂ = ${v}`;
  return `${fmtNum(v, 'hex', 8)} = ${s32(v)}`;
}

/** Цвета динамических экземпляров инструкций (по uid). */
export const INSTR_COLORS = ['#e8590c', '#1971c2', '#2b8a3e', '#9c36b5', '#c2255c', '#0b7285', '#b08800', '#5f3dc4'];
export const instrColor = (uid: number | undefined) => (uid ? INSTR_COLORS[(uid - 1) % INSTR_COLORS.length] : '#868e96');
