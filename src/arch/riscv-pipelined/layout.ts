/**
 * Конвейерный процессор RISC-V с блоком разрешения конфликтов (разд. 7.5) —
 * декларативное описание схемы. Компоновка собственная; имена сигналов — как в книге
 * (суффиксы F/D/E/M/W обозначают стадию).
 */
import type { BlockDef, MicroarchDef, PortDef, SignalDef, WireDef } from '../../core/types';
import { block, mux2, mux3, port, sig, wireFactory } from '../dsl';

/* ---------- сетка ---------- */
const RX = { FD: 300, DE: 740, EM: 1140, MW: 1400 }; // x регистров стадий
const RW = 18;
const RY = 45;
const RH = 580;
// горизонтальные «дорожки»
const Y = {
  // управляющие сигналы
  RegWrite: 60, ResultSrc: 75, MemWrite: 90, Jump: 105, Branch: 120, ALUControl: 135, ALUSrc: 150,
  // данные
  INSTR: 280, RD1: 240, RD2: 340, IMM: 440, PC: 480, P4: 550, RS1: 580, RS2: 595, RD: 610,
  ALU: 320, WD: 425, ALUW: 240,
  // обратные дорожки
  L_PCSRC: 14, L_REGW: 28, L_FWDM: 410, L_RDW: 640, L_PCT: 655, L_RES: 670,
};
const HZ = { x: 90, y: 705, w: 1410, h: 50 };
const HZ_LBL = 693; // y подписей выходов Hazard Unit

/* ---------- сигналы ---------- */
const signals: MicroarchDef['signals'] = {};
const D = (id: string, stage: string, width = 32, extra: Partial<SignalDef> = {}) => (signals[id] = sig(width, 'data', { stage, ...extra }));
const C = (id: string, stage: string, width = 1, extra: Partial<SignalDef> = {}) => (signals[id] = sig(width, 'control', { stage, fmt: 'bin', ...extra }));
const R = (id: string, stage: string, desc: string) => D(id, stage, 5, { fmt: 'reg', desc });
const Hz = (id: string, width: number, desc: string) => (signals[id] = sig(width, 'hazard', { fmt: 'bin', desc }));

