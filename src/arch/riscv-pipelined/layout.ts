/**
 * Конвейерный процессор RISC-V с блоком разрешения конфликтов (разд. 7.5) —
 * декларативное описание схемы. Компоновка собственная; имена сигналов — как в книге
 * (суффиксы F/D/E/M/W обозначают стадию).
 */
import type { BlockDef, MicroarchDef, PortDef, SignalDef, WireDef } from '../../core/types';
import { block, mux2, mux3, port, sig, wireFactory } from '../dsl';

/* ---------- сетка ---------- */
const RX = { FD: 300, DE: 800, EM: 1200, MW: 1460 }; // x регистров стадий
const RW = 18;
const RY = 45;
const RH = 650;
// горизонтальные «дорожки» данных
const Y = {
  RegWrite: 60, ResultSrc: 75, MemWrite: 90, Jump: 105, Branch: 120, ALUControl: 135, ALUSrc: 150,
  INSTR: 340, RD1: 300, RD2: 400, IMM: 500, PC: 540, P4: 610, RS1: 650, RS2: 665, RD: 680,
  ALU: 380, WD: 485, ALUW: 300,
  // обратные дорожки
  L_PCSRC: 14, L_REGW: 28, L_FWDM: 470, L_RDW: 710, L_PCT: 730, L_RES: 750,
};
const HZ = { x: 90, y: 800, w: 1470, h: 56 };

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

