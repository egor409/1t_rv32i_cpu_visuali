/**
 * Однотактный процессор RISC-V (разд. 7.3) — декларативное описание схемы.
 * Компоновка собственная (не копия рисунка книги); имена сигналов — как в книге.
 */
import type { MicroarchDef, SignalDef } from '../../core/types';
import { block, mux2, mux3, port, sig, stretchX, wireFactory } from '../dsl';

const D32 = () => sig(32);
const C = (w: number, extra: Partial<SignalDef> = {}) => sig(w, 'control', { fmt: 'bin', ...extra });

const signals: MicroarchDef['signals'] = {
  PC: sig(32, 'data', { desc: 'Счётчик команд — адрес текущей инструкции' }),
  PCNext: sig(32, 'data', { desc: 'Адрес следующей инструкции (вход регистра PC)' }),
  PCPlus4: sig(32, 'data', { desc: 'PC + 4 — адрес следующей по порядку инструкции' }),
  PCTarget: sig(32, 'data', { desc: 'PC + ImmExt — адрес перехода (beq, jal)' }),
  Const4: sig(32, 'data', { label: '4' }),
  Instr: sig(32, 'data', { desc: '32-битная инструкция из памяти команд' }),
  A1: sig(5, 'data', { label: 'Instr[19:15]', fmt: 'reg', desc: 'rs1 — номер первого регистра-источника' }),
  A2: sig(5, 'data', { label: 'Instr[24:20]', fmt: 'reg', desc: 'rs2 — номер второго регистра-источника' }),
  A3: sig(5, 'data', { label: 'Instr[11:7]', fmt: 'reg', desc: 'rd — номер регистра назначения' }),
  ImmIn: sig(25, 'data', { label: 'Instr[31:7]', desc: 'Биты инструкции, из которых собирается константа' }),
  SrcA: sig(32, 'data', { desc: 'Первый операнд АЛУ = RD1 (значение rs1)' }),
  RD2: sig(32, 'data', { desc: 'Значение rs2 из регистрового файла' }),
  ImmExt: sig(32, 'data', { desc: 'Константа, расширенная до 32 бит' }),
  SrcB: sig(32, 'data', { desc: 'Второй операнд АЛУ: RD2 или ImmExt' }),
  ALUResult: D32(),
  WriteData: sig(32, 'data', { desc: 'Данные для записи в память (= RD2)' }),
  ReadData: sig(32, 'data', { desc: 'Слово, прочитанное из памяти данных' }),
  Result: sig(32, 'data', { desc: 'Значение для записи в регистр rd' }),
  op: C(7, { label: 'op', desc: 'Instr[6:0] — код операции' }),
  funct3: C(3, { desc: 'Instr[14:12]' }),
  funct7b5: C(1, { label: 'funct7[5]', desc: 'Instr[30]' }),
  Zero: C(1, { desc: 'Флаг АЛУ: результат равен нулю' }),
  PCSrc: C(1, { desc: 'Выбор следующего PC: 0 — PC+4, 1 — PCTarget. PCSrc = Branch & Zero | Jump' }),
  ResultSrc: C(2, { desc: '00 — ALUResult, 01 — ReadData, 10 — PC+4' }),
  MemWrite: C(1, { desc: 'Разрешение записи в память данных' }),
  ALUControl: C(3, { desc: '000 add, 001 sub, 010 and, 011 or, 101 slt' }),
  ALUSrc: C(1, { desc: 'Второй операнд АЛУ: 0 — RD2, 1 — ImmExt' }),
  ImmSrc: C(2, { desc: 'Формат константы: 00 I, 01 S, 10 B, 11 J' }),
  RegWrite: C(1, { desc: 'Разрешение записи в регистровый файл' }),
  Branch: C(1, { desc: 'Инструкция — условный переход (внутри Control Unit)' }),
  Jump: C(1, { desc: 'Инструкция — jal (внутри Control Unit)' }),
  ALUOp: C(2, { desc: 'Выход Main Decoder → ALU Decoder' }),
};

