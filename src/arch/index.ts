/**
 * Реестр микроархитектур. Чтобы добавить новую (другая глава, другой процессор):
 *   1) описать схему (MicroarchDef) — блоки, порты, провода, сигналы;
 *   2) написать движок simulate(program) → Trace;
 *   3) добавить ArchModule в этот массив.
 * UI ничего не знает о конкретных архитектурах.
 */
import type { ArchModule } from '../core/types';
import { multicycle } from './riscv-multicycle';
import { simulatePipelined } from './riscv-pipelined/engine';
import { pipelinedDef } from './riscv-pipelined/layout';
import { simulateSingle } from './riscv-single/engine';
import { singleCycleDef } from './riscv-single/layout';

export const ARCHS: ArchModule[] = [
  {
    def: singleCycleDef,
    summary: 'Одна инструкция за один длинный такт.',
    simulate: simulateSingle,
    examples: ['lw', 'sw', 'add', 'beq', 'jal', 'book'],
  },
  {
    def: pipelinedDef,
    summary: 'Пять стадий, до пяти инструкций одновременно; Hazard Unit: forwarding, stall, flush.',
    simulate: simulatePipelined,
    examples: ['raw-forward', 'lw-stall', 'branch-flush', 'hazard-mix', 'book', 'lw', 'sw', 'add', 'beq', 'jal'],
  },
  multicycle,
];

export function archById(id: string): ArchModule {
  return ARCHS.find((a) => a.def.id === id) ?? ARCHS[0];
}
