/**
 * Многотактный процессор RISC-V (разд. 7.4) — декларативное описание схемы.
 * Общая память команд и данных, неархитектурные регистры (Instr, OldPC, Data, A, WriteData, ALUOut),
 * одно АЛУ на все вычисления; управляет конечный автомат.
 */
import type { BlockDef, MicroarchDef, SignalDef } from '../../core/types';
import { block, mux2, mux3, port, sig, stretchX, wireFactory } from '../dsl';
import { STATES, stateSequence } from './engine';
import { OP } from '../../isa/rv32i';

const C = (w: number, extra: Partial<SignalDef> = {}) => sig(w, 'control', { fmt: 'bin', ...extra });

const signals: MicroarchDef['signals'] = {
  PC: sig(32, 'data', { desc: 'Счётчик команд (после такта Fetch уже указывает на следующую инструкцию)' }),
  PCNext: sig(32, 'data', { desc: 'Вход регистра PC (= Result)' }),
  Adr: sig(32, 'data', { desc: 'Адрес памяти: PC (выборка команды) или Result (данные)' }),
  ReadData: sig(32, 'data', { desc: 'Слово, прочитанное из памяти' }),
  Instr: sig(32, 'data', { desc: 'Текущая инструкция (регистр команд)' }),
  OldPC: sig(32, 'data', { desc: 'Адрес текущей инструкции (PC до увеличения)' }),
  Data: sig(32, 'data', { desc: 'Данные, прочитанные из памяти в предыдущем такте' }),
  A1: sig(5, 'data', { label: 'Instr[19:15]', fmt: 'reg', desc: 'rs1' }),
  A2: sig(5, 'data', { label: 'Instr[24:20]', fmt: 'reg', desc: 'rs2' }),
  A3: sig(5, 'data', { label: 'Instr[11:7]', fmt: 'reg', desc: 'rd' }),
  ImmIn: sig(25, 'data', { label: 'Instr[31:7]' }),
  RD1: sig(32),
  RD2: sig(32),
  A: sig(32, 'data', { desc: 'Значение rs1, защёлкнутое в такте Decode' }),
  WriteData: sig(32, 'data', { desc: 'Значение rs2, защёлкнутое в такте Decode' }),
  ImmExt: sig(32),
  Const4: sig(32, 'data', { label: '4' }),
  SrcA: sig(32, 'data', { desc: 'Операнд A АЛУ: PC (00), OldPC (01) или A (10)' }),
  SrcB: sig(32, 'data', { desc: 'Операнд B АЛУ: WriteData (00), ImmExt (01) или 4 (10)' }),
  ALUResult: sig(32),
  ALUOut: sig(32, 'data', { desc: 'Результат АЛУ из предыдущего такта' }),
  Result: sig(32, 'data', { desc: 'ALUOut (00), Data (01) или ALUResult (10)' }),
  op: C(7, { desc: 'Instr[6:0]' }),
  funct3: C(3, { desc: 'Instr[14:12]' }),
  funct7b5: C(1, { label: 'funct7[5]', desc: 'Instr[30]' }),
  Zero: C(1),
  PCWrite: C(1, { desc: 'Разрешение записи PC: PCUpdate | (Branch & Zero)' }),
  AdrSrc: C(1, { desc: 'Адрес памяти: 0 — PC, 1 — Result' }),
  MemWrite: C(1),
  IRWrite: C(1, { desc: 'Разрешение записи регистра команд и OldPC' }),
  ResultSrc: C(2, { desc: '00 — ALUOut, 01 — Data, 10 — ALUResult' }),
  ALUControl: C(3, { desc: '000 add, 001 sub, 010 and, 011 or, 101 slt' }),
  ALUSrcA: C(2, { desc: '00 — PC, 01 — OldPC, 10 — A' }),
  ALUSrcB: C(2, { desc: '00 — WriteData, 01 — ImmExt, 10 — 4' }),
  ImmSrc: C(2, { desc: 'Формат константы: 00 I, 01 S, 10 B, 11 J' }),
  RegWrite: C(1),
  Branch: C(1, { desc: 'Внутренний сигнал FSM' }),
  PCUpdate: C(1, { desc: 'Внутренний сигнал FSM' }),
  ALUOp: C(2, { desc: 'Выход FSM → ALU Decoder' }),
  State: C(4, { desc: 'Номер состояния управляющего автомата' }),
};

const smallReg = (id: string, label: string, x: number, y: number, info: string, en?: 't' | 'b'): BlockDef =>
  block(id, 'register', label, x, y, 40, 50, [port('d', 'l', 25), port('q', 'r', 25), ...(en ? [port('en', en, 20)] : [])], { clocked: true, anim: 'reg', info });

