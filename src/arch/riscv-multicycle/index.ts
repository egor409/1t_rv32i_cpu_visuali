/**
 * Многотактный процессор (разд. 7.4) — ЗАГЛУШКА (веха M3).
 * TODO(M3): описать схему (общая память, регистры Instr/Data/A/B/ALUOut, FSM управления)
 *           и движок, пишущий трассу по состояниям конечного автомата
 *           (Fetch, Decode, MemAdr, MemRead, MemWB, MemWrite, ExecuteR, ExecuteI, ALUWB, BEQ, JAL).
 */
import type { ArchModule, MicroarchDef } from '../../core/types';

const def: MicroarchDef = {
  id: 'riscv-multicycle',
  name: 'Многотактный',
  chapter: 'H&H RISC-V, гл. 7.4',
  width: 900,
  height: 360,
  signals: {},
  blocks: [
    {
      id: 'Stub',
      type: 'stub',
      label: 'Multicycle — в разработке (веха M3)\nСхема и движок будут добавлены как ещё один ArchModule.',
      x: 150,
      y: 110,
      w: 600,
      h: 140,
      ports: [],
    },
  ],
  wires: [],
  phases: [],
  stub: true,
};

export const multicycle: ArchModule = {
  def,
  summary: 'Заглушка: многотактная микроархитектура появится в M3.',
  examples: [],
  simulate: (program) => ({ archId: def.id, program, steps: [], cycles: 0, warnings: ['Многотактный процессор ещё не реализован (M3).'] }),
};