const blocks: BlockDef[] = [
  /* ---- Fetch ---- */
  mux2('PCMux', 40, 300, { stage: 'F', info: "Выбирает PCF': PCPlus4F или адрес перехода PCTargetE (PCSrcE=1).", anim: 'mux' }),
  block('PC', 'register', 'PC', 90, 310, 44, 60, [port('d', 'l', 30), port('q', 'r', 30), port('en', 'b', 22, 'EN')], {
    clocked: true,
    stage: 'F',
    anim: 'pc',
    info: 'Регистр PC с входом разрешения: при StallF=1 значение удерживается.',
  }),
  block('IMem', 'memory', 'Instruction\nMemory', 175, 290, 100, 100, [port('A', 'l', 50, 'A'), port('RD', 'r', 50, 'RD')], {
    stage: 'F',
    anim: 'imem',
    info: 'Память команд: по адресу PCF выдаёт InstrF.',
  }),
  block('AddPC4', 'adder', '+', 185, 575, 46, 70, [port('a', 'l', 15), port('b', 'l', 55), port('y', 'r', 35)], { stage: 'F', info: 'PCPlus4F = PCF + 4.' }),
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
    270,
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
  block('Ext', 'extend', 'Extend', 430, 478, 110, 44, [port('in', 'l', 22), port('out', 'r', 22), port('ImmSrc', 't', 100)], {
    stage: 'D',
    anim: 'extend',
    info: 'Расширение константы согласно ImmSrcD.',
  }),
  pipeReg('RegDE', 'D/E', RX.DE, 'E',
    [...CTRL_DE, ['rd1', Y.RD1], ['rd2', Y.RD2], ['imm', Y.IMM], ['pc', Y.PC], ['p4', Y.P4], ['rs1', Y.RS1], ['rs2', Y.RS2], ['rd', Y.RD]],
    [port('clr', 'b', 9)],
    'Регистр Decode/Execute. CLR (FlushE) вставляет пузырь в Execute.'),

  /* ---- Execute ---- */
  mux3('FwdAMux', 870, 280, 80, [20, 40, 60], { stage: 'E', anim: 'mux', info: 'Мультиплексор пересылки операнда A: RD1E (00), ResultW (01), ALUResultM (10).' }, 'b'),
  mux3('FwdBMux', 870, 380, 80, [20, 40, 60], { stage: 'E', anim: 'mux', info: 'Мультиплексор пересылки операнда B: RD2E (00), ResultW (01), ALUResultM (10).' }, 'b'),
  mux2('SrcBMux', 960, 400, { stage: 'E', anim: 'mux', info: 'Второй операнд АЛУ: WriteDataE (ALUSrcE=0) или ImmExtE (ALUSrcE=1).' }),
  block('ALU', 'alu', 'ALU', 1020, 280, 70, 180, [port('a', 'l', 40), port('b', 'l', 160), port('ctl', 't', 35), port('zero', 'r', 60), port('y', 'r', 100)], {
    stage: 'E',
    anim: 'alu',
    info: 'АЛУ стадии Execute.',
  }),
  block('AddTarget', 'adder', '+', 1020, 525, 46, 70, [port('a', 'l', 15), port('b', 'l', 55), port('y', 'r', 35)], { stage: 'E', info: 'PCTargetE = PCE + ImmExtE.' }),
  block('PCLogic', 'logic', 'PCSrc', 1090, 95, 46, 40, [port('jump', 'l', 10), port('branch', 'l', 25), port('zero', 'b', 23), port('out', 'r', 20)], {
    stage: 'E',
    info: 'PCSrcE = (BranchE & ZeroE) | JumpE — переход разрешается в Execute.',
  }),
  pipeReg('RegEM', 'E/M', RX.EM, 'M',
    [['RegWrite', Y.RegWrite], ['ResultSrc', Y.ResultSrc], ['MemWrite', Y.MemWrite], ['alu', Y.ALU], ['wd', Y.WD], ['p4', Y.P4], ['rd', Y.RD]], [],
    'Регистр Execute/Memory.'),

  /* ---- Memory ---- */
  block('DMem', 'memory', 'Data\nMemory', 1290, 330, 120, 130, [port('A', 'l', 50, 'A'), port('WD', 'l', 105, 'WD'), port('WE', 't', 60, 'WE'), port('RD', 'r', 50, 'RD')], {
    clocked: true,
    stage: 'M',
    anim: 'dmem',
    info: 'Память данных: чтение комбинационное, запись по фронту при MemWriteM=1.',
  }),
  pipeReg('RegMW', 'M/W', RX.MW, 'W',
    [['RegWrite', Y.RegWrite], ['ResultSrc', Y.ResultSrc], ['alu', Y.ALUW], ['rdata', Y.ALU], ['p4', Y.P4], ['rd', Y.RD]], [],
    'Регистр Memory/Writeback.'),

  /* ---- Writeback ---- */
  mux3('ResultMux', 1540, 320, 120, [20, 60, 100], { stage: 'W', anim: 'mux', info: 'ResultW: ALUResultW (00), ReadDataW (01), PCPlus4W (10).' }),

  /* ---- Hazard Unit ---- */
  block(
    'Hazard',
    'hazard',
    'Hazard Unit',
    HZ.x,
    HZ.y,
    HZ.w,
    HZ.h,
    (
      [
        ['StallF', 112], ['StallD', 305], ['FlushD', 313], ['Rs1D', 700], ['Rs2D', 720], ['FlushE', 809],
        ['ForwardBE', 881], ['ForwardAE', 903], ['Rs2E', 980], ['Rs1E', 1000], ['RdE', 1130], ['PCSrcE', 1150],
        ['ResultSrcE0', 1175], ['RdM', 1400], ['RegWriteM', 1430], ['RegWriteW', 1490], ['RdW', 1520],
      ] as [string, number][]
    ).map(([n, x]) => port(n, 't', x - HZ.x)),
    {
      anim: 'hazard',
      info: 'Блок разрешения конфликтов. Forward: Rs1E/Rs2E сравниваются с RdM и RdW. lwStall = ResultSrcE[0] & ((Rs1D == RdE) | (Rs2D == RdE)). FlushD = PCSrcE, FlushE = lwStall | PCSrcE.',
    },
  ),
];

/* ---------- провода ---------- */
const w = wireFactory();
const TR = 345; // шина полей InstrD
const r = (reg: keyof typeof RX, name: string, io: 'i' | 'o') => `Reg${reg}.${name}_${io}`;
const hz = (n: string) => `Hazard.${n}`;
const hzX = (n: string) => blocks[blocks.length - 1].ports.find((p) => p.id === n)!.off + HZ.x;
const wires: WireDef[] = [];
const W = (...a: Parameters<typeof w>) => wires.push(w(...a));