const blocks: BlockDef[] = [
  block('PC', 'register', 'PC', 40, 300, 44, 60, [port('d', 'l', 30), port('q', 'r', 30), port('en', 't', 22, 'EN')], {
    clocked: true,
    anim: 'reg',
    info: 'Регистр PC с разрешением записи PCWrite. Обновляется в такте Fetch (PC + 4) и при выполненном переходе.',
  }),
  mux2('AdrMux', 120, 290, { anim: 'mux', info: 'Адрес памяти: PC (AdrSrc=0, выборка команды) или Result (AdrSrc=1, обращение к данным).' }),
  block('Mem', 'memory', 'Instr / Data\nMemory', 180, 270, 120, 130, [port('A', 'l', 60, 'A'), port('WD', 'l', 110, 'WD'), port('WE', 't', 60, 'WE'), port('RD', 'r', 40, 'RD')], {
    clocked: true,
    anim: 'umem',
    info: 'Общая память команд и данных. Чтение комбинационное, запись — по фронту CLK при MemWrite=1.',
  }),
  smallReg('OldPCReg', 'OldPC', 340, 205, 'Запоминает адрес текущей инструкции (нужен для вычисления адреса перехода). Записывается вместе с регистром команд (IRWrite).', 't'),
  smallReg('IR', 'Instr', 340, 285, 'Регистр команд: хранит инструкцию на протяжении всех её тактов. Записывается при IRWrite=1 (такт Fetch).', 'b'),
  smallReg('DataReg', 'Data', 340, 420, 'Регистр данных: запоминает прочитанное из памяти слово (для lw).'),
  block(
    'Control',
    'control',
    'Control Unit\n(Main FSM)',
    440,
    40,
    160,
    130,
    [
      port('op', 'l', 30, 'op'),
      port('funct3', 'l', 55, 'funct3'),
      port('funct7b5', 'l', 80, 'funct7₅'),
      port('IRWrite', 'l', 115),
      port('PCWrite', 't', 20),
      port('AdrSrc', 't', 35),
      port('MemWrite', 't', 50),
      port('Zero', 'r', 10),
      port('ResultSrc', 'r', 30),
      port('ALUSrcB', 'r', 50),
      port('ALUControl', 'r', 70),
      port('ALUSrcA', 'r', 90),
      port('ImmSrc', 'r', 110),
      port('RegWrite', 'b', 140),
    ],
    {
      clocked: true,
      anim: 'fsm',
      info: 'Устройство управления: конечный автомат (Main FSM) выдаёт сигналы для текущего такта; ALU Decoder и Instr Decoder (ImmSrc) — комбинационные.',
    },
  ),
  block(
    'RF',
    'regfile',
    'Register\nFile',
    480,
    250,
    130,
    150,
    [port('A1', 'l', 30, 'A1'), port('A2', 'l', 60, 'A2'), port('A3', 'l', 90, 'A3'), port('WD3', 'l', 125, 'WD3'), port('WE3', 't', 100, 'WE3'), port('RD1', 'r', 30, 'RD1'), port('RD2', 'r', 85, 'RD2')],
    { clocked: true, anim: 'regfile', info: 'Регистровый файл: чтение в такте Decode, запись в последнем такте инструкции (MemWB / ALUWB).' },
  ),
  smallReg('AReg', 'A', 650, 255, 'Регистр A: значение rs1, прочитанное в Decode.'),
  smallReg('BReg', 'B', 650, 310, 'Регистр WriteData (B): значение rs2, прочитанное в Decode.'),
  block('Ext', 'extend', 'Extend', 480, 450, 110, 44, [port('in', 'l', 22), port('out', 'r', 22), port('ImmSrc', 't', 90)], { anim: 'extend', info: 'Расширение константы согласно ImmSrc.' }),
  mux3('SrcAMux', 750, 220, 100, [20, 50, 80], { anim: 'mux', info: 'Операнд A АЛУ: PC (00), OldPC (01), A (10).' }),
  mux3('SrcBMux', 750, 350, 100, [20, 50, 80], { anim: 'mux', info: 'Операнд B АЛУ: WriteData (00), ImmExt (01), константа 4 (10).' }, 'b'),
  block('ALU', 'alu', 'ALU', 820, 230, 70, 200, [port('a', 'l', 40), port('b', 'l', 170), port('ctl', 't', 35), port('zero', 'r', 70), port('y', 'r', 100)], {
    anim: 'alu',
    info: 'Единственное АЛУ: считает и PC + 4, и адрес перехода, и адрес памяти, и результат инструкции — в разных тактах.',
  }),
  smallReg('ALUOutReg', 'ALU\nOut', 930, 305, 'Регистр ALUOut: результат АЛУ, сохранённый для следующего такта.'),
  mux3('ResultMux', 1020, 300, 110, [30, 55, 80], { anim: 'mux', info: 'Result: ALUOut (00), Data (01), ALUResult (10). Идёт в PC, на адрес памяти и на запись в регистр.' }),
];

