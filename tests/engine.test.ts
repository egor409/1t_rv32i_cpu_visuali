import { describe, expect, it } from 'vitest';
import { assemble } from '../src/isa/assembler';
import { disasm, extend } from '../src/isa/rv32i';
import { simulateSingle } from '../src/arch/riscv-single/engine';
import { simulatePipelined } from '../src/arch/riscv-pipelined/engine';
import { simulateMulticycle, stateSequence } from '../src/arch/riscv-multicycle/engine';
import { OP } from '../src/isa/rv32i';
import { EXAMPLES, exampleById } from '../src/programs/examples';

const src = (id: string) => exampleById(id)!.source;
const last = <T,>(a: T[]) => a[a.length - 1];

describe('assembler', () => {
  it('encodes book examples', () => {
    // разд. 7.3: lw x6, -4(x9) = 0xFFC4A303 ; sw x6, 8(x9) = 0x0064A423 ; or x4,x5,x6 = 0x0062E233 ; beq x4,x4,L7(-12) = 0xFE420AE3
    const p = assemble('lw x6, -4(x9)\nsw x6, 8(x9)\nor x4, x5, x6\nbeq x4, x4, -12');
    expect(p.instrs.map((i) => i.word.toString(16))).toEqual(['ffc4a303', '64a423', '62e233', 'fe420ae3']);
  });
  it('roundtrips immediates', () => {
    const p = assemble('a: addi x1, x0, -5\nbeq x1, x1, a\njal x1, a\njal x2, 8');
    expect(extend(p.instrs[0].word, 0) | 0).toBe(-5);
    expect(extend(p.instrs[1].word, 2) | 0).toBe(-4);
    expect(extend(p.instrs[2].word, 3) | 0).toBe(-8);
    expect(disasm(p.instrs[3].word, 12)).toBe('jal x2, 0x14');
  });
  it('reports errors with line', () => {
    expect(() => assemble('addi x1, x0, 1\nmul x1, x2, x3')).toThrow(/строка 2/);
    expect(() => assemble('addi x1, x0, 5000')).toThrow(/12 бит/);
  });
});

describe('single-cycle', () => {
  it('lw example', () => {
    const t = simulateSingle(assemble(src('lw')));
    expect(t.cycles).toBe(1);
    expect(t.steps.length).toBe(5);
    expect(last(t.steps).regs[6]).toBe(10);
    const ex = t.steps[2];
    expect(ex.values.ALUResult).toBe(0x2000);
  });
  it('mini program', () => {
    const t = simulateSingle(assemble(src('book')));
    const r = last(t.steps).regs;
    expect([r[2], r[3], r[4], r[5], r[6], r[7], r[8]]).toEqual([5, 12, 13, 12, 12, 0, 1]);
    expect(last(t.steps).mem[96]).toBe(12);
  });
  it('jal', () => {
    const r = last(simulateSingle(assemble(src('jal'))).steps).regs;
    expect([r[1], r[5], r[6]]).toEqual([4, 0, 2]);
  });
});