D('PCFNext', 'F', 32, { label: "PCF'", desc: 'Следующее значение PC (вход регистра PC)' });
D('PCF', 'F', 32, { desc: 'PC стадии Fetch' });
D('InstrF', 'F', 32, { desc: 'Выбранная инструкция' });
D('PCPlus4F', 'F');
D('Const4', 'F', 32, { label: '4' });
D('InstrD', 'D', 32, { desc: 'Инструкция в стадии Decode' });
D('PCD', 'D');
D('PCPlus4D', 'D');
C('opD', 'D', 7, { label: 'op', desc: 'InstrD[6:0]' });
C('funct3D', 'D', 3, { label: 'funct3', desc: 'InstrD[14:12]' });
C('funct7b5D', 'D', 1, { label: 'funct7[5]', desc: 'InstrD[30]' });
R('Rs1D', 'D', 'InstrD[19:15] — первый регистр-источник');
R('Rs2D', 'D', 'InstrD[24:20] — второй регистр-источник');
R('RdD', 'D', 'InstrD[11:7] — регистр назначения');
D('ImmInD', 'D', 25, { label: 'InstrD[31:7]' });
D('RD1D', 'D', 32, { label: 'RD1', desc: 'Значение rs1' });
D('RD2D', 'D', 32, { label: 'RD2', desc: 'Значение rs2' });
D('ImmExtD', 'D');
for (const st of ['D', 'E', 'M', 'W']) {
  C(`RegWrite${st}`, st, 1, { desc: 'Разрешение записи в регистровый файл' });
  C(`ResultSrc${st}`, st, 2, { desc: '00 — ALUResult, 01 — ReadData, 10 — PC+4' });
  if (st !== 'W') C(`MemWrite${st}`, st, 1, { desc: 'Разрешение записи в память данных' });
  if (st === 'D' || st === 'E') {
    C(`Jump${st}`, st, 1, { desc: 'Инструкция — jal' });
    C(`Branch${st}`, st, 1, { desc: 'Инструкция — beq' });
    C(`ALUControl${st}`, st, 3, { desc: '000 add, 001 sub, 010 and, 011 or, 101 slt' });
    C(`ALUSrc${st}`, st, 1, { desc: 'Второй операнд АЛУ: 0 — регистр, 1 — ImmExt' });
  }
}
C('ImmSrcD', 'D', 2, { desc: 'Формат константы: 00 I, 01 S, 10 B, 11 J' });
C('ResultSrcE0', 'E', 1, { label: 'ResultSrcE[0]', desc: '1 — в Execute находится lw' });
D('RD1E', 'E');
D('RD2E', 'E');
D('PCE', 'E');
D('ImmExtE', 'E');
D('PCPlus4E', 'E');
R('Rs1E', 'E', 'Номер rs1 инструкции в Execute (для Hazard Unit)');
R('Rs2E', 'E', 'Номер rs2 инструкции в Execute (для Hazard Unit)');
R('RdE', 'E', 'Регистр назначения инструкции в Execute');
D('SrcAE', 'E', 32, { desc: 'Операнд A АЛУ после мультиплексора пересылки' });
D('SrcBE', 'E', 32, { desc: 'Операнд B АЛУ' });
D('WriteDataE', 'E', 32, { desc: 'Значение rs2 после мультиплексора пересылки' });
D('ALUResultE', 'E');
C('ZeroE', 'E');
D('PCTargetE', 'E', 32, { desc: 'PCE + ImmExtE — адрес перехода' });
C('PCSrcE', 'E', 1, { desc: 'PCSrcE = (BranchE & ZeroE) | JumpE' });
D('ALUResultM', 'M');
D('WriteDataM', 'M');
D('ReadDataM', 'M');
D('PCPlus4M', 'M');
R('RdM', 'M', 'Регистр назначения инструкции в Memory');
D('ALUResultW', 'W');
D('ReadDataW', 'W');
D('PCPlus4W', 'W');
D('ResultW', 'W', 32, { desc: 'Значение, записываемое в регистр' });
R('RdW', 'W', 'Регистр назначения инструкции в Writeback');
Hz('ForwardAE', 2, 'Пересылка операнда A: 00 — RD1E, 01 — ResultW, 10 — ALUResultM');
Hz('ForwardBE', 2, 'Пересылка операнда B: 00 — RD2E, 01 — ResultW, 10 — ALUResultM');
Hz('StallF', 1, 'Задержать PC (EN=0)');
Hz('StallD', 1, 'Задержать регистр F/D (EN=0)');
Hz('FlushD', 1, 'Сбросить регистр F/D (переход выполнен)');
Hz('FlushE', 1, 'Сбросить регистр D/E (lw-stall или переход)');

/* ---------- регистры стадий ---------- */
type Row = [string, number];
function pipeReg(id: string, label: string, x: number, stage: string, rows: Row[], bottom: PortDef[], info: string): BlockDef {
  const ports: PortDef[] = [];
  for (const [name, y] of rows) {
    ports.push(port(`${name}_i`, 'l', y - RY), port(`${name}_o`, 'r', y - RY));
  }
  return block(id, 'pipereg', label, x, RY, RW, RH, [...ports, ...bottom], { clocked: true, stage, info, anim: 'pipereg' });
}
const CTRL_DE: Row[] = (['RegWrite', 'ResultSrc', 'MemWrite', 'Jump', 'Branch', 'ALUControl', 'ALUSrc'] as const).map((n) => [n, Y[n]]);

/** Порты Hazard Unit: [имя, x на схеме]. */
const HZ_PORTS: [string, number][] = [
  ['StallF', 112], ['StallD', 305], ['FlushD', 313], ['Rs1D', 660], ['Rs2D', 680], ['FlushE', 749],
  ['ForwardBE', 821], ['ForwardAE', 843], ['Rs2E', 920], ['Rs1E', 940], ['RdE', 1070], ['PCSrcE', 1090],
  ['ResultSrcE0', 1115], ['RdM', 1340], ['RegWriteM', 1370], ['RegWriteW', 1430], ['RdW', 1460],
];
const hzX = (n: string) => HZ_PORTS.find((p) => p[0] === n)![1];

