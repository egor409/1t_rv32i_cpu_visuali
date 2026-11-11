/**
 * Движок многотактного процессора (Harris & Harris, RISC-V Edition, разд. 7.4).
 *
 * Инструкция выполняется за несколько коротких тактов; управляет трактом конечный автомат
 * (Main FSM). Один такт = одно состояние FSM. В трассе такт делится на две фазы:
 *   comb — комбинационная логика состояния (что выбрано мультиплексорами, что считает АЛУ);
 *   edge — фронт CLK: какие регистры защёлкивают значения.
 *
 * TODO(книга): сверить нумерацию/названия состояний и таблицу выходов FSM с рис. «Complete
 *              multicycle control FSM» (S0 Fetch … S10 BEQ) — здесь они записаны по памяти.
 */
import type { Program, SignalId, SimOptions, Trace, TraceEvent, TraceStep } from '../../core/types';
import { ALU_CTRL_NAME, OP, alu, aluDecoder, classify, disasm, extend, fields, regName, u32, usage, type InstrClass } from '../../isa/rv32i';
import { H, HD, Memory, bin, initRegs } from '../common';

export interface FsmOut {
  AdrSrc: number;
  IRWrite: number;
  ALUSrcA: number;
  ALUSrcB: number;
  ALUOp: number;
  ResultSrc: number;
  PCUpdate: number;
  Branch: number;
  MemWrite: number;
  RegWrite: number;
}

export interface StateDef {
  id: number;
  name: string;
  /** Короткая метка для таймлайна. */
  tick: string;
  out: Partial<FsmOut>;
  /** Сигналы данных на активном пути в этом состоянии. */
  path: SignalId[];
  /** Регистры, чьё защёлкнутое значение используется дальше. */
  latch: string[];
}

const S = { Fetch: 0, Decode: 1, MemAdr: 2, MemRead: 3, MemWB: 4, MemWrite: 5, ExecuteR: 6, ALUWB: 7, ExecuteI: 8, JAL: 9, BEQ: 10 } as const;