const blocks = [
  mux2('PCMux', 30, 290, { info: 'Выбирает следующий PC: PC+4 или адрес перехода PCTarget.', anim: 'mux' }),
  block('PC', 'register', 'PC', 80, 300, 44, 60, [port('d', 'l', 30), port('q', 'r', 30)], {
    clocked: true,
    anim: 'pc',
    info: 'Регистр счётчика команд. По фронту CLK защёлкивает PCNext.',
  }),
  block('IMem', 'memory', 'Instruction\nMemory', 170, 280, 110, 110, [port('A', 'l', 50, 'A'), port('RD', 'r', 50, 'RD')], {
    anim: 'imem',
    info: 'Память команд. Чтение комбинационное: по адресу A выдаёт 32-битную инструкцию на RD.',
  }),
  block('AddPC4', 'adder', '+', 180, 470, 46, 70, [port('a', 'l', 15), port('b', 'l', 55), port('y', 'r', 35)], {
    info: 'Сумматор PC + 4.',
  }),
  block(
    'Control',
    'control',
    'Control\nUnit',
    370,
    50,
    110,
    180,
    [
      port('op', 'l', 30, 'op'),
      port('funct3', 'l', 60, 'funct3'),
      port('funct7b5', 'l', 90, 'funct7₅'),
      port('PCSrc', 't', 30),
      port('Zero', 't', 80),
      port('ResultSrc', 'r', 20),
      port('MemWrite', 'r', 40),
      port('ALUControl', 'r', 60),
      port('ALUSrc', 'r', 80),
      port('ImmSrc', 'r', 100),
      port('RegWrite', 'r', 120),
    ],
    {
      anim: 'control',
      info: 'Устройство управления: Main Decoder (по op) + ALU Decoder (по ALUOp, funct3, funct7[5]). PCSrc = Branch & Zero | Jump.',
    },
  ),
  block(
    'RF',
    'regfile',
    'Register\nFile',
    380,
    260,
    130,
    150,
    [
      port('A1', 'l', 30, 'A1'),
      port('A2', 'l', 60, 'A2'),
      port('A3', 'l', 90, 'A3'),
      port('WD3', 'l', 125, 'WD3'),
      port('WE3', 't', 115, 'WE3'),
      port('RD1', 'r', 30, 'RD1'),
      port('RD2', 'r', 90, 'RD2'),
    ],
    {
      clocked: true,
      anim: 'regfile',
      info: 'Регистровый файл 32×32. Два порта чтения (комбинационные), один порт записи (по фронту CLK при WE3=1). x0 всегда равен 0.',
    },
  ),
  block('Ext', 'extend', 'Extend', 390, 483, 110, 44, [port('in', 'l', 22), port('out', 'r', 22), port('ImmSrc', 't', 80)], {
    anim: 'extend',
    info: 'Собирает константу из битов инструкции согласно ImmSrc и расширяет знаком до 32 бит.',
  }),
  mux2('SrcBMux', 590, 330, { info: 'Второй операнд АЛУ: RD2 (ALUSrc=0) или ImmExt (ALUSrc=1).', anim: 'mux' }),
  block('ALU', 'alu', 'ALU', 655, 250, 70, 150, [port('a', 'l', 40), port('b', 'l', 120), port('ctl', 't', 35), port('zero', 'r', 42), port('y', 'r', 60)], {
    anim: 'alu',
    info: 'Арифметико-логическое устройство. Операцию задаёт ALUControl; Zero=1, если результат равен 0.',
  }),
  block('AddTarget', 'adder', '+', 655, 450, 46, 70, [port('a', 'l', 15), port('b', 'l', 55), port('y', 'r', 35)], {
    info: 'Сумматор адреса перехода: PCTarget = PC + ImmExt.',
  }),
  block(
    'DMem',
    'memory',
    'Data\nMemory',
    810,
    260,
    120,
    140,
    [port('A', 'l', 50, 'A'), port('WD', 'l', 110, 'WD'), port('WE', 't', 60, 'WE'), port('RD', 'r', 75, 'RD')],
    { clocked: true, anim: 'dmem', info: 'Память данных. Чтение комбинационное, запись — по фронту CLK при WE=1.' },
  ),
  mux3('ResultMux', 990, 280, 110, [20, 55, 90], {
    info: 'Что записать в регистр: ALUResult (00), ReadData (01) или PC+4 (10).',
    anim: 'mux',
  }),
];

const w = wireFactory();
const TR = 320; // «шина» полей инструкции