const blocks: BlockDef[] = [
  /* ---- Fetch ---- */
  mux2('PCMux', 40, 240, { stage: 'F', info: "Выбирает PCF': PCPlus4F или адрес перехода PCTargetE (PCSrcE=1).", anim: 'mux' }),
  block('PC', 'register', 'PC', 90, 250, 44, 60, [port('d', 'l', 30), port('q', 'r', 30), port('en', 'b', 22, 'EN')], {
    clocked: true,
    stage: 'F',
    anim: 'pc',
    info: 'Регистр PC с входом разрешения: при StallF=1 значение удерживается.',
  }),
  block('IMem', 'memory', 'Instruction\nMemory', 175, 230, 100, 100, [port('A', 'l', 50, 'A'), port('RD', 'r', 50, 'RD')], {
    stage: 'F',
    anim: 'imem',
    info: 'Память команд: по адресу PCF выдаёт InstrF.',
  }),
  block('AddPC4', 'adder', '+', 185, 515, 46, 70, [port('a', 'l', 15), port('b', 'l', 55), port('y', 'r', 35)], { stage: 'F', info: 'PCPlus4F = PCF + 4.' }),
  pipeReg('RegFD', 'F/D', RX.FD, 'D', [['instr', Y.INSTR], ['pc', Y.PC], ['p4', Y.P4]], [port('en', 'b', 5), port('clr', 'b', 13)],
    'Регистр Fetch/Decode. EN=0 (StallD) — удерживает инструкцию; CLR (FlushD) — превращает её в пузырь.'),

  /* ---- Decode ---- */
  block(
    'Control',
    'control',
    'Control\nUnit',
    400,
    45,
    110,
    150,
    [
      port('op', 'l', 30, 'op'),
      port('funct3', 'l', 60, 'funct3'),
      port('funct7b5', 'l', 90, 'funct7₅'),
      ...CTRL_DE.map(([n, y]) => port(n, 'r', y - 45)),
      port('ImmSrc', 'r', 135),
    ],
    { stage: 'D', anim: 'control', info: 'Устройство управления работает в Decode; сигналы едут вместе с инструкцией через регистры стадий.' },
  ),
  block(
    'RF',
    'regfile',
    'Register\nFile',
    430,
    210,
    140,
    150,
    [
      port('A1', 'l', 30, 'A1'),
      port('A2', 'l', 60, 'A2'),
      port('A3', 'l', 95, 'A3'),
      port('WD3', 'l', 130, 'WD3'),
      port('WE3', 't', 100, 'WE3'),
      port('RD1', 'r', 30, 'RD1'),
      port('RD2', 'r', 130, 'RD2'),
    ],
    {
      clocked: true,
      stage: 'D',
      anim: 'regfile',
      info: 'Чтение — в Decode (Rs1D, Rs2D), запись — из Writeback (RdW, ResultW, RegWriteW). Запись происходит в первой половине такта, чтение — во второй.',
    },
  ),
  block('Ext', 'extend', 'Extend', 430, 418, 110, 44, [port('in', 'l', 22), port('out', 'r', 22), port('ImmSrc', 't', 100)], {
    stage: 'D',
    anim: 'extend',
    info: 'Расширение константы согласно ImmSrcD.',
  }),
  pipeReg('RegDE', 'D/E', RX.DE, 'E',
    [...CTRL_DE, ['rd1', Y.RD1], ['rd2', Y.RD2], ['imm', Y.IMM], ['pc', Y.PC], ['p4', Y.P4], ['rs1', Y.RS1], ['rs2', Y.RS2], ['rd', Y.RD]],
    [port('clr', 'b', 9)],
    'Регистр Decode/Execute. CLR (FlushE) вставляет пузырь в Execute.'),

  /* ---- Execute ---- */
  mux3('FwdAMux', 810, 220, 80, [20, 40, 60], { stage: 'E', anim: 'mux', info: 'Мультиплексор пересылки операнда A: RD1E (00), ResultW (01), ALUResultM (10).' }, 'b'),
  mux3('FwdBMux', 810, 320, 80, [20, 40, 60], { stage: 'E', anim: 'mux', info: 'Мультиплексор пересылки операнда B: RD2E (00), ResultW (01), ALUResultM (10).' }, 'b'),
  mux2('SrcBMux', 900, 340, { stage: 'E', anim: 'mux', info: 'Второй операнд АЛУ: WriteDataE (ALUSrcE=0) или ImmExtE (ALUSrcE=1).' }),
  block('ALU', 'alu', 'ALU', 960, 220, 70, 180, [port('a', 'l', 40), port('b', 'l', 160), port('ctl', 't', 35), port('zero', 'r', 60), port('y', 'r', 100)], {
    stage: 'E',
    anim: 'alu',
    info: 'АЛУ стадии Execute.',
  }),
  block('AddTarget', 'adder', '+', 960, 465, 46, 70, [port('a', 'l', 15), port('b', 'l', 55), port('y', 'r', 35)], { stage: 'E', info: 'PCTargetE = PCE + ImmExtE.' }),
  block('PCLogic', 'logic', 'PCSrc', 1030, 95, 46, 40, [port('jump', 'l', 10), port('branch', 'l', 25), port('zero', 'b', 23), port('out', 'r', 20)], {
    stage: 'E',
    anim: 'pclogic',
    info: 'PCSrcE = (BranchE & ZeroE) | JumpE — переход разрешается в Execute.',
  }),
  pipeReg('RegEM', 'E/M', RX.EM, 'M',
    [['RegWrite', Y.RegWrite], ['ResultSrc', Y.ResultSrc], ['MemWrite', Y.MemWrite], ['alu', Y.ALU], ['wd', Y.WD], ['p4', Y.P4], ['rd', Y.RD]], [],
    'Регистр Execute/Memory.'),

  /* ---- Memory ---- */
  block('DMem', 'memory', 'Data\nMemory', 1230, 270, 120, 130, [port('A', 'l', 50, 'A'), port('WD', 'l', 105, 'WD'), port('WE', 't', 60, 'WE'), port('RD', 'r', 50, 'RD')], {
    clocked: true,
    stage: 'M',
    anim: 'dmem',
    info: 'Память данных: чтение комбинационное, запись по фронту при MemWriteM=1.',
  }),
  pipeReg('RegMW', 'M/W', RX.MW, 'W',
    [['RegWrite', Y.RegWrite], ['ResultSrc', Y.ResultSrc], ['alu', Y.ALUW], ['rdata', Y.ALU], ['p4', Y.P4], ['rd', Y.RD]], [],
    'Регистр Memory/Writeback.'),

  /* ---- Writeback ---- */
  mux3('ResultMux', 1480, 260, 120, [20, 60, 100], { stage: 'W', anim: 'mux', info: 'ResultW: ALUResultW (00), ReadDataW (01), PCPlus4W (10).' }),

  /* ---- Hazard Unit ---- */
  block('Hazard', 'hazard', 'Hazard Unit', HZ.x, HZ.y, HZ.w, HZ.h, HZ_PORTS.map(([n, x]) => port(n, 't', x - HZ.x)), {
    anim: 'hazard',
    info: 'Блок разрешения конфликтов. Forward: Rs1E/Rs2E сравниваются с RdM и RdW. lwStall = ResultSrcE[0] & ((Rs1D == RdE) | (Rs2D == RdE)). FlushD = PCSrcE, FlushE = lwStall | PCSrcE.',
  }),
];