export const STATES: StateDef[] = [
  { id: 0, name: 'Fetch', tick: 'F', out: { AdrSrc: 0, IRWrite: 1, ALUSrcA: 0b00, ALUSrcB: 0b10, ALUOp: 0b00, ResultSrc: 0b10, PCUpdate: 1 },
    path: ['PC', 'Adr', 'ReadData', 'SrcA', 'Const4', 'SrcB', 'ALUResult', 'Result', 'PCNext'], latch: ['IR', 'OldPCReg'] },
  { id: 1, name: 'Decode', tick: 'D', out: { ALUSrcA: 0b01, ALUSrcB: 0b01, ALUOp: 0b00 },
    path: ['Instr', 'op', 'funct3', 'funct7b5', 'OldPC', 'ImmIn', 'ImmExt', 'SrcA', 'SrcB', 'ALUResult', 'ALUOutLatch'], latch: ['AReg', 'BReg', 'ALUOutReg'] },
  { id: 2, name: 'MemAdr', tick: 'MA', out: { ALUSrcA: 0b10, ALUSrcB: 0b01, ALUOp: 0b00 },
    path: ['Instr', 'A', 'ImmIn', 'ImmExt', 'SrcA', 'SrcB', 'ALUResult', 'ALUOutLatch'], latch: ['ALUOutReg'] },
  { id: 3, name: 'MemRead', tick: 'MR', out: { ResultSrc: 0b00, AdrSrc: 1 },
    path: ['ALUOut', 'Result', 'Adr', 'ReadData', 'DataLatch'], latch: ['DataReg'] },
  { id: 4, name: 'MemWB', tick: 'WB', out: { ResultSrc: 0b01, RegWrite: 1 },
    path: ['Instr', 'Data', 'Result', 'A3'], latch: [] },
  { id: 5, name: 'MemWrite', tick: 'MW', out: { ResultSrc: 0b00, AdrSrc: 1, MemWrite: 1 },
    path: ['ALUOut', 'Result', 'Adr', 'WriteData'], latch: [] },
  { id: 6, name: 'ExecuteR', tick: 'EX', out: { ALUSrcA: 0b10, ALUSrcB: 0b00, ALUOp: 0b10 },
    path: ['Instr', 'op', 'funct3', 'funct7b5', 'A', 'WriteData', 'SrcA', 'SrcB', 'ALUResult', 'ALUOutLatch'], latch: ['ALUOutReg'] },
  { id: 7, name: 'ALUWB', tick: 'WB', out: { ResultSrc: 0b00, RegWrite: 1 },
    path: ['Instr', 'ALUOut', 'Result', 'A3'], latch: [] },
  { id: 8, name: 'ExecuteI', tick: 'EX', out: { ALUSrcA: 0b10, ALUSrcB: 0b01, ALUOp: 0b10 },
    path: ['Instr', 'op', 'funct3', 'A', 'ImmIn', 'ImmExt', 'SrcA', 'SrcB', 'ALUResult', 'ALUOutLatch'], latch: ['ALUOutReg'] },
  { id: 9, name: 'JAL', tick: 'J', out: { ALUSrcA: 0b01, ALUSrcB: 0b10, ALUOp: 0b00, ResultSrc: 0b00, PCUpdate: 1 },
    path: ['OldPC', 'Const4', 'SrcA', 'SrcB', 'ALUResult', 'ALUOutLatch', 'ALUOut', 'Result', 'PCNext'], latch: ['ALUOutReg'] },
  { id: 10, name: 'BEQ', tick: 'B', out: { ALUSrcA: 0b10, ALUSrcB: 0b00, ALUOp: 0b01, ResultSrc: 0b00, Branch: 1 },
    path: ['A', 'WriteData', 'SrcA', 'SrcB', 'ALUResult', 'Zero', 'ALUOut', 'Result'], latch: [] },
];

export function nextState(state: number, op: number): number {
  switch (state) {
    case S.Fetch:
      return S.Decode;
    case S.Decode:
      switch (op) {
        case OP.LW:
        case OP.SW:
          return S.MemAdr;
        case OP.R:
          return S.ExecuteR;
        case OP.I:
          return S.ExecuteI;
        case OP.JAL:
          return S.JAL;
        case OP.BEQ:
          return S.BEQ;
        default:
          return S.Fetch;
      }
    case S.MemAdr:
      return op === OP.LW ? S.MemRead : S.MemWrite;
    case S.MemRead:
      return S.MemWB;
    case S.ExecuteR:
    case S.ExecuteI:
    case S.JAL:
      return S.ALUWB;
    default:
      return S.Fetch;
  }
}

/** Последовательность состояний для инструкции (для цепочки этапов в верхней панели). */
export function stateSequence(op: number): number[] {
  const seq = [S.Fetch as number, S.Decode as number];
  let s: number = nextState(S.Decode, op);
  while (s !== S.Fetch && seq.length < 8) {
    seq.push(s);
    s = nextState(s, op);
  }
  return seq;
}

/** Instr Decoder: ImmSrc определяется комбинационно по op. */
function immSrcOf(op: number): number {
  return op === OP.SW ? 0b01 : op === OP.BEQ ? 0b10 : op === OP.JAL ? 0b11 : 0b00;
}

const ALU_SYM: Record<number, string> = { 0: '+', 1: '−', 2: '&', 3: '|', 5: '<' };
const CTRL_KEYS: (keyof FsmOut)[] = ['AdrSrc', 'IRWrite', 'ALUSrcA', 'ALUSrcB', 'ALUOp', 'ResultSrc', 'PCUpdate', 'Branch', 'MemWrite', 'RegWrite'];