describe('pipelined', () => {
  it('matches single-cycle on every example', () => {
    for (const e of EXAMPLES) {
      const p = assemble(e.source);
      const a = last(simulateSingle(p).steps);
      const b = last(simulatePipelined(p).steps);
      expect(b.regs, e.id).toEqual(a.regs);
      expect(b.mem, e.id).toEqual(a.mem);
    }
  });
  it('RAW forwarding', () => {
    const t = simulatePipelined(assemble(src('raw-forward')));
    // такт 4: sub в E, add в M → ForwardAE=10 ; такт 5: or в E, add в W → ForwardBE=01
    const c4 = t.steps.find((s) => s.cycle === 4 && s.phase === 'hazard')!;
    expect(c4.values.ForwardAE).toBe(2);
    const c5 = t.steps.find((s) => s.cycle === 5 && s.phase === 'hazard')!;
    expect(c5.values.ForwardBE).toBe(1);
    expect(t.cycles).toBe(8);
    expect(t.steps.every((s) => !s.values.StallF && !s.values.FlushE)).toBe(true);
  });
  it('lw stall', () => {
    const t = simulatePipelined(assemble(src('lw-stall')));
    const c3 = t.steps.find((s) => s.cycle === 3 && s.phase === 'hazard')!;
    expect([c3.values.StallF, c3.values.StallD, c3.values.FlushE, c3.values.FlushD]).toEqual([1, 1, 1, 0]);
    // такт 5: and в E, lw в W → ForwardAE=01
    const c5 = t.steps.find((s) => s.cycle === 5 && s.phase === 'hazard')!;
    expect(c5.values.ForwardAE).toBe(1);
    expect(t.cycles).toBe(9); // 4 инструкции + 4 + 1 такт задержки
    expect(last(t.steps).regs[8]).toBe(1);
    const row = t.pipeline!.find((r) => r.text.startsWith('and'))!;
    expect(row.cells[3]).toEqual({ stage: 'D', mark: 'stall' });
    expect(row.cells[4].stage).toBe('D');
  });
  it('mixed scenario contains stall, forwarding and flush', () => {
    const t = simulatePipelined(assemble(src('hazard-mix')));
    const kinds = new Set(t.steps.flatMap((s) => s.events.map((e) => e.kind)));
    expect(kinds.has('stall') && kinds.has('forward') && kinds.has('flush')).toBe(true);
    expect(last(t.steps).mem[0x44]).toBe(3);
  });
  it('branch flush', () => {
    const t = simulatePipelined(assemble(src('branch-flush')));
    const c3 = t.steps.find((s) => s.cycle === 3 && s.phase === 'hazard')!;
    expect([c3.values.PCSrcE, c3.values.FlushD, c3.values.FlushE]).toEqual([1, 1, 1]);
    const r = last(t.steps).regs;
    expect([r[5], r[6], r[7], r[8], r[9]]).toEqual([0, 0, 0, 10, 11]);
    expect(t.pipeline!.filter((x) => Object.values(x.cells).some((c) => c.mark === 'flush')).length).toBe(2);
  });
});

describe('multicycle', () => {
  it('matches single-cycle on every example', () => {
    for (const e of EXAMPLES) {
      const p = assemble(e.source);
      const a = last(simulateSingle(p).steps);
      const b = last(simulateMulticycle(p).steps);
      expect(b.regs, e.id).toEqual(a.regs);
      expect(b.mem, e.id).toEqual(a.mem);
    }
  });
  it('takes the number of cycles from the book: lw 5, sw 4, R/I 4, beq 3, jal 4', () => {
    expect(stateSequence(OP.LW).length).toBe(5);
    expect(stateSequence(OP.SW).length).toBe(4);
    expect(stateSequence(OP.R).length).toBe(4);
    expect(stateSequence(OP.I).length).toBe(4);
    expect(stateSequence(OP.BEQ).length).toBe(3);
    expect(stateSequence(OP.JAL).length).toBe(4);
    expect(simulateMulticycle(assemble(src('lw'))).cycles).toBe(5);
    expect(simulateMulticycle(assemble(src('sw'))).cycles).toBe(4);
  });
  it('fetch: PC+4 is computed by the ALU and written to PC; IR latches the instruction', () => {
    const t = simulateMulticycle(assemble(src('lw')));
    const f = t.steps[0];
    expect([f.values.State, f.values.ALUResult, f.values.PCWrite, f.values.IRWrite]).toEqual([0, 4, 1, 1]);
    const d = t.steps[2];
    expect([d.values.State, d.values.PC, d.values.OldPC, d.values.Instr >>> 0]).toEqual([1, 4, 0, 0xffc4a303]);
  });
  it('jal writes the return address and jumps', () => {
    const r = last(simulateMulticycle(assemble(src('jal'))).steps).regs;
    expect([r[1], r[5], r[6]]).toEqual([4, 0, 2]);
  });
});