/* ---------- провода ---------- */
const w = wireFactory();
const TR = 345; // шина полей InstrD
const r = (reg: keyof typeof RX, name: string, io: 'i' | 'o') => `Reg${reg}.${name}_${io}`;
const hz = (n: string) => `Hazard.${n}`;
const wires: WireDef[] = [];
const W = (...a: Parameters<typeof w>) => wires.push(w(...a));
/** Подпись вертикального провода от Hazard Unit — у самого блока, на высоте HZ_LBL. */
const hzLbl = (topY: number, dx = 0) => ({ labelSeg: 0, labelDy: HZ_LBL - (HZ.y + topY) / 2, labelDx: dx });

/* Fetch */
W('PCFNext', 'PCMux.out', 'PC.d', { labelDy: -2 });
W('PCF', 'PC.q', 'IMem.A');
W('PCF', [152, Y.INSTR], 'AddPC4.a', { via: [[152, 530]], noLabel: true, dotStart: true });
W('PCF', [152, Y.PC], r('FD', 'pc', 'i'), { noLabel: true, dotStart: true });
W('Const4', [171, 570], 'AddPC4.b', { noLabel: true });
W('PCPlus4F', 'AddPC4.y', r('FD', 'p4', 'i'), { labelDx: 6 });
W('PCPlus4F', [255, Y.P4], 'PCMux.in0', { via: [[255, 600], [18, 600], [18, 260]], when: { signal: 'PCSrcE', value: 0 }, noLabel: true, dotStart: true });
W('InstrF', 'IMem.RD', r('FD', 'instr', 'i'), { noLabel: true });