const wires = [
  w('PCNext', 'PCMux.out', 'PC.d', { labelDy: -2, labelDx: 3 }),
  w('PC', 'PC.q', 'IMem.A'),
  w('PC', [145, 330], 'AddPC4.a', { via: [[145, 485]], noLabel: true, dotStart: true }),
  w('PC', [145, 440], 'AddTarget.a', { via: [[640, 440], [640, 465]], noLabel: true, dotStart: true, requires: ['PCTarget'] }),
  w('Const4', [166, 525], 'AddPC4.b', { noLabel: true }),
  w('PCPlus4', 'AddPC4.y', [245, 505], { labelDx: 22 }),
  w('PCPlus4', [245, 505], 'PCMux.in0', { via: [[245, 585], [8, 585], [8, 310]], when: { signal: 'PCSrc', value: 0 }, noLabel: true }),
  w('PCPlus4', [245, 585], 'ResultMux.in2', { via: [[950, 585], [950, 370]], when: { signal: 'ResultSrc', value: 2 }, requires: ['Result'], noLabel: true, dotStart: true }),
  w('Instr', 'IMem.RD', [TR, 330], { labelDy: 16, labelDx: 2 }),
  w('op', [TR, 330], 'Control.op', { via: [[TR, 80]], labelSeg: -1 }),
  w('funct3', [TR, 330], 'Control.funct3', { via: [[TR, 110]], labelSeg: -1, dotStart: true }),
  w('funct7b5', [TR, 330], 'Control.funct7b5', { via: [[TR, 140]], labelSeg: -1 }),
  w('A1', [TR, 330], 'RF.A1', { via: [[TR, 290]], labelSeg: -1 }),
  w('A2', [TR, 330], 'RF.A2', { via: [[TR, 320]], labelSeg: -1 }),
  w('A3', [TR, 330], 'RF.A3', { via: [[TR, 350]], labelSeg: -1 }),
  w('ImmIn', [TR, 330], 'Ext.in', { via: [[TR, 505]], labelSeg: -1 }),
  w('SrcA', 'RF.RD1', 'ALU.a'),
  w('RD2', 'RF.RD2', [550, 350], { noLabel: true }),
  w('RD2', [550, 350], 'SrcBMux.in0', { when: { signal: 'ALUSrc', value: 0 }, requires: ['SrcB'], noLabel: true }),
  w('WriteData', [550, 350], 'DMem.WD', { via: [[550, 425], [780, 425], [780, 370]], dotStart: true, labelSeg: 1 }),
  w('ImmExt', 'Ext.out', [570, 505]),
  w('ImmExt', [570, 505], 'AddTarget.b', { requires: ['PCTarget'], noLabel: true }),
  w('ImmExt', [570, 505], 'SrcBMux.in1', { via: [[570, 390]], when: { signal: 'ALUSrc', value: 1 }, requires: ['SrcB'], noLabel: true, dotStart: true }),
  w('SrcB', 'SrcBMux.out', 'ALU.b'),
  w('ALUResult', 'ALU.y', [770, 310]),
  w('ALUResult', [770, 310], 'DMem.A', { requires: ['MemAccess'], noLabel: true }),
  w('ALUResult', [770, 310], 'ResultMux.in0', { via: [[770, 240], [960, 240], [960, 300]], when: { signal: 'ResultSrc', value: 0 }, requires: ['Result'], noLabel: true, dotStart: true }),
  w('Zero', 'ALU.zero', 'Control.Zero', { via: [[745, 292], [745, 30], [450, 30]], labelSeg: 2 }),
  w('PCTarget', 'AddTarget.y', 'PCMux.in1', { via: [[740, 485], [740, 560], [20, 560], [20, 350]], when: { signal: 'PCSrc', value: 1 }, labelSeg: 2 }),
  w('ReadData', 'DMem.RD', 'ResultMux.in1', { when: { signal: 'ResultSrc', value: 1 } }),
  w('Result', 'ResultMux.out', 'RF.WD3', { via: [[1040, 335], [1040, 615], [350, 615], [350, 385]], labelSeg: 2 }),
  w('PCSrc', 'Control.PCSrc', 'PCMux.sel', { via: [[400, 15], [41, 15]], labelSeg: 1 }),
  w('ResultSrc', 'Control.ResultSrc', 'ResultMux.sel', { via: [[1001, 70]] }),
  w('MemWrite', 'Control.MemWrite', 'DMem.WE', { via: [[870, 90]] }),
  w('ALUControl', 'Control.ALUControl', 'ALU.ctl', { via: [[690, 110]] }),
  w('ALUSrc', 'Control.ALUSrc', 'SrcBMux.sel', { via: [[601, 130]] }),
  w('ImmSrc', 'Control.ImmSrc', 'Ext.ImmSrc', { via: [[535, 150], [535, 455], [470, 455]], labelSeg: 1 }),
  w('RegWrite', 'Control.RegWrite', 'RF.WE3', { via: [[495, 170]], labelSeg: 1 }),
];

const base: MicroarchDef = {
  id: 'riscv-single',
  name: 'Однотактный',
  chapter: 'H&H RISC-V, гл. 7.3',
  width: 1174,
  height: 640,
  signals,
  blocks,
  wires,
  phases: [
    { id: 'fetch', label: 'Fetch — выборка', short: 'F' },
    { id: 'decode', label: 'Decode — декодирование и чтение регистров', short: 'D' },
    { id: 'execute', label: 'Execute — АЛУ', short: 'E' },
    { id: 'memory', label: 'Memory — память данных', short: 'M' },
    { id: 'writeback', label: 'Writeback — запись результата и PC', short: 'W' },
  ],
  notes: [{ x: 156, y: 529, text: '4', cls: 'const' }],
};

// место под подписи полей инструкции (между «шиной» Instr и блоками) и перед АЛУ
export const singleCycleDef: MicroarchDef = stretchX(stretchX(stretchX(base, 60, 24), 349, 50), 689, 30);