const w = wireFactory();
const TR = 410;
const sel = (signal: string, value: number) => ({ signal, value });

const wires = [
  w('PC', 'PC.q', [100, 330], { stack: true }),
  w('PC', [100, 330], 'AdrMux.in0', { via: [[100, 310]], when: sel('AdrSrc', 0), requires: ['Adr'], noLabel: true }),
  w('PC', [100, 310], 'OldPCReg.d', { via: [[100, 230]], requires: ['IRWrite'], noLabel: true, dotStart: true }),
  w('PC', [100, 230], 'SrcAMux.in0', { via: [[100, 190], [720, 190], [720, 240]], when: sel('ALUSrcA', 0), requires: ['SrcA'], noLabel: true, dotStart: true }),
  w('Adr', 'AdrMux.out', 'Mem.A', { stack: true }),
  w('ReadData', 'Mem.RD', [320, 310], { stack: true, labelDx: 8 }),
  w('ReadData', [320, 310], 'IR.d', { requires: ['IRWrite'], noLabel: true }),
  w('ReadData', [320, 310], 'DataReg.d', { via: [[320, 445]], requires: ['DataLatch'], noLabel: true, dotStart: true }),
  w('Instr', 'IR.q', [TR, 310], { labelDy: 100, labelDx: 53, stack: true }),
  w('op', [TR, 310], 'Control.op', { via: [[TR, 70]], labelSeg: -1 }),
  w('funct3', [TR, 310], 'Control.funct3', { via: [[TR, 95]], labelSeg: -1 }),
  w('funct7b5', [TR, 310], 'Control.funct7b5', { via: [[TR, 120]], labelSeg: -1 }),
  w('A1', [TR, 310], 'RF.A1', { via: [[TR, 280]], labelSeg: -1 }),
  w('A2', [TR, 310], 'RF.A2', { labelSeg: -1 }),
  w('A3', [TR, 310], 'RF.A3', { via: [[TR, 340]], labelSeg: -1 }),
  w('ImmIn', [TR, 310], 'Ext.in', { via: [[TR, 472]], labelSeg: -1 }),
  w('RD1', 'RF.RD1', 'AReg.d', { stack: true }),
  w('RD2', 'RF.RD2', 'BReg.d', { stack: true }),
  w('A', 'AReg.q', 'SrcAMux.in2', { via: [[720, 280], [720, 300]], when: sel('ALUSrcA', 2), requires: ['SrcA'], labelSeg: 0, stack: true }),
  w('OldPC', 'OldPCReg.q', 'SrcAMux.in1', { via: [[735, 230], [735, 270]], when: sel('ALUSrcA', 1), requires: ['SrcA'], labelSeg: 0 }),
  w('WriteData', 'BReg.q', [705, 335], { noLabel: true }),
  w('WriteData', [705, 335], 'SrcBMux.in0', { via: [[705, 370]], when: sel('ALUSrcB', 0), requires: ['SrcB'], noLabel: true }),
  w('WriteData', [705, 335], 'Mem.WD', { via: [[705, 555], [160, 555], [160, 380]], when: sel('MemWrite', 1), labelSeg: 1, dotStart: true }),
  w('ImmExt', 'Ext.out', 'SrcBMux.in1', { via: [[725, 472], [725, 400]], when: sel('ALUSrcB', 1), requires: ['SrcB'], labelSeg: 0, labelDx: -25 }),
  w('Const4', [734, 430], 'SrcBMux.in2', { when: sel('ALUSrcB', 2), requires: ['SrcB'], noLabel: true }),
  w('SrcA', 'SrcAMux.out', 'ALU.a', { stack: true }),
  w('SrcB', 'SrcBMux.out', 'ALU.b', { stack: true }),
  w('ALUResult', 'ALU.y', [910, 330], { noLabel: true }),
  w('ALUResult', [910, 330], 'ALUOutReg.d', { requires: ['ALUOutLatch'], noLabel: true }),
  w('ALUResult', [910, 330], 'ResultMux.in2', { via: [[910, 380]], when: sel('ResultSrc', 2), requires: ['Result'], dotStart: true, labelSeg: 1, labelDy: 16 }),
  w('Zero', 'ALU.zero', 'Control.Zero', { via: [[905, 300], [905, 50]], labelSeg: 2 }),
  w('ALUOut', 'ALUOutReg.q', 'ResultMux.in0', { when: sel('ResultSrc', 0), requires: ['Result'], stack: true, labelDy: -12 }),
  w('Data', 'DataReg.q', 'ResultMux.in1', { via: [[395, 445], [395, 530], [995, 530], [995, 355]], when: sel('ResultSrc', 1), requires: ['Result'], labelSeg: 2 }),
  w('Result', 'ResultMux.out', [1070, 585], { via: [[1070, 355]], labelSeg: 1, labelDx: -66, stack: true }),
  w('PCNext', [1070, 585], 'PC.d', { via: [[20, 585], [20, 330]], labelSeg: 0, labelDx: -420 }),
  w('Result', [1070, 585], 'AdrMux.in1', { via: [[105, 585], [105, 350]], when: sel('AdrSrc', 1), requires: ['Adr'], noLabel: true }),
  w('Result', [1070, 585], 'RF.WD3', { via: [[450, 585], [450, 375]], when: sel('RegWrite', 1), noLabel: true }),
  w('PCWrite', 'Control.PCWrite', 'PC.en', { via: [[460, 14], [62, 14]], labelSeg: 1 }),
  w('AdrSrc', 'Control.AdrSrc', 'AdrMux.sel', { via: [[475, 23], [131, 23]], labelSeg: 1, labelDx: 60, labelDy: 14 }),
  w('MemWrite', 'Control.MemWrite', 'Mem.WE', { via: [[490, 32], [240, 32]], labelSeg: 2, labelDy: -60 }),
  w('IRWrite', 'Control.IRWrite', 'OldPCReg.en', { via: [[360, 155]], labelSeg: 0, labelDx: -12 }),
  w('IRWrite', [395, 155], 'IR.en', { via: [[395, 350], [360, 350]], noLabel: true, dotStart: true }),
  w('RegWrite', 'Control.RegWrite', 'RF.WE3', { labelDy: -8 }),
  w('ImmSrc', 'Control.ImmSrc', 'Ext.ImmSrc', { via: [[630, 150], [630, 430], [570, 430]], labelSeg: 2, labelDx: 4 }),
  w('ALUSrcA', 'Control.ALUSrcA', 'SrcAMux.sel', { via: [[761, 130]], labelSeg: 0 }),
  w('ALUControl', 'Control.ALUControl', 'ALU.ctl', { via: [[855, 110]], labelSeg: 0, labelDx: 40 }),
  w('ALUSrcB', 'Control.ALUSrcB', 'SrcBMux.sel', { via: [[790, 90], [790, 470], [761, 470]], labelSeg: 0, labelDx: 20 }),
  w('ResultSrc', 'Control.ResultSrc', 'ResultMux.sel', { via: [[1031, 70]], labelSeg: 0, labelDx: 110 }),
];

