/** Мини-анимации блоков (M2). Пока заглушка — заполняется позже. */
import type { BlockIO } from '../core/geometry';
import type { BlockDef, MicroarchDef, Trace, TraceStep } from '../core/types';
import type { NumFmt } from './format';

export function renderAnim(_b: BlockDef, _io: BlockIO, _step: TraceStep | null, _trace: Trace, _def: MicroarchDef, _fmt: NumFmt): Element | null {
  return null;
}
