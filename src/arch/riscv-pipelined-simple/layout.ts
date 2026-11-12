/**
 * Упрощённая схема 5-стадийного конвейера «для тех, кто видит это впервые»:
 * только главные блоки и одна линия данных. Описание такое же декларативное, как у
 * подробных схем; есть два варианта компоновки — горизонтальный (ПК) и вертикальный (телефон).
 */
import type { BlockDef, MicroarchDef, StageDef, WireDef } from '../../core/types';
import { block, port, sig, wireFactory } from '../dsl';

const STAGES: { id: string; label: string; hint: string; color: string }[] = [
  { id: 'F', label: 'Взять', hint: 'команду из памяти', color: '#FFB703' },
  { id: 'D', label: 'Разобрать', hint: 'какие числа нужны', color: '#52C41A' },
  { id: 'E', label: 'Посчитать', hint: 'выполнить действие', color: '#3A86FF' },
  { id: 'M', label: 'Память', hint: 'прочитать или сохранить', color: '#B565F5' },
  { id: 'W', label: 'Записать', hint: 'ответ в регистр', color: '#FF6B6B' },
];

const signals: MicroarchDef['signals'] = {
  PCF: sig(32, 'data', { stage: 'F' }),
  InstrF: sig(32, 'data', { stage: 'F' }),
  InstrD: sig(32, 'data', { stage: 'D' }),
  OperandsD: sig(32, 'data', { stage: 'D' }),
  OperandsE: sig(32, 'data', { stage: 'E' }),
  ResultE: sig(32, 'data', { stage: 'E' }),
  ResultM: sig(32, 'data', { stage: 'M' }),
  DataM: sig(32, 'data', { stage: 'M' }),
  ResultW: sig(32, 'data', { stage: 'W' }),
  WriteBackW: sig(32, 'data', { stage: 'W' }),
};

const INFO = {
  PC: 'Счётчик команд: помнит, какую команду брать следующей.',
  IMem: 'Память команд: здесь лежит программа.',
  Regs: 'Регистры: маленькие ячейки с числами прямо внутри процессора.',
  ALU: 'АЛУ — «калькулятор» процессора: складывает, вычитает, сравнивает.',
  DMem: 'Память данных: большое хранилище чисел.',
  Done: 'Готовый ответ отправляется обратно в регистры.',
};