/* Fetch */
W('PCFNext', 'PCMux.out', 'PC.d', { labelDy: -2 });
W('PCF', 'PC.q', 'IMem.A');
W('PCF', [152, 340], 'AddPC4.a', { via: [[152, 590]], noLabel: true, dotStart: true });
W('PCF', [152, Y.PC], r('FD', 'pc', 'i'), { noLabel: true, dotStart: true });
W('Const4', [171, 630], 'AddPC4.b', { noLabel: true });
W('PCPlus4F', 'AddPC4.y', r('FD', 'p4', 'i'), { labelDx: 6 });
W('PCPlus4F', [255, Y.P4], 'PCMux.in0', { via: [[255, 670], [18, 670], [18, 320]], when: { signal: 'PCSrcE', value: 0 }, noLabel: true, dotStart: true });
W('InstrF', 'IMem.RD', r('FD', 'instr', 'i'), { noLabel: true });

/* Decode */
W('InstrD', r('FD', 'instr', 'o'), [TR, Y.INSTR], { labelDx: 4 });
W('opD', [TR, Y.INSTR], 'Control.op', { via: [[TR, 75]], labelSeg: -1 });
W('funct3D', [TR, Y.INSTR], 'Control.funct3', { via: [[TR, 105]], labelSeg: -1 });
W('funct7b5D', [TR, Y.INSTR], 'Control.funct7b5', { via: [[TR, 135]], labelSeg: -1 });
W('Rs1D', [TR, Y.INSTR], 'RF.A1', { via: [[TR, 300]], labelSeg: -1 });
W('Rs2D', [TR, Y.INSTR], 'RF.A2', { via: [[TR, 330]], labelSeg: -1 });
W('ImmInD', [TR, Y.INSTR], 'Ext.in', { via: [[TR, Y.IMM]], labelSeg: -1 });
W('Rs1D', [TR, Y.INSTR], r('DE', 'rs1', 'i'), { via: [[TR, Y.RS1]], noLabel: true });
W('Rs2D', [TR, Y.INSTR], r('DE', 'rs2', 'i'), { via: [[TR, Y.RS2]], noLabel: true });
W('RdD', [TR, Y.INSTR], r('DE', 'rd', 'i'), { via: [[TR, Y.RD]], labelSeg: -1, labelDx: -150 });
W('Rs1D', [hzX('Rs1D'), Y.RS1], hz('Rs1D'), { noLabel: true, dotStart: true });
W('Rs2D', [hzX('Rs2D'), Y.RS2], hz('Rs2D'), { noLabel: true, dotStart: true });
W('RD1D', 'RF.RD1', r('DE', 'rd1', 'i'));
W('RD2D', 'RF.RD2', r('DE', 'rd2', 'i'));
W('ImmExtD', 'Ext.out', r('DE', 'imm', 'i'));
W('PCD', r('FD', 'pc', 'o'), r('DE', 'pc', 'i'));
W('PCPlus4D', r('FD', 'p4', 'o'), r('DE', 'p4', 'i'));
for (const [n] of CTRL_DE) W(`${n}D`, `Control.${n}`, r('DE', n, 'i'), { labelDx: -60 });
W('ImmSrcD', 'Control.ImmSrc', 'Ext.ImmSrc', { via: [[600, 180], [600, 455], [530, 455]], labelSeg: 0 });

