/**
 * Упрощённая трасса конвейера: один шаг = один «тик» часов.
 * Считает всё настоящий движок конвейерного процессора (riscv-pipelined/engine.ts);
 * здесь его подробная трасса сворачивается до «какая команда на какой станции и что с ней делают».
 */
import type { Program, SignalId, StageSlot, Trace, TraceStep } from '../../core/types';
import { classify, extend, fields, s32, usage } from '../../isa/rv32i';
import { simulatePipelined } from '../riscv-pipelined/engine';

const ST = ['F', 'D', 'E', 'M', 'W'] as const;
const OPS: Record<string, string> = { add: '+', sub: '−', and: 'и', or: 'или', slt: '<', addi: '+', andi: 'и', ori: 'или', slti: '<' };
const n = (v: number | undefined) => (v === undefined ? '?' : String(s32(v)));
const x = (i: number) => `x${i}`;

/** Адрес ячейки памяти «человеческим» языком: память[32] или память[x9 − 4]. */
function cell(instr: number, immSrc: number): string {
  const f = fields(instr);
  const imm = s32(extend(instr, immSrc));
  if (f.rs1 === 0) return `память[${imm}]`;
  return `память[${x(f.rs1)}${imm === 0 ? '' : imm > 0 ? ` + ${imm}` : ` − ${-imm}`}]`;
}

/** Команда простыми словами: «x3 = x1 + x2». */
export function friendly(instr: number, asm: string): string {
  const f = fields(instr);
  const mnem = asm.trim().split(/\s+/)[0].toLowerCase();
  switch (classify(instr)) {
    case 'R':
      return `${x(f.rd)} = ${x(f.rs1)} ${OPS[mnem] ?? '?'} ${x(f.rs2)}`;
    case 'I': {
      const imm = s32(extend(instr, 0));
      if (mnem === 'addi' && f.rs1 === 0) return `${x(f.rd)} = ${imm}`;
      if (mnem === 'addi' && imm < 0) return `${x(f.rd)} = ${x(f.rs1)} − ${-imm}`;
      return `${x(f.rd)} = ${x(f.rs1)} ${OPS[mnem] ?? '?'} ${imm}`;
    }
    case 'lw':
      return `${x(f.rd)} = ${cell(instr, 0)}`;
    case 'sw':
      return `${cell(instr, 1)} = ${x(f.rs2)}`;
    case 'beq':
      return `если ${x(f.rs1)} = ${x(f.rs2)} — прыжок`;
    case 'jal':
      return 'прыжок';
    default:
      return asm;
  }
}

/** Что происходит с командой на станции — одна короткая строка. */
function detail(stage: (typeof ST)[number], instr: number, asm: string, v: Record<SignalId, number>): string {
  const f = fields(instr);
  const cls = classify(instr);
  const use = usage(cls);
  const mnem = asm.trim().split(/\s+/)[0].toLowerCase();
  switch (stage) {
    case 'F':
      return 'взяли команду';
    case 'D': {
      const parts: string[] = [];
      if (use.rs1 && f.rs1 !== 0) parts.push(`${x(f.rs1)} = ${n(v.RD1D)}`);
      if (use.rs2 && f.rs2 !== 0) parts.push(`${x(f.rs2)} = ${n(v.RD2D)}`);
      if (parts.length) return parts.join(', ');
      return cls === 'lw' || cls === 'sw' ? 'нужна ячейка памяти' : 'числа готовы';
    }
    case 'E':
      if (cls === 'lw' || cls === 'sw') return `адрес ячейки: ${n(v.ALUResultE)}`;
      if (cls === 'jal') return 'считаем, куда прыгать';
      if (cls === 'beq') return v.ZeroE ? 'равны — прыгаем' : 'не равны — едем дальше';
      return `${n(v.SrcAE)} ${OPS[mnem] ?? '+'} ${n(v.SrcBE)} = ${n(v.ALUResultE)}`;
    case 'M':
      if (cls === 'lw') return `прочитали ${n(v.ReadDataM)}`;
      if (cls === 'sw') return `сохранили ${n(v.WriteDataM)}`;
      return 'память не нужна';
    case 'W':
      if (use.writesReg && f.rd !== 0) return `${x(f.rd)} = ${n(v.ResultW)}`;
      return 'готово';
  }
}

const SIG: Record<(typeof ST)[number], SignalId[]> = {
  F: ['PCF', 'InstrF'],
  D: ['InstrD', 'OperandsD'],
  E: ['OperandsE', 'ResultE'],
  M: ['ResultM', 'DataM'],
  W: ['ResultW'],
};
const BLK: Record<(typeof ST)[number], string[]> = { F: ['PC', 'IMem'], D: ['Regs'], E: ['ALU'], M: [], W: ['Done'] };
const emptySlots = (): Record<string, StageSlot> => Object.fromEntries(ST.map((s) => [s, { idx: null, text: '', status: 'empty' as const }]));

export function simulateSimple(program: Program): Trace {
  const full = simulatePipelined(program);
  const steps: TraceStep[] = [];
  const first = full.steps[0];
  const base = { phase: 'tick', values: {}, active: [], fresh: [], activeBlocks: [], events: [], why: '' };

  steps.push({ ...base, cycle: 0, stages: emptySlots(), title: 'Старт', what: 'Команды ждут своей очереди.', regs: initialRegs(program), mem: { ...first.mem }, tick: '▶' });

  for (let c = 1; c <= full.cycles; c++) {
    const st = full.steps.find((s) => s.cycle === c && s.phase === 'stages')!;
    const edge = full.steps.find((s) => s.cycle === c && s.phase === 'edge')!;
    const stages = emptySlots();
    const active: SignalId[] = [];
    const blocks: string[] = [];
    for (const id of ST) {
      const slot = st.stages[id];
      if (slot.status !== 'instr' || slot.idx === null) continue;
      const ins = program.instrs[slot.idx];
      stages[id] = { idx: slot.idx, uid: slot.uid, status: 'instr', text: friendly(ins.word, ins.text), detail: detail(id, ins.word, ins.text, st.values) };
      active.push(...SIG[id]);
      blocks.push(...BLK[id]);
      const cls = classify(ins.word);
      if (id === 'M' && (cls === 'lw' || cls === 'sw')) blocks.push('DMem');
      if (id === 'W' && st.values.RegWriteW && st.values.RdW) active.push('WriteBackW');
    }
    const busy = ST.filter((id) => stages[id].status === 'instr').length;
    steps.push({
      ...base,
      cycle: c,
      values: { ResultW: st.values.ResultW },
      active,
      fresh: active,
      activeBlocks: blocks,
      stages,
      title: `Тик ${c}`,
      what: `На конвейере ${busy} ${busy === 1 ? 'команда' : busy < 5 ? 'команды' : 'команд'}.`,
      regs: st.regs.slice(),
      mem: { ...edge.mem },
      changedReg: st.changedReg,
      changedMem: edge.changedMem,
    });
  }

  const last = steps[steps.length - 1];
  steps.push({ ...base, cycle: full.cycles + 1, stages: emptySlots(), title: 'Готово', what: 'Все команды выполнены.', regs: last.regs.slice(), mem: { ...last.mem }, tick: '✓' });
  return { archId: 'riscv-pipelined-simple', program, steps, cycles: full.cycles + 1, pipeline: full.pipeline, warnings: full.warnings };
}

function initialRegs(p: Program): number[] {
  const r = new Array<number>(32).fill(0);
  for (const [i, v] of Object.entries(p.initRegs)) if (Number(i) !== 0) r[Number(i)] = v >>> 0;
  return r;
}