export function buildSimpleDef(vertical: boolean): MicroarchDef {
  const w = wireFactory();
  const blocks: BlockDef[] = [];
  const wires: WireDef[] = [];
  const stages: StageDef[] = [];
  const st = (i: number) => stages[i];

  if (!vertical) {
    /* ---------- горизонтально: стадии — колонки ---------- */
    const BW = 220;
    const STEP = 232;
    const Y = 200; // линия данных
    STAGES.forEach((s, i) => {
      const x0 = 14 + i * STEP;
      stages.push({ ...s, x0, x1: x0 + BW, y0: 10, y1: 450, anchor: [x0 + BW / 2, 340] });
    });
    const mid = (id: string, type: BlockDef['type'], label: string, i: number, wd: number, hg: number, dx = 0) =>
      block(id, type, label, st(i).x0 + (BW - wd) / 2 + dx, Y - hg / 2, wd, hg, [port('in', 'l', hg / 2), port('out', 'r', hg / 2), port('back', 'b', wd / 2)], {
        stage: STAGES[i].id,
        info: INFO[id as keyof typeof INFO],
      });
    blocks.push(
      block('PC', 'register', 'Счёт-\nчик', st(0).x0 + 10, Y - 28, 58, 56, [port('out', 'r', 28)], { stage: 'F', info: INFO.PC }),
      mid('IMem', 'memory', 'Память\nкоманд', 0, 120, 92, 38),
      mid('Regs', 'regfile', 'Регистры', 1, 140, 92),
      mid('ALU', 'logic', 'АЛУ', 2, 120, 92),
      mid('DMem', 'memory', 'Память\nданных', 3, 140, 92),
      mid('Done', 'logic', 'Ответ', 4, 100, 64),
    );
    for (let i = 0; i < 4; i++) {
      blocks.push(block(`Gate${i}`, 'pipereg', '', st(i).x1 + 1, Y - 46, STEP - BW - 2, 92, [port('in', 'l', 46), port('out', 'r', 46)], { stage: STAGES[i + 1].id }));
    }
    wires.push(
      w('PCF', 'PC.out', 'IMem.in'),
      w('InstrF', 'IMem.out', 'Gate0.in'),
      w('InstrD', 'Gate0.out', 'Regs.in'),
      w('OperandsD', 'Regs.out', 'Gate1.in'),
      w('OperandsE', 'Gate1.out', 'ALU.in'),
      w('ResultE', 'ALU.out', 'Gate2.in'),
      w('ResultM', 'Gate2.out', 'DMem.in'),
      w('DataM', 'DMem.out', 'Gate3.in'),
      w('ResultW', 'Gate3.out', 'Done.in'),
      w('WriteBackW', 'Done.back', 'Regs.back', { via: [[st(4).x0 + BW / 2, 282], [st(1).x0 + BW / 2, 282]] }),
    );
    return make(false, 14 + 5 * STEP - (STEP - BW) + 14, 460, blocks, wires, stages);
  }

  /* ---------- вертикально: стадии — строки ---------- */
  // слева — название станции и жетон команды, справа — блоки и линия данных
  const BH = 166;
  const STEP = 174;
  const X = 300; // линия данных
  STAGES.forEach((s, i) => {
    const y0 = 8 + i * STEP;
    stages.push({ ...s, x0: 6, x1: 394, y0, y1: y0 + BH, anchor: [108, y0 + 106] });
  });
  const cy = (i: number) => st(i).y0! + (i === 0 ? 112 : 92);
  const mid = (id: string, type: BlockDef['type'], label: string, i: number, wd: number, hg: number) =>
    block(id, type, label, X - wd / 2, cy(i) - hg / 2, wd, hg, [port('in', 't', wd / 2), port('out', 'b', wd / 2), port('back', 'r', hg / 2)], {
      stage: STAGES[i].id,
      info: INFO[id as keyof typeof INFO],
    });
  blocks.push(
    block('PC', 'register', 'Счётчик', X - 42, st(0).y0! + 12, 84, 34, [port('out', 'b', 42)], { stage: 'F', info: INFO.PC }),
    mid('IMem', 'memory', 'Память\nкоманд', 0, 112, 66),
    mid('Regs', 'regfile', 'Регистры', 1, 120, 66),
    mid('ALU', 'logic', 'АЛУ', 2, 104, 66),
    mid('DMem', 'memory', 'Память\nданных', 3, 120, 66),
    mid('Done', 'logic', 'Ответ', 4, 90, 54),
  );
  for (let i = 0; i < 4; i++) {
    blocks.push(block(`Gate${i}`, 'pipereg', '', X - 46, st(i).y1!, 92, STEP - BH, [port('in', 't', 46), port('out', 'b', 46)], { stage: STAGES[i + 1].id }));
  }
  wires.push(
    w('PCF', 'PC.out', 'IMem.in'),
    w('InstrF', 'IMem.out', 'Gate0.in'),
    w('InstrD', 'Gate0.out', 'Regs.in'),
    w('OperandsD', 'Regs.out', 'Gate1.in'),
    w('OperandsE', 'Gate1.out', 'ALU.in'),
    w('ResultE', 'ALU.out', 'Gate2.in'),
    w('ResultM', 'Gate2.out', 'DMem.in'),
    w('DataM', 'DMem.out', 'Gate3.in'),
    w('ResultW', 'Gate3.out', 'Done.in'),
    w('WriteBackW', 'Done.back', 'Regs.back', { via: [[381, cy(4)], [381, cy(1)]] }),
  );
  return make(true, 400, 8 + 5 * STEP, blocks, wires, stages);
}

function make(vertical: boolean, width: number, height: number, blocks: BlockDef[], wires: WireDef[], stages: StageDef[]): MicroarchDef {
  for (const x of wires) x.noLabel = true;
  return {
    id: 'riscv-pipelined-simple',
    name: vertical ? 'Конвейер (просто, вертикально)' : 'Конвейер (просто)',
    chapter: 'Упрощённая схема 5-стадийного конвейера',
    width,
    height,
    signals,
    blocks,
    wires,
    stages,
    phases: [{ id: 'tick', label: 'Тик', short: '•' }],
  };
}