/* Execute */
W('RD1E', r('DE', 'rd1', 'o'), 'FwdAMux.in0', { when: { signal: 'ForwardAE', value: 0 } });
W('RD2E', r('DE', 'rd2', 'o'), 'FwdBMux.in0', { when: { signal: 'ForwardBE', value: 0 } });
W('SrcAE', 'FwdAMux.out', 'ALU.a');
W('WriteDataE', 'FwdBMux.out', [920, 420], { noLabel: true });
W('WriteDataE', [920, 420], 'SrcBMux.in0', { when: { signal: 'ALUSrcE', value: 0 }, requires: ['SrcBE'], noLabel: true });
W('WriteDataE', [920, 420], r('EM', 'wd', 'i'), { via: [[920, Y.WD]], when: { signal: 'MemWriteE', value: 1 }, dotStart: true, labelSeg: -1 });
W('ImmExtE', r('DE', 'imm', 'o'), [938, Y.IMM]);
W('ImmExtE', [938, Y.IMM], 'SrcBMux.in1', { via: [[938, 460]], when: { signal: 'ALUSrcE', value: 1 }, requires: ['SrcBE'], noLabel: true });
W('ImmExtE', [938, Y.IMM], 'AddTarget.b', { via: [[938, 580]], requires: ['PCTargetE'], noLabel: true, dotStart: true });
W('SrcBE', 'SrcBMux.out', 'ALU.b');
W('ALUResultE', 'ALU.y', r('EM', 'alu', 'i'));
W('ZeroE', 'ALU.zero', 'PCLogic.zero', { via: [[1113, 340]], labelSeg: 1 });
W('PCE', r('DE', 'pc', 'o'), 'AddTarget.a');
W('PCTargetE', 'AddTarget.y', 'PCMux.in1', { via: [[1085, 560], [1085, Y.L_PCT], [28, Y.L_PCT], [28, 360]], when: { signal: 'PCSrcE', value: 1 }, labelSeg: 2 });
W('PCPlus4E', r('DE', 'p4', 'o'), r('EM', 'p4', 'i'));
W('RdE', r('DE', 'rd', 'o'), r('EM', 'rd', 'i'));
W('RdE', [hzX('RdE'), Y.RD], hz('RdE'), { noLabel: true, dotStart: true });
W('Rs1E', r('DE', 'rs1', 'o'), hz('Rs1E'), { via: [[hzX('Rs1E'), Y.RS1]], labelSeg: 0 });
W('Rs2E', r('DE', 'rs2', 'o'), hz('Rs2E'), { via: [[hzX('Rs2E'), Y.RS2]], labelSeg: 0 });
W('RegWriteE', r('DE', 'RegWrite', 'o'), r('EM', 'RegWrite', 'i'));
W('ResultSrcE', r('DE', 'ResultSrc', 'o'), r('EM', 'ResultSrc', 'i'));
W('MemWriteE', r('DE', 'MemWrite', 'o'), r('EM', 'MemWrite', 'i'));
W('JumpE', r('DE', 'Jump', 'o'), 'PCLogic.jump');
W('BranchE', r('DE', 'Branch', 'o'), 'PCLogic.branch');
W('ALUControlE', r('DE', 'ALUControl', 'o'), 'ALU.ctl', { via: [[1055, Y.ALUControl]], labelSeg: 0 });
W('ALUSrcE', r('DE', 'ALUSrc', 'o'), 'SrcBMux.sel', { via: [[971, Y.ALUSrc]], labelSeg: 0 });
W('ResultSrcE0', [hzX('ResultSrcE0'), Y.ResultSrc], hz('ResultSrcE0'), { dotStart: true, noLabel: true });
W('PCSrcE', 'PCLogic.out', 'PCMux.sel', { via: [[1150, 115], [1150, Y.L_PCSRC], [51, Y.L_PCSRC]], labelSeg: 2 });
W('PCSrcE', [1150, 115], hz('PCSrcE'), { noLabel: true, dotStart: true });

/* Memory */
W('ALUResultM', r('EM', 'alu', 'o'), [1240, Y.ALU], { labelDx: 2 });
W('ALUResultM', [1240, Y.ALU], 'DMem.A', { requires: ['MemAccessM'], noLabel: true });
W('ALUResultM', [1240, Y.ALU], r('MW', 'alu', 'i'), { via: [[1240, Y.ALUW]], when: { signal: 'ResultSrcM', value: 0 }, requires: ['RdM'], noLabel: true, dotStart: true });
W('ALUResultM', [1240, Y.ALU], 'FwdAMux.in2', { via: [[1240, Y.L_FWDM], [855, Y.L_FWDM], [855, 340]], when: { signal: 'ForwardAE', value: 2 }, requires: ['SrcAE'], noLabel: true });
W('ALUResultM', [1240, Y.ALU], 'FwdBMux.in2', { via: [[1240, Y.L_FWDM], [855, Y.L_FWDM], [855, 440]], when: { signal: 'ForwardBE', value: 2 }, requires: ['WriteDataE'], noLabel: true });
W('WriteDataM', r('EM', 'wd', 'o'), 'DMem.WD', { via: [[1265, Y.WD], [1265, 435]], labelSeg: 0 });
W('ReadDataM', 'DMem.RD', r('MW', 'rdata', 'i'));
W('RegWriteM', r('EM', 'RegWrite', 'o'), r('MW', 'RegWrite', 'i'));
W('RegWriteM', [hzX('RegWriteM'), Y.RegWrite], hz('RegWriteM'), { noLabel: true, dotStart: true });
W('ResultSrcM', r('EM', 'ResultSrc', 'o'), r('MW', 'ResultSrc', 'i'));
W('MemWriteM', r('EM', 'MemWrite', 'o'), 'DMem.WE', { via: [[1350, Y.MemWrite]], labelSeg: 0 });
W('RdM', r('EM', 'rd', 'o'), r('MW', 'rd', 'i'));
W('RdM', [hzX('RdM'), Y.RD], hz('RdM'), { noLabel: true, dotStart: true });
W('PCPlus4M', r('EM', 'p4', 'o'), r('MW', 'p4', 'i'));