/* Decode */
W('InstrD', r('FD', 'instr', 'o'), [TR, Y.INSTR], { labelDx: 30, labelDy: 18, stack: true });
W('opD', [TR, Y.INSTR], 'Control.op', { via: [[TR, 75]], labelSeg: -1 });
W('funct3D', [TR, Y.INSTR], 'Control.funct3', { via: [[TR, 105]], labelSeg: -1 });
W('funct7b5D', [TR, Y.INSTR], 'Control.funct7b5', { via: [[TR, 135]], labelSeg: -1 });
W('Rs1D', [TR, Y.INSTR], 'RF.A1', { via: [[TR, 240]], labelSeg: -1 });
W('Rs2D', [TR, Y.INSTR], 'RF.A2', { via: [[TR, 270]], labelSeg: -1 });
W('ImmInD', [TR, Y.INSTR], 'Ext.in', { via: [[TR, Y.IMM]], labelSeg: -1 });
W('Rs1D', [TR, Y.INSTR], r('DE', 'rs1', 'i'), { via: [[TR, Y.RS1]], noLabel: true });
W('Rs2D', [TR, Y.INSTR], r('DE', 'rs2', 'i'), { via: [[TR, Y.RS2]], noLabel: true });
W('RdD', [TR, Y.INSTR], r('DE', 'rd', 'i'), { via: [[TR, Y.RD]], labelSeg: -1, labelDx: -60, labelDy: 14 });
W('Rs1D', [hzX('Rs1D'), Y.RS1], hz('Rs1D'), { noLabel: true, dotStart: true });
W('Rs2D', [hzX('Rs2D'), Y.RS2], hz('Rs2D'), { noLabel: true, dotStart: true });
W('RD1D', 'RF.RD1', r('DE', 'rd1', 'i'));
W('RD2D', 'RF.RD2', r('DE', 'rd2', 'i'));
W('ImmExtD', 'Ext.out', r('DE', 'imm', 'i'));
W('PCD', r('FD', 'pc', 'o'), r('DE', 'pc', 'i'));
W('PCPlus4D', r('FD', 'p4', 'o'), r('DE', 'p4', 'i'));
for (const [n] of CTRL_DE) W(`${n}D`, `Control.${n}`, r('DE', n, 'i'));
W('ImmSrcD', 'Control.ImmSrc', 'Ext.ImmSrc', { via: [[600, 180], [600, 400], [530, 400]], labelSeg: 0 });

