import { describe, expect, it } from 'vitest';
import { ARCHS } from '../src/arch';
import { blockMap, wirePoints } from '../src/core/geometry';
import { assemble } from '../src/isa/assembler';
import { EXAMPLES, exampleById } from '../src/programs/examples';

import { buildSimpleDef, simplePipelined, SIMPLE_PROGRAM } from '../src/arch/riscv-pipelined-simple';

const real = ARCHS.filter((a) => !a.def.stub);

describe('layout ↔ engine consistency', () => {
  for (const arch of real) {
    const def = arch.def;
    describe(def.id, () => {
      it('wires reference existing signals, blocks and ports; all segments are orthogonal', () => {
        const bm = blockMap(def);
        for (const w of def.wires) {
          expect(def.signals[w.signal], `signal ${w.signal}`).toBeDefined();
          if (w.when) expect(def.signals[w.when.signal], `when ${w.when.signal}`).toBeDefined();
          const pts = wirePoints(bm, w);
          for (let i = 1; i < pts.length; i++) {
            const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
            const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
            expect(dx < 0.5 || dy < 0.5, `wire ${w.id} segment ${i} is diagonal`).toBe(true);
          }
          for (const p of pts) {
            expect(p[0] >= 0 && p[0] <= def.width && p[1] >= 0 && p[1] <= def.height, `wire ${w.id} out of canvas`).toBe(true);
          }
        }
      });

      it('every signal has a wire or is internal; every example produces a consistent trace', () => {
        const phaseIds = new Set(def.phases.map((p) => p.id));
        const blockIds = new Set(def.blocks.map((b) => b.id));
        for (const id of arch.examples) {
          const ex = exampleById(id)!;
          const t = arch.simulate(assemble(ex.source));
          expect(t.steps.length, id).toBeGreaterThan(0);
          expect(t.warnings, id).toEqual([]);
          for (const s of t.steps) {
            expect(phaseIds.has(s.phase)).toBe(true);
            for (const k of Object.keys(s.values)) expect(def.signals[k], `${id}: value for unknown signal ${k}`).toBeDefined();
            for (const b of [...s.activeBlocks, ...(s.latching ?? []), ...(s.stalled ?? []), ...(s.flushed ?? [])]) {
              expect(blockIds.has(b), `${id}: unknown block ${b}`).toBe(true);
            }
            if (def.stages) for (const st of def.stages) expect(s.stages[st.id], `${id}: stage ${st.id}`).toBeDefined();
            expect(s.what.length).toBeGreaterThan(0);
            expect(s.regs[0]).toBe(0);
          }
        }
      });

      it('requires/when only mention signals the engine can activate', () => {
        const seen = new Set<string>();
        for (const e of EXAMPLES) for (const s of arch.simulate(assemble(e.source)).steps) s.active.forEach((a) => seen.add(a));
        for (const w of def.wires) for (const r of w.requires ?? []) expect(seen.has(r), `wire ${w.id} requires never-active ${r}`).toBe(true);
      });
    });
  }
});

describe('simple («Просто») pipeline', () => {
  const p = assemble(SIMPLE_PROGRAM);
  const t = simplePipelined.simulate(p);
  it('one step per tick, framed by start and finish steps', () => {
    expect(t.steps.length).toBe(p.instrs.length + 4 + 2);
    expect(Object.values(t.steps[0].stages).every((s) => s.status === 'empty')).toBe(true);
    expect(Object.values(t.steps[t.steps.length - 1].stages).every((s) => s.status === 'empty')).toBe(true);
    expect(t.warnings).toEqual([]);
  });
  it('each instruction visits stations 1..5 in order, one per tick', () => {
    p.instrs.forEach((ins, k) => {
      ['F', 'D', 'E', 'M', 'W'].forEach((st, j) => expect(t.steps[1 + k + j].stages[st].idx, `${ins.text} @${st}`).toBe(ins.idx));
    });
  });
  it('speaks plain language and ends with the right answers', () => {
    expect(t.steps[1].stages.F.text).toBe('x3 = x1 + x2');
    expect(t.steps[3].stages.E.detail).toBe('5 + 7 = 12');
    expect(t.steps[5].stages.W.detail).toBe('x3 = 12');
    const last = t.steps[t.steps.length - 1];
    expect([last.regs[3], last.regs[4], last.regs[5], last.regs[6], last.mem[36]]).toEqual([12, 2, 42, 15, 12]);
  });
  it('both layouts are consistent with the trace', () => {
    for (const def of [buildSimpleDef(false), buildSimpleDef(true)]) {
      const bm = blockMap(def);
      const blockIds = new Set(def.blocks.map((b) => b.id));
      for (const w of def.wires) {
        expect(def.signals[w.signal]).toBeDefined();
        const pts = wirePoints(bm, w);
        for (let i = 1; i < pts.length; i++) expect(Math.abs(pts[i][0] - pts[i - 1][0]) < 0.5 || Math.abs(pts[i][1] - pts[i - 1][1]) < 0.5, `${def.name}: ${w.id}`).toBe(true);
      }
      for (const st of def.stages!) expect(st.anchor).toBeDefined();
      for (const s of t.steps) {
        for (const a of s.active) expect(def.signals[a], a).toBeDefined();
        for (const b of s.activeBlocks) expect(blockIds.has(b), b).toBe(true);
      }
    }
  });
});