/* Writeback */
W('ALUResultW', r('MW', 'alu', 'o'), 'ResultMux.in0', { via: [[1510, Y.ALUW], [1510, 340]], when: { signal: 'ResultSrcW', value: 0 }, labelSeg: 0 });
W('ReadDataW', r('MW', 'rdata', 'o'), 'ResultMux.in1', { when: { signal: 'ResultSrcW', value: 1 } });
W('PCPlus4W', r('MW', 'p4', 'o'), 'ResultMux.in2', { via: [[1510, Y.P4], [1510, 420]], when: { signal: 'ResultSrcW', value: 2 }, labelSeg: 0 });
W('ResultSrcW', r('MW', 'ResultSrc', 'o'), 'ResultMux.sel', { via: [[1551, Y.ResultSrc]], labelSeg: 0 });
W('ResultW', 'ResultMux.out', 'RF.WD3', { via: [[1600, 380], [1600, Y.L_RES], [385, Y.L_RES], [385, 400]], labelSeg: 2 });
W('ResultW', [840, Y.L_RES], 'FwdAMux.in1', { via: [[840, 320]], when: { signal: 'ForwardAE', value: 1 }, requires: ['SrcAE'], noLabel: true, dotStart: true });
W('ResultW', [840, Y.L_RES], 'FwdBMux.in1', { via: [[840, 420]], when: { signal: 'ForwardBE', value: 1 }, requires: ['WriteDataE'], noLabel: true });
W('RegWriteW', r('MW', 'RegWrite', 'o'), 'RF.WE3', { via: [[1500, Y.RegWrite], [1500, Y.L_REGW], [530, Y.L_REGW]], labelSeg: 2 });
W('RegWriteW', [hzX('RegWriteW'), Y.RegWrite], hz('RegWriteW'), { noLabel: true, dotStart: true });
W('RdW', r('MW', 'rd', 'o'), 'RF.A3', { via: [[1520, Y.RD], [1520, Y.L_RDW], [400, Y.L_RDW], [400, 365]], labelSeg: 2 });
W('RdW', [1520, Y.L_RDW], hz('RdW'), { noLabel: true, dotStart: true });

/* Hazard Unit → схема */
W('StallF', hz('StallF'), 'PC.en', { labelDy: 60 });
W('StallD', hz('StallD'), 'RegFD.en', { labelDy: 20, labelDx: -52 });
W('FlushD', hz('FlushD'), 'RegFD.clr', { labelDy: 20 });
W('FlushE', hz('FlushE'), 'RegDE.clr', { labelDy: 20, labelDx: -52 });
W('ForwardAE', hz('ForwardAE'), 'FwdAMux.sel', { via: [[903, 370], [881, 370]], labelSeg: 0, labelDy: 130 });
W('ForwardBE', hz('ForwardBE'), 'FwdBMux.sel', { labelDy: 130, labelDx: -68 });

export const pipelinedDef: MicroarchDef = {
  id: 'riscv-pipelined',
  name: 'Конвейерный (pipelined)',
  chapter: 'H&H RISC-V, гл. 7.5',
  width: 1660,
  height: 905,
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
    { id: 'W', label: 'Writeback', x0: RX.MW + RW, x1: 1656 },
  ],
  notes: [{ x: 161, y: 634, text: '4', cls: 'const' }],
};