/* описание автомата для окна Control Unit */
const OPS: [string, number][] = [['lw', OP.LW], ['sw', OP.SW], ['R', OP.R], ['I', OP.I], ['jal', OP.JAL], ['beq', OP.BEQ]];
function nextText(id: number): string {
  // переходы собираем по реальным путям инструкций через автомат
  const targets = new Map<number, string[]>();
  for (const [nm, op] of OPS) {
    const seq = stateSequence(op);
    const i = seq.indexOf(id);
    if (i < 0) continue;
    const n = seq[i + 1] ?? 0;
    targets.set(n, [...(targets.get(n) ?? []), nm]);
  }
  if (targets.size === 1) return `S${[...targets.keys()][0]}`;
  return [...targets.entries()].map(([n, ops]) => `${ops.join('/')}→S${n}`).join(', ');
}

const base: MicroarchDef = {
  id: 'riscv-multicycle',
  name: 'Многотактный',
  chapter: 'H&H RISC-V, гл. 7.4',
  width: 1200,
  height: 625,
  signals,
  blocks,
  wires,
  phases: [
    { id: 'comb', label: 'Состояние FSM: комбинационная логика', short: '•' },
    { id: 'edge', label: 'Фронт CLK', short: '↑' },
  ],
  notes: [{ x: 724, y: 434, text: '4', cls: 'const' }],
  hint: 'Инструкция выполняется за 3–5 коротких тактов; каждый такт — одно состояние управляющего автомата, АЛУ и память используются повторно.',
  fsm: {
    signal: 'State',
    states: STATES.map((s) => ({
      name: `S${s.id} ${s.name}`,
      outputs: Object.entries(s.out)
        .map(([k, v]) => (['IRWrite', 'PCUpdate', 'Branch', 'MemWrite', 'RegWrite'].includes(k) ? k : `${k}=${k === 'AdrSrc' ? v : (v as number).toString(2).padStart(2, '0')}`))
        .join(', '),
      next: nextText(s.id),
    })),
  },
};

// место под подписи: у выхода памяти и у полей инструкции
export const multicycleDef: MicroarchDef = stretchX(stretchX(base, 310, 30), 445, 50);
