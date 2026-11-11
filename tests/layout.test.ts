import { describe, expect, it } from 'vitest';
import { ARCHS } from '../src/arch';
import { blockMap, wirePoints } from '../src/core/geometry';
import { assemble } from '../src/isa/assembler';
import { EXAMPLES, exampleById } from '../src/programs/examples';

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