export function simulateMulticycle(program: Program, opts: SimOptions = {}): Trace {
  const maxCycles = opts.maxCycles ?? 240;
  const regs = initRegs(program);
  const dmem = new Memory(program.initMem);
  const steps: TraceStep[] = [];
  const warnings: string[] = [];
  const end = program.instrs.length * 4;
  const inProgram = (a: number) => a >= 0 && a < end && a % 4 === 0;
  /** Единая память команд и данных: запись «поверх» программы тоже возможна. */
  const read = (a: number) => dmem.get(a) ?? (inProgram(u32(a) & ~3) ? program.instrs[(u32(a) & ~3) / 4].word : 0);

  let pc = 0;
  let ir = 0;
  let oldpc = 0;
  let data = 0;
  let A = 0;
  let B = 0;
  let aluOut = 0;
  let state: number = S.Fetch;
  let cycle = 0;
  let instrNo = 0;
  let cur = { idx: null as number | null, text: '—', addr: 0, seq: [S.Fetch as number, S.Decode as number] };

  for (;;) {
    if (state === S.Fetch && !inProgram(pc)) break;
    if (cycle >= maxCycles) {
      warnings.push(`Достигнут лимит ${maxCycles} тактов — симуляция остановлена.`);
      break;
    }
    cycle++;
    const sd = STATES[state];
    const o: FsmOut = { AdrSrc: 0, IRWrite: 0, ALUSrcA: 0, ALUSrcB: 0, ALUOp: 0, ResultSrc: 0, PCUpdate: 0, Branch: 0, MemWrite: 0, RegWrite: 0, ...sd.out };

    /* ---- комбинационная логика ---- */
    const f = fields(ir);
    const ImmSrc = immSrcOf(f.op);
    const ALUControl = aluDecoder(o.ALUOp, f.funct3, (f.op >> 5) & 1, f.funct7b5);
    const RD1 = regs[f.rs1];
    const RD2 = regs[f.rs2];
    const ImmExt = extend(ir, ImmSrc);
    const SrcA = [pc, oldpc, A][o.ALUSrcA] ?? 0;
    const SrcB = [B, ImmExt, 4][o.ALUSrcB] ?? 0;
    const { result: ALUResult, zero: Zero } = alu(SrcA, SrcB, ALUControl);
    const Result = [aluOut, data, ALUResult][o.ResultSrc] ?? 0;
    const Adr = o.AdrSrc ? Result : pc;
    const ReadData = read(Adr);
    const PCWrite = o.PCUpdate | (o.Branch & Zero);

    if (state === S.Fetch) {
      instrNo++;
      const idx = inProgram(pc) && program.instrs[pc / 4].word === ReadData ? pc / 4 : null;
      cur = { idx, text: idx !== null ? program.instrs[idx].text : disasm(ReadData, pc), addr: pc, seq: stateSequence(ReadData & 0x7f) };
    }
    const cls: InstrClass = state === S.Fetch ? 'none' : classify(ir);
    const use = usage(cls);

    const all: Record<SignalId, number> = {
      PC: pc, PCNext: Result, Adr, ReadData, Instr: ir, OldPC: oldpc, Data: data,
      op: f.op, funct3: f.funct3, funct7b5: f.funct7b5,
      A1: f.rs1, A2: f.rs2, A3: f.rd, ImmIn: ir >>> 7,
      RD1, RD2, A, WriteData: B, ImmExt, Const4: 4,
      SrcA, SrcB, ALUResult, Zero, ALUOut: aluOut, Result,
      PCWrite, AdrSrc: o.AdrSrc, MemWrite: o.MemWrite, IRWrite: o.IRWrite, ResultSrc: o.ResultSrc,
      ALUControl, ALUSrcA: o.ALUSrcA, ALUSrcB: o.ALUSrcB, ImmSrc, RegWrite: o.RegWrite,
      Branch: o.Branch, PCUpdate: o.PCUpdate, ALUOp: o.ALUOp, State: state,
    };

    /* ---- активные пути ---- */
    const act = new Set<SignalId>(sd.path);
    for (const k of CTRL_KEYS) if (k in sd.out) act.add(k);
    act.add('State');
    if ('ALUOp' in sd.out) act.add('ALUControl');
    if (PCWrite) act.add('PCWrite');
    if (act.has('ImmExt')) act.add('ImmSrc');
    if (state === S.Decode) {
      if (use.rs1) ['A1', 'RD1'].forEach((x) => act.add(x));
      if (use.rs2) ['A2', 'RD2'].forEach((x) => act.add(x));
    }
    if (state === S.BEQ && Zero) act.add('PCNext');

    /* ---- пояснения ---- */
    const events: TraceEvent[] = [];
    let what = '';
    let why = '';
    const edge: string[] = [];
    const latching = [...sd.latch];
    const aluTxt = `${HD(SrcA)} ${ALU_SYM[ALUControl] ?? '?'} ${HD(SrcB)} = ${HD(ALUResult)}`;
    switch (state) {
      case S.Fetch:
        what = `AdrSrc=0: адрес памяти Adr = PC = ${H(pc)}; память выдаёт ReadData = ${H(ReadData)} — это «${cur.text}». Одновременно АЛУ считает PC + 4: ${aluTxt} (ALUSrcA=00, ALUSrcB=10), и через ResultSrc=10 результат подаётся на вход PC.`;
        why = 'АЛУ в такте выборки свободно, поэтому отдельный сумматор для PC + 4 не нужен — экономия аппаратуры по сравнению с однотактным процессором.';
        edge.push(`IRWrite=1: регистр команд ← ${H(ReadData)}, OldPC ← ${H(pc)}.`, `PCWrite=1: PC ← ${H(Result)}.`);
        break;
      case S.Decode: {
        const rd: string[] = [];
        if (use.rs1) rd.push(`${regName(f.rs1)} = ${HD(RD1)}`);
        if (use.rs2) rd.push(`${regName(f.rs2)} = ${HD(RD2)}`);
        what = `Control Unit декодирует op = ${bin(f.op, 7)}${rd.length ? `; регистровый файл читает ${rd.join(', ')}` : ''}. АЛУ заранее считает адрес перехода: OldPC + ImmExt = ${aluTxt}.`;
        why = 'Адрес перехода вычисляется «на всякий случай»: АЛУ в этом такте всё равно простаивает, а если инструкция окажется beq или jal, результат уже будет лежать в ALUOut.';
        edge.push(`Регистры A ← ${HD(RD1)}, WriteData ← ${HD(RD2)}; ALUOut ← ${HD(ALUResult)}.`);
        break;
      }
      case S.MemAdr:
        what = `АЛУ считает адрес обращения к памяти: A + ImmExt = ${aluTxt} (ALUSrcA=10, ALUSrcB=01, ALUOp=00).`;
        why = cls === 'lw' ? 'lw: адрес = база (rs1) + смещение. Дальше — чтение памяти (MemRead).' : 'sw: адрес = база (rs1) + смещение. Дальше — запись в память (MemWrite).';
        edge.push(`ALUOut ← ${HD(ALUResult)}.`);
        break;
      case S.MemRead:
        what = `ResultSrc=00, AdrSrc=1: адрес памяти Adr = ALUOut = ${H(Adr)}; память выдаёт ReadData = ${HD(ReadData)}.`;
        why = 'Память общая для команд и данных, поэтому её адрес выбирается мультиплексором: PC (выборка) или Result (данные).';
        edge.push(`Регистр Data ← ${HD(ReadData)}.`);
        dmem.touch(Adr);
        break;
      case S.MemWB:
        what = `ResultSrc=01: Result = Data = ${HD(Result)}; RegWrite=1 → запись в ${regName(f.rd)}.`;
        why = 'Последний такт lw — самой длинной инструкции (5 тактов).';
        break;
      case S.MemWrite:
        what = `AdrSrc=1: Adr = ALUOut = ${H(Adr)}; MemWrite=1: на входе WD значение WriteData = ${HD(B)}.`;
        why = 'sw заканчивается за 4 такта: запись в регистр ей не нужна.';
        break;
      case S.ExecuteR:
        what = `АЛУ выполняет операцию над регистрами: A ${ALU_SYM[ALUControl] ?? '?'} WriteData → ${aluTxt} (ALUOp=10 → ALUControl=${bin(ALUControl, 3)}, ${ALU_CTRL_NAME[ALUControl]}).`;
        why = 'R-type: оба операнда из регистров (ALUSrcA=10, ALUSrcB=00); операцию определяет funct3/funct7.';
        edge.push(`ALUOut ← ${HD(ALUResult)}.`);
        break;
      case S.ExecuteI:
        what = `АЛУ выполняет операцию с константой: A ${ALU_SYM[ALUControl] ?? '?'} ImmExt → ${aluTxt} (ALUControl=${bin(ALUControl, 3)}, ${ALU_CTRL_NAME[ALUControl]}).`;
        why = 'I-type ALU: второй операнд — расширенная константа (ALUSrcB=01).';
        edge.push(`ALUOut ← ${HD(ALUResult)}.`);
        break;
      case S.ALUWB:
        what = `ResultSrc=00: Result = ALUOut = ${HD(Result)}; RegWrite=1 → запись в ${regName(f.rd)}.`;
        why = cls === 'jal' ? 'Для jal в ALUOut лежит адрес возврата (OldPC + 4), посчитанный в предыдущем такте.' : 'Результат АЛУ из предыдущего такта записывается в регистр назначения.';
        break;
      case S.JAL:
        what = `PCUpdate=1, ResultSrc=00: PC ← ALUOut = ${H(Result)} (адрес перехода, посчитан в Decode). Одновременно АЛУ считает адрес возврата OldPC + 4: ${aluTxt}.`;
        why = 'За один такт делаются два дела: старое значение ALUOut уходит в PC, а новое (адрес возврата) защёлкнется в ALUOut по тому же фронту.';
        edge.push(`PC ← ${H(Result)}; ALUOut ← ${H(ALUResult)}.`);
        events.push({ kind: 'branch', text: `jal: переход на ${H(Result)}` });
        break;
      case S.BEQ:
        what = `АЛУ вычитает A − WriteData: ${aluTxt}, Zero = ${Zero}. PCWrite = PCUpdate | (Branch & Zero) = ${PCWrite}.`;
        why = Zero
          ? `Регистры равны → PC ← ALUOut = ${H(Result)} (адрес перехода, посчитанный в Decode).`
          : 'Регистры не равны → PC не изменяется (в нём уже PC + 4 после такта Fetch).';
        if (Zero) edge.push(`PCWrite=1: PC ← ${H(Result)}.`);
        events.push({ kind: 'branch', text: Zero ? 'beq: переход выполняется' : 'beq: переход не выполняется' });
        break;
    }

    const progress = { labels: cur.seq.map((s) => STATES[s].name), current: Math.max(0, cur.seq.indexOf(state)) };
    const slot = { X: { idx: cur.idx, text: cur.text, status: 'instr' as const, uid: instrNo, detail: sd.name } };
    const active = [...act];
    const blocks = stateBlocks(state);

    steps.push({
      cycle, phase: 'comb', values: all, active, fresh: active.filter((s) => s !== 'State'),
      activeBlocks: blocks, stages: slot,
      title: `Такт ${cycle} · S${state} ${sd.name}`, what, why, events: events.slice(),
      regs: regs.slice(), mem: dmem.snapshot(), progress, tick: sd.tick, badge: `Состояние S${state} · ${sd.name}`,
    });

    /* ---- фронт CLK ---- */
    let changedReg: number | undefined;
    let changedMem: number | undefined;
    const ev2: TraceEvent[] = [];
    if (o.MemWrite) {
      dmem.write(Adr, B);
      changedMem = u32(Adr) & ~3;
      latching.push('Mem');
      edge.push(`Память: Mem[${H(Adr)}] ← ${HD(B)}.`);
      ev2.push({ kind: 'memwrite', text: `Mem[${H(Adr)}] ← ${HD(B)}` });
    }
    if (o.RegWrite) {
      latching.push('RF');
      if (f.rd !== 0) {
        regs[f.rd] = Result;
        changedReg = f.rd;
        edge.push(`Регистровый файл: ${regName(f.rd)} ← ${HD(Result)}.`);
        ev2.push({ kind: 'regwrite', text: `${regName(f.rd)} ← ${HD(Result)}` });
      } else edge.push('Запись в x0 игнорируется.');
    }
    if (PCWrite) latching.push('PC');
    const next = nextState(state, state === S.Fetch ? ReadData & 0x7f : f.op);
    edge.push(`Автомат переходит в состояние S${next} ${STATES[next].name}.`);
    steps.push({
      cycle, phase: 'edge', values: all, active, fresh: [],
      activeBlocks: [], stages: slot,
      title: `Такт ${cycle} · фронт CLK`, what: edge.join(' '),
      why: 'По фронту CLK записываются только те регистры, которым это разрешено управляющими сигналами (PCWrite, IRWrite, RegWrite, MemWrite); промежуточные регистры (A, WriteData, ALUOut, Data) обновляются каждый такт.',
      events: ev2, regs: regs.slice(), mem: dmem.snapshot(), changedReg, changedMem, latching, progress, tick: '↑',
    });

    /* ---- обновление состояния ---- */
    const pcOld = pc;
    if (PCWrite) pc = Result;
    if (o.IRWrite) {
      ir = ReadData;
      oldpc = pcOld;
    }
    data = ReadData;
    A = RD1;
    B = RD2;
    aluOut = ALUResult;
    state = next;

    if (state === S.Fetch && pc === cur.addr) {
      warnings.push(`Инструкция по адресу ${H(cur.addr)} переходит сама на себя — симуляция остановлена.`);
      break;
    }
  }

  return { archId: 'riscv-multicycle', program, steps, cycles: cycle, warnings };
}