/* Execute */
W('RD1E', r('DE', 'rd1', 'o'), 'FwdAMux.in0', { when: { signal: 'ForwardAE', value: 0 } });
W('RD2E', r('DE', 'rd2', 'o'), 'FwdBMux.in0', { when: { signal: 'ForwardBE', value: 0 } });
W('SrcAE', 'FwdAMux.out', 'ALU.a');
W('WriteDataE', 'FwdBMux.out', [860, 360], { noLabel: true });
W('WriteDataE', [860, 360], 'SrcBMux.in0', { when: { signal: 'ALUSrcE', value: 0 }, requires: ['SrcBE'], noLabel: true });
W('WriteDataE', [860, 360], r('EM', 'wd', 'i'), { via: [[860, Y.WD]], when: { signal: 'MemWriteE', value: 1 }, dotStart: true, labelSeg: -1, labelDx: 20 });
W('ImmExtE', r('DE', 'imm', 'o'), [878, Y.IMM], { labelDx: 190 });
W('ImmExtE', [878, Y.IMM], 'SrcBMux.in1', { via: [[878, 400]], when: { signal: 'ALUSrcE', value: 1 }, requires: ['SrcBE'], noLabel: true });
W('ImmExtE', [878, Y.IMM], 'AddTarget.b', { via: [[878, 520]], requires: ['PCTargetE'], noLabel: true, dotStart: true });
W('SrcBE', 'SrcBMux.out', 'ALU.b');
W('ALUResultE', 'ALU.y', r('EM', 'alu', 'i'));
W('ZeroE', 'ALU.zero', 'PCLogic.zero', { via: [[1053, 280]], labelSeg: 1 });
W('PCE', r('DE', 'pc', 'o'), 'AddTarget.a', { labelDx: 30 });
W('PCTargetE', 'AddTarget.y', 'PCMux.in1', { via: [[1025, 500], [1025, Y.L_PCT], [28, Y.L_PCT], [28, 300]], when: { signal: 'PCSrcE', value: 1 }, labelSeg: 2, labelDx: -260 });
W('PCPlus4E', r('DE', 'p4', 'o'), r('EM', 'p4', 'i'), { labelDx: 120 });
W('RdE', r('DE', 'rd', 'o'), r('EM', 'rd', 'i'), { labelDx: 60 });
W('RdE', [hzX('RdE'), Y.RD], hz('RdE'), { noLabel: true, dotStart: true });
W('Rs1E', r('DE', 'rs1', 'o'), hz('Rs1E'), { via: [[hzX('Rs1E'), Y.RS1]], labelSeg: 0, labelDx: -58 });
W('Rs2E', r('DE', 'rs2', 'o'), hz('Rs2E'), { via: [[hzX('Rs2E'), Y.RS2]], labelSeg: 0, labelDx: 46 });
W('RegWriteE', r('DE', 'RegWrite', 'o'), r('EM', 'RegWrite', 'i'));
W('ResultSrcE', r('DE', 'ResultSrc', 'o'), r('EM', 'ResultSrc', 'i'));
W('MemWriteE', r('DE', 'MemWrite', 'o'), r('EM', 'MemWrite', 'i'));
W('JumpE', r('DE', 'Jump', 'o'), 'PCLogic.jump', { labelDx: -60 });
W('BranchE', r('DE', 'Branch', 'o'), 'PCLogic.branch', { labelDx: -60 });
W('ALUControlE', r('DE', 'ALUControl', 'o'), 'ALU.ctl', { via: [[995, Y.ALUControl]], labelSeg: 0, labelDx: -40 });
W('ALUSrcE', r('DE', 'ALUSrc', 'o'), 'SrcBMux.sel', { via: [[911, Y.ALUSrc]], labelSeg: 0 });
W('ResultSrcE0', [hzX('ResultSrcE0'), Y.ResultSrc], hz('ResultSrcE0'), { dotStart: true, noLabel: true });
W('PCSrcE', 'PCLogic.out', 'PCMux.sel', { via: [[1090, 115], [1090, Y.L_PCSRC], [51, Y.L_PCSRC]], labelSeg: 2 });
W('PCSrcE', [1090, 115], hz('PCSrcE'), { noLabel: true, dotStart: true });

/* Memory */
W('ALUResultM', r('EM', 'alu', 'o'), [1180, Y.ALU], { labelDx: 26, labelDy: -3, stack: true });
W('ALUResultM', [1180, Y.ALU], 'DMem.A', { requires: ['MemAccessM'], noLabel: true });
W('ALUResultM', [1180, Y.ALU], r('MW', 'alu', 'i'), { via: [[1180, Y.ALUW]], when: { signal: 'ResultSrcM', value: 0 }, requires: ['RdM'], noLabel: true, dotStart: true });
W('ALUResultM', [1180, Y.ALU], 'FwdAMux.in2', { via: [[1180, Y.L_FWDM], [795, Y.L_FWDM], [795, 280]], when: { signal: 'ForwardAE', value: 2 }, requires: ['SrcAE'], noLabel: true });
W('ALUResultM', [1180, Y.ALU], 'FwdBMux.in2', { via: [[1180, Y.L_FWDM], [795, Y.L_FWDM], [795, 380]], when: { signal: 'ForwardBE', value: 2 }, requires: ['WriteDataE'], noLabel: true });
W('WriteDataM', r('EM', 'wd', 'o'), 'DMem.WD', { via: [[1205, Y.WD], [1205, 375]], labelSeg: 0, labelDx: 36, labelDy: 14 });
W('ReadDataM', 'DMem.RD', r('MW', 'rdata', 'i'), { stack: true });
W('RegWriteM', r('EM', 'RegWrite', 'o'), r('MW', 'RegWrite', 'i'), { labelDx: -30 });
W('RegWriteM', [hzX('RegWriteM'), Y.RegWrite], hz('RegWriteM'), { noLabel: true, dotStart: true });
W('ResultSrcM', r('EM', 'ResultSrc', 'o'), r('MW', 'ResultSrc', 'i'), { labelDx: -30 });
W('MemWriteM', r('EM', 'MemWrite', 'o'), 'DMem.WE', { via: [[1290, Y.MemWrite]], labelSeg: 0, labelDx: -8 });
W('RdM', r('EM', 'rd', 'o'), r('MW', 'rd', 'i'), { labelDx: -50 });
W('RdM', [hzX('RdM'), Y.RD], hz('RdM'), { noLabel: true, dotStart: true });
W('PCPlus4M', r('EM', 'p4', 'o'), r('MW', 'p4', 'i'));

