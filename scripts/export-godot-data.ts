/**
 * Готовит данные для Godot-версии (папка godot/): упрощённые схемы конвейера
 * (горизонтальная и вертикальная) и трассы программ. Считает всё тот же TypeScript-движок,
 * Godot только проигрывает — как и веб-интерфейс.
 *
 *   npx vite-node scripts/export-godot-data.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { SIMPLE_PROGRAM, buildSimpleDef, simplePipelined } from '../src/arch/riscv-pipelined-simple';
import { blockMap, wirePoints } from '../src/core/geometry';
import type { MicroarchDef } from '../src/core/types';
import { assemble } from '../src/isa/assembler';

function layout(def: MicroarchDef) {
  const bm = blockMap(def);
  return {
    width: def.width,
    height: def.height,
    stages: def.stages!.map((s) => ({ id: s.id, label: s.label, hint: s.hint, color: s.color, x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y1, anchor: s.anchor })),
    blocks: def.blocks.map((b) => ({ id: b.id, type: b.type, label: b.label, x: b.x, y: b.y, w: b.w, h: b.h, stage: b.stage ?? '', info: b.info ?? '' })),
    wires: def.wires.map((w) => ({ id: w.id, signal: w.signal, stage: def.signals[w.signal]?.stage ?? '', points: wirePoints(bm, w) })),
  };
}

const PROGRAMS = [
  { id: 'demo', title: 'Пять команд', source: SIMPLE_PROGRAM },
  // команды не зависят от результатов соседних — упрощённой схеме не нужно объяснять пересылку
  {
    id: 'six',
    title: 'Шесть команд',
    source: `.reg x1, 3
.reg x2, 4
.word 40, 10

lw   x3, 40(x0)
add  x4, x1, x2
sub  x5, x2, x1
addi x6, x1, 100
or   x7, x1, x2
sw   x4, 44(x0)
`,
  },
];

const traces = PROGRAMS.map((p) => {
  const prog = assemble(p.source, p.title);
  const t = simplePipelined.simulate(prog);
  return {
    id: p.id,
    title: p.title,
    instrs: prog.instrs.map((i) => ({ idx: i.idx, text: i.text })),
    steps: t.steps.map((s) => ({
      cycle: s.cycle,
      title: s.title,
      tick: s.tick ?? String(s.cycle),
      stages: Object.fromEntries(Object.entries(s.stages).map(([k, v]) => [k, { idx: v.idx, uid: v.uid ?? 0, status: v.status, text: v.text, detail: v.detail ?? '' }])),
      active: s.active,
      blocks: s.activeBlocks,
      regs: s.regs.map((x) => x | 0),
      mem: Object.fromEntries(Object.entries(s.mem).map(([a, v]) => [a, v | 0])),
      changedReg: s.changedReg ?? -1,
      changedMem: s.changedMem ?? -1,
    })),
  };
});

mkdirSync('godot/data', { recursive: true });
writeFileSync('godot/data/simple.json', JSON.stringify({ horizontal: layout(buildSimpleDef(false)), vertical: layout(buildSimpleDef(true)), programs: traces }));
console.log(`godot/data/simple.json: ${traces.length} программ(ы)`);