function stateBlocks(state: number): string[] {
  const b = ['Control'];
  switch (state) {
    case S.Fetch: return [...b, 'PC', 'AdrMux', 'Mem', 'SrcAMux', 'SrcBMux', 'ALU', 'ResultMux'];
    case S.Decode: return [...b, 'IR', 'RF', 'Ext', 'SrcAMux', 'SrcBMux', 'ALU'];
    case S.MemAdr:
    case S.ExecuteI: return [...b, 'AReg', 'Ext', 'SrcAMux', 'SrcBMux', 'ALU'];
    case S.MemRead: return [...b, 'ALUOutReg', 'ResultMux', 'AdrMux', 'Mem'];
    case S.MemWB: return [...b, 'DataReg', 'ResultMux', 'RF'];
    case S.MemWrite: return [...b, 'ALUOutReg', 'ResultMux', 'AdrMux', 'Mem', 'BReg'];
    case S.ExecuteR: return [...b, 'AReg', 'BReg', 'SrcAMux', 'SrcBMux', 'ALU'];
    case S.ALUWB: return [...b, 'ALUOutReg', 'ResultMux', 'RF'];
    case S.JAL: return [...b, 'OldPCReg', 'SrcAMux', 'SrcBMux', 'ALU', 'ALUOutReg', 'ResultMux', 'PC'];
    case S.BEQ: return [...b, 'AReg', 'BReg', 'SrcAMux', 'SrcBMux', 'ALU', 'ALUOutReg', 'ResultMux'];
    default: return b;
  }
}