/* Writeback */
W('ALUResultW', r('MW', 'alu', 'o'), 'ResultMux.in0', { via: [[1450, Y.ALUW], [1450, 280]], when: { signal: 'ResultSrcW', value: 0 }, labelSeg: 0, labelDx: 34, labelDy: -3, stack: true });
W('ReadDataW', r('MW', 'rdata', 'o'), 'ResultMux.in1', { when: { signal: 'ResultSrcW', value: 1 }, stack: true });
W('PCPlus4W', r('MW', 'p4', 'o'), 'ResultMux.in2', { via: [[1450, Y.P4], [1450, 360]], when: { signal: 'ResultSrcW', value: 2 }, labelSeg: 0, labelDx: 42, stack: true });
W('ResultSrcW', r('MW', 'ResultSrc', 'o'), 'ResultMux.sel', { via: [[1491, Y.ResultSrc]], labelSeg: 0, labelDx: 50 });
W('ResultW', 'ResultMux.out', 'RF.WD3', { via: [[1540, 320], [1540, Y.L_RES], [385, Y.L_RES], [385, 340]], labelSeg: 2, labelDx: 320 });
W('ResultW', [780, Y.L_RES], 'FwdAMux.in1', { via: [[780, 260]], when: { signal: 'ForwardAE', value: 1 }, requires: ['SrcAE'], noLabel: true, dotStart: true });
W('ResultW', [780, Y.L_RES], 'FwdBMux.in1', { via: [[780, 360]], when: { signal: 'ForwardBE', value: 1 }, requires: ['WriteDataE'], noLabel: true });
W('RegWriteW', r('MW', 'RegWrite', 'o'), 'RF.WE3', { via: [[1440, Y.RegWrite], [1440, Y.L_REGW], [530, Y.L_REGW]], labelSeg: 2, labelDx: 300 });
W('RegWriteW', [hzX('RegWriteW'), Y.RegWrite], hz('RegWriteW'), { noLabel: true, dotStart: true });
W('RdW', r('MW', 'rd', 'o'), 'RF.A3', { via: [[1460, Y.RD], [1460, Y.L_RDW], [400, Y.L_RDW], [400, 305]], labelSeg: 2, labelDx: 320 });
W('RdW', [1460, Y.L_RDW], hz('RdW'), { noLabel: true, dotStart: true });

/* Hazard Unit → схема */
W('StallF', hz('StallF'), 'PC.en', hzLbl(310));
W('StallD', hz('StallD'), 'RegFD.en', hzLbl(RY + RH, -54));
W('FlushD', hz('FlushD'), 'RegFD.clr', hzLbl(RY + RH));
W('FlushE', hz('FlushE'), 'RegDE.clr', hzLbl(RY + RH, -54));
W('ForwardAE', hz('ForwardAE'), 'FwdAMux.sel', { via: [[843, 310], [821, 310]], ...hzLbl(310) });
W('ForwardBE', hz('ForwardBE'), 'FwdBMux.sel', hzLbl(386, -76));

export const pipelinedDef: MicroarchDef = {
  id: 'riscv-pipelined',
  name: 'Конвейерный',
  chapter: 'H&H RISC-V, гл. 7.5',
  width: 1590,
  height: 800,
  signals,
  blocks,
  wires,
  phases: [
    { id: 'stages', label: 'Работа стадий', short: 'S' },
    { id: 'hazard', label: 'Hazard Unit', short: 'H' },
    { id: 'edge', label: 'Фронт CLK', short: '↑' },
  ],
  stages: [
    { id: 'F', label: 'Fetch', x0: 4, x1: RX.FD },
    { id: 'D', label: 'Decode', x0: RX.FD + RW, x1: RX.DE },
    { id: 'E', label: 'Execute', x0: RX.DE + RW, x1: RX.EM },
    { id: 'M', label: 'Memory', x0: RX.EM + RW, x1: RX.MW },
    { id: 'W', label: 'Writeback', x0: RX.MW + RW, x1: 1586 },
  ],
  notes: [{ x: 161, y: 574, text: '4', cls: 'const' }],
};
