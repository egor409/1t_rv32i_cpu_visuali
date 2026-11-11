/**
 * Движок конвейерного процессора с блоком разрешения конфликтов
 * (Harris & Harris, RISC-V Edition, разд. 7.5).
 *
 * Особенности по книге:
 *  - регистровый файл записывается в первой половине такта (по спаду CLK), а читается
 *    во второй, поэтому инструкция в Decode видит значение, записываемое из Writeback;
 *  - ветвление разрешается в Execute: PCSrcE = (BranchE & ZeroE) | JumpE;
 *  - forwarding из Memory (ALUResultM) и Writeback (ResultW) в Execute;
 *  - lw-stall: StallF = StallD = FlushE = lwStall;
 *  - flush при переходе: FlushD = PCSrcE, FlushE = lwStall | PCSrcE.
 *
 * Такт делится на три фазы трассы:
 *   stages — комбинационная работа всех стадий;
 *   hazard — решения Hazard Unit (forward / stall / flush);
 *   edge   — фронт CLK: что защёлкнут регистры стадий.
 */
import type {
  PipelineRow,
  Program,
  SignalId,
  SimOptions,
  StageSlot,
  Trace,
  TraceEvent,
  TraceStep,
} from '../../core/types';
import {
  ALU_CTRL_NAME,
  type Controls,
  type InstrClass,
  alu,
  classify,
  controlUnit,
  extend,
  fields,
  regName,
  u32,
  usage,
} from '../../isa/rv32i';
import { H, HD, Memory, bin, initRegs, pick } from '../common';

interface Slot {
  idx: number | null;
  uid: number;
  text: string;
  kind: 'instr' | 'bubble' | 'empty';
  /** Почему пузырь: 'stall' | 'flush'. */
  cause?: string;
}

const EMPTY: Slot = { idx: null, uid: 0, text: '—', kind: 'empty' };
const bubble = (cause: string): Slot => ({ idx: null, uid: 0, text: 'пузырь (nop)', kind: 'bubble', cause });

const ZERO_CTRL: Controls = { RegWrite: 0, ImmSrc: 0, ALUSrc: 0, MemWrite: 0, ResultSrc: 0, Branch: 0, ALUOp: 0, Jump: 0, ALUControl: 0 };

interface FD { instr: number; pc: number; pcPlus4: number; slot: Slot }
interface DE { c: Controls; rd1: number; rd2: number; pc: number; rs1: number; rs2: number; rd: number; imm: number; pcPlus4: number; instr: number; slot: Slot }
interface EM { RegWrite: number; ResultSrc: number; MemWrite: number; alu: number; wd: number; rd: number; pcPlus4: number; instr: number; slot: Slot }
interface MW { RegWrite: number; ResultSrc: number; alu: number; rdata: number; rd: number; pcPlus4: number; instr: number; slot: Slot }

const fdEmpty = (slot: Slot): FD => ({ instr: 0, pc: 0, pcPlus4: 0, slot });
const deEmpty = (slot: Slot): DE => ({ c: ZERO_CTRL, rd1: 0, rd2: 0, pc: 0, rs1: 0, rs2: 0, rd: 0, imm: 0, pcPlus4: 0, instr: 0, slot });
const emEmpty = (slot: Slot): EM => ({ RegWrite: 0, ResultSrc: 0, MemWrite: 0, alu: 0, wd: 0, rd: 0, pcPlus4: 0, instr: 0, slot });
const mwEmpty = (slot: Slot): MW => ({ RegWrite: 0, ResultSrc: 0, alu: 0, rdata: 0, rd: 0, pcPlus4: 0, instr: 0, slot });

const HAZARD_OUT: SignalId[] = ['ForwardAE', 'ForwardBE', 'StallF', 'StallD', 'FlushD', 'FlushE'];
const LATE: SignalId[] = ['StallF', 'StallD', 'FlushD', 'FlushE'];
const ALU_SYM: Record<number, string> = { 0: '+', 1: '−', 2: '&', 3: '|', 5: '<' };
const FWD_SRC = ['регистр D/E', 'ResultW (Writeback)', 'ALUResultM (Memory)'];

export function simulatePipelined(program: Program, opts: SimOptions = {}): Trace {
  const maxCycles = opts.maxCycles ?? 80;
  const regs = initRegs(program);
  const mem = new Memory(program.initMem);
  const steps: TraceStep[] = [];
  const warnings: string[] = [];
  const rows = new Map<number, PipelineRow>();
  const end = program.instrs.length * 4;
  let uidSeq = 0;

  const fetchSlot = (pc: number): Slot => {
    if (pc >= 0 && pc < end && pc % 4 === 0) {
      const ins = program.instrs[pc / 4];
      return { idx: ins.idx, uid: ++uidSeq, text: ins.text, kind: 'instr' };
    }
    return EMPTY;
  };

  let PCF = 0;
  let fSlot = fetchSlot(0);
  let rFD = fdEmpty(EMPTY);
  let rDE = deEmpty(EMPTY);
  let rEM = emEmpty(EMPTY);
  let rMW = mwEmpty(EMPTY);
  let cycle = 0;

  for (;;) {
    if (cycle >= maxCycles) {
      warnings.push(`Достигнут лимит ${maxCycles} тактов — симуляция остановлена.`);
      break;
    }
    cycle++;
    const events: TraceEvent[] = [];

    /* ---------------- Writeback (первая половина такта) ---------------- */
    const ResultW = rMW.ResultSrc === 0 ? rMW.alu : rMW.ResultSrc === 1 ? rMW.rdata : rMW.pcPlus4;
    let changedReg: number | undefined;
    if (rMW.RegWrite && rMW.rd !== 0) {
      regs[rMW.rd] = ResultW;
      changedReg = rMW.rd;
      events.push({ kind: 'regwrite', text: `${regName(rMW.rd)} ← ${HD(ResultW)}` });
    }

    /* ---------------- Fetch ---------------- */
    const InstrF = fSlot.kind === 'instr' ? program.instrs[PCF / 4].word : 0;
    const PCPlus4F = u32(PCF + 4);

    /* ---------------- Decode ---------------- */
    const InstrD = rFD.instr;
    const fD = fields(InstrD);
    const cD = controlUnit(InstrD);
    const clsD: InstrClass = rFD.slot.kind === 'instr' ? classify(InstrD) : 'none';
    const useD = usage(clsD);
    const RD1D = regs[fD.rs1];
    const RD2D = regs[fD.rs2];
    const ImmExtD = extend(InstrD, cD.ImmSrc);

    /* ---------------- Memory ---------------- */
    const clsM: InstrClass = rEM.slot.kind === 'instr' ? classify(rEM.instr) : 'none';
    const useM = usage(clsM);
    const ReadDataM = mem.read(rEM.alu);
    if (useM.readsMem) mem.touch(rEM.alu);

    /* ---------------- Hazard Unit: forwarding ---------------- */
    const fwd = (rs: number) =>
      rs !== 0 && rs === rEM.rd && rEM.RegWrite ? 0b10 : rs !== 0 && rs === rMW.rd && rMW.RegWrite ? 0b01 : 0b00;
    const ForwardAE = fwd(rDE.rs1);
    const ForwardBE = fwd(rDE.rs2);

    /* ---------------- Execute ---------------- */
    const clsE: InstrClass = rDE.slot.kind === 'instr' ? classify(rDE.instr) : 'none';
    const useE = usage(clsE);
    const cE = rDE.c;
    const mux3 = (sel: number, a: number, b: number, c: number) => (sel === 0 ? a : sel === 1 ? b : c);
    const SrcAE = mux3(ForwardAE, rDE.rd1, ResultW, rEM.alu);
    const WriteDataE = mux3(ForwardBE, rDE.rd2, ResultW, rEM.alu);
    const SrcBE = cE.ALUSrc ? rDE.imm : WriteDataE;
    const { result: ALUResultE, zero: ZeroE } = alu(SrcAE, SrcBE, cE.ALUControl);
    const PCTargetE = u32(rDE.pc + rDE.imm);
    const PCSrcE = (cE.Branch & ZeroE) | cE.Jump;

    /* ---------------- Hazard Unit: stall / flush ---------------- */
    const ResultSrcE0 = cE.ResultSrc & 1;
    // TODO(книга): lwStall записан как в разд. 7.5.3 — без проверки, что Rs1D/Rs2D реально
    //              используются инструкцией в Decode (возможна «ложная» задержка).
    const lwStall = ResultSrcE0 && (fD.rs1 === rDE.rd || fD.rs2 === rDE.rd) ? 1 : 0;
    const StallF = lwStall;
    const StallD = lwStall;
    const FlushD = PCSrcE;
    const FlushE = lwStall | PCSrcE;

    const PCFNext = PCSrcE ? PCTargetE : PCPlus4F;

    /* ---------------- Сигналы ---------------- */
    const all: Record<SignalId, number> = {
      PCFNext, PCF, InstrF, PCPlus4F, Const4: 4,
      InstrD, PCD: rFD.pc, PCPlus4D: rFD.pcPlus4,
      opD: fD.op, funct3D: fD.funct3, funct7b5D: fD.funct7b5,
      Rs1D: fD.rs1, Rs2D: fD.rs2, RdD: fD.rd, ImmInD: InstrD >>> 7,
      RD1D, RD2D, ImmExtD,
      RegWriteD: cD.RegWrite, ResultSrcD: cD.ResultSrc, MemWriteD: cD.MemWrite, JumpD: cD.Jump,
      BranchD: cD.Branch, ALUControlD: cD.ALUControl, ALUSrcD: cD.ALUSrc, ImmSrcD: cD.ImmSrc,
      RegWriteE: cE.RegWrite, ResultSrcE: cE.ResultSrc, MemWriteE: cE.MemWrite, JumpE: cE.Jump,
      BranchE: cE.Branch, ALUControlE: cE.ALUControl, ALUSrcE: cE.ALUSrc, ResultSrcE0,
      RD1E: rDE.rd1, RD2E: rDE.rd2, PCE: rDE.pc, Rs1E: rDE.rs1, Rs2E: rDE.rs2, RdE: rDE.rd,
      ImmExtE: rDE.imm, PCPlus4E: rDE.pcPlus4,
      SrcAE, SrcBE, WriteDataE, ALUResultE, ZeroE, PCTargetE, PCSrcE,
      RegWriteM: rEM.RegWrite, ResultSrcM: rEM.ResultSrc, MemWriteM: rEM.MemWrite,
      ALUResultM: rEM.alu, WriteDataM: rEM.wd, RdM: rEM.rd, PCPlus4M: rEM.pcPlus4, ReadDataM,
      RegWriteW: rMW.RegWrite, ResultSrcW: rMW.ResultSrc, ALUResultW: rMW.alu, ReadDataW: rMW.rdata,
      RdW: rMW.rd, PCPlus4W: rMW.pcPlus4, ResultW,
      ForwardAE, ForwardBE, StallF, StallD, FlushD, FlushE,
    };

    /* ---------------- Активные пути ---------------- */
    const act = new Set<SignalId>();
    const add = (...s: SignalId[]) => s.forEach((x) => act.add(x));
    const usesA = useE.rs1;
    const usesB = useE.rs2;
    const clsW: InstrClass = rMW.slot.kind === 'instr' ? classify(rMW.instr) : 'none';

    if (fSlot.kind === 'instr') add('PCF', 'InstrF', 'PCPlus4F', 'Const4');
    if (fSlot.kind === 'instr' || PCSrcE) add('PCFNext');
    if (clsD !== 'none') {
      add('InstrD', 'opD', 'funct3D', 'funct7b5D', 'RegWriteD', 'ResultSrcD', 'MemWriteD', 'JumpD', 'BranchD', 'ALUControlD', 'ALUSrcD');
      if (useD.rs1) add('Rs1D', 'RD1D');
      if (useD.rs2) add('Rs2D', 'RD2D');
      if (useD.imm) add('ImmInD', 'ImmSrcD', 'ImmExtD');
      if (useD.writesReg) add('RdD');
      if (useD.branch || useD.jump) add('PCD');
      if (useD.jump) add('PCPlus4D');
    }
    if (clsE !== 'none') {
      add('RegWriteE', 'ResultSrcE', 'MemWriteE', 'JumpE', 'BranchE', 'ALUControlE', 'ALUSrcE', 'ResultSrcE0', 'PCSrcE');
      if (usesA) add('Rs1E', 'SrcAE', 'RD1E');
      if (usesB) add('Rs2E', 'WriteDataE', 'RD2E');
      if (useE.imm) add('ImmExtE');
      if (clsE !== 'jal') add('SrcBE', 'ALUResultE');
      if (useE.branch) add('ZeroE');
      if (useE.branch || useE.jump) add('PCE', 'PCTargetE');
      if (useE.writesReg) add('RdE');
      if (useE.jump) add('PCPlus4E');
    }
    if (clsM !== 'none') {
      add('RegWriteM', 'ResultSrcM', 'MemWriteM');
      if (clsM !== 'jal') add('ALUResultM');
      if (useM.readsMem || useM.writesMem) add('MemAccessM'); // псевдосигнал: адресный вход памяти используется
      if (useM.writesMem) add('WriteDataM');
      if (useM.readsMem) add('ReadDataM');
      if (useM.writesReg) add('RdM');
      if (useM.jump) add('PCPlus4M');
    }
    if (clsW !== 'none') {
      add('RegWriteW', 'ResultSrcW');
      if (rMW.RegWrite) {
        add('ResultW', 'RdW', ['ALUResultW', 'ReadDataW', 'PCPlus4W'][rMW.ResultSrc]);
      }
    }
    for (const h of HAZARD_OUT) if (all[h]) act.add(h);

    /* ---------------- Описания стадий ---------------- */
    const slotOut = (s: Slot, detail: string, note?: string): StageSlot => ({
      idx: s.idx,
      text: s.text,
      status: s.kind === 'instr' ? 'instr' : s.kind === 'bubble' ? 'bubble' : 'empty',
      uid: s.uid || undefined,
      detail: s.kind === 'instr' ? detail : s.kind === 'bubble' ? `пузырь (${s.cause === 'stall' ? 'вставлен из-за lw-stall' : 'инструкция отменена flush'})` : 'пусто',
      note,
    });

    const dParts: string[] = [];
    if (useD.rs1) dParts.push(`${regName(fD.rs1)}=${HD(RD1D)}`);
    if (useD.rs2) dParts.push(`${regName(fD.rs2)}=${HD(RD2D)}`);
    if (useD.imm) dParts.push(`ImmExt=${HD(ImmExtD)}`);
    const dDetail = `декодирование${dParts.length ? '; чтение ' + dParts.join(', ') : ''}`;

    let eDetail: string;
    if (clsE === 'jal') eDetail = `PCTargetE = ${H(rDE.pc)} + ${HD(rDE.imm)} = ${H(PCTargetE)}; JumpE=1 → PCSrcE=1`;
    else {
      eDetail = `АЛУ (${ALU_CTRL_NAME[cE.ALUControl]}): ${HD(SrcAE)} ${ALU_SYM[cE.ALUControl] ?? '?'} ${HD(SrcBE)} = ${HD(ALUResultE)}`;
      if (useE.branch) eDetail += `; ZeroE=${ZeroE} → PCSrcE=${PCSrcE}${PCSrcE ? `, PCTargetE=${H(PCTargetE)}` : ''}`;
    }
    const mDetail = useM.readsMem
      ? `чтение Mem[${H(rEM.alu)}] = ${HD(ReadDataM)}`
      : useM.writesMem
        ? `запись Mem[${H(rEM.alu)}] ← ${HD(rEM.wd)} (по фронту)`
        : 'память не используется, результат проходит дальше';
    const wDetail = rMW.RegWrite
      ? rMW.rd !== 0
        ? `${regName(rMW.rd)} ← ${HD(ResultW)} (запись в первой половине такта)`
        : 'запись в x0 игнорируется'
      : 'ничего не записывает в регистры';

    const eNote =
      [usesA && ForwardAE ? `A←${ForwardAE === 2 ? 'M' : 'W'}` : '', usesB && ForwardBE ? `B←${ForwardBE === 2 ? 'M' : 'W'}` : '']
        .filter(Boolean)
        .join(', ') || undefined;

    const stages: Record<string, StageSlot> = {
      F: slotOut(fSlot, `выборка по PCF = ${H(PCF)}: InstrF = ${H(InstrF)}`, lwStall ? 'stall' : PCSrcE ? 'flush' : undefined),
      D: slotOut(rFD.slot, dDetail, lwStall ? 'stall' : PCSrcE ? 'flush' : undefined),
      E: slotOut(rDE.slot, eDetail, eNote ? `forward ${eNote}` : undefined),
      M: slotOut(rEM.slot, mDetail),
      W: slotOut(rMW.slot, wDetail),
    };

    /* ---------------- pipeline-диаграмма ---------------- */
    const mark = (s: Slot, stage: string, m?: 'stall' | 'flush') => {
      if (s.kind !== 'instr') return;
      let row = rows.get(s.uid);
      if (!row) {
        row = { uid: s.uid, idx: s.idx!, text: s.text, cells: {} };
        rows.set(s.uid, row);
      }
      row.cells[cycle] = { stage, mark: m };
    };
    const fdMark = lwStall ? 'stall' : PCSrcE ? 'flush' : undefined;
    mark(fSlot, 'F', fdMark);
    mark(rFD.slot, 'D', fdMark);
    mark(rDE.slot, 'E');
    mark(rEM.slot, 'M');
    mark(rMW.slot, 'W');

    /* ---------------- Пояснения Hazard Unit ---------------- */
    const hz: string[] = [];
    const hzWhy: string[] = [];
    const fwdText = (which: 'A' | 'B', sel: number, rs: number, used: boolean) => {
      if (!sel) return;
      const src = sel === 2 ? 'M' : 'W';
      const sig = which === 'A' ? 'ForwardAE' : 'ForwardBE';
      const rsName = which === 'A' ? 'Rs1E' : 'Rs2E';
      if (used) {
        hz.push(`${sig}=${bin(sel, 2)}: ${rsName} = ${regName(rs)} совпадает с Rd${src}, RegWrite${src}=1 → операнд ${which} берётся из ${FWD_SRC[sel]} = ${HD(sel === 2 ? rEM.alu : ResultW)}.`);
        events.push({ kind: 'forward', text: `forward ${regName(rs)}: ${src} → E (${which})` });
      } else {
        hz.push(`${sig}=${bin(sel, 2)} (формально: поле ${rsName} совпало с Rd${src}, но эта инструкция его не использует).`);
      }
    };
    fwdText('A', ForwardAE, rDE.rs1, usesA);
    fwdText('B', ForwardBE, rDE.rs2, usesB);
    if ((usesA && ForwardAE) || (usesB && ForwardBE)) {
      hzWhy.push('Нужное значение уже вычислено, но ещё не записано в регистровый файл — оно пересылается (forwarding) прямо на вход АЛУ; приоритет у стадии Memory, там более свежий результат.');
    }
    if (lwStall) {
      const real = (useD.rs1 && fD.rs1 === rDE.rd) || (useD.rs2 && fD.rs2 === rDE.rd);
      hz.push(`lwStall=1: в Execute находится lw с RdE = ${regName(rDE.rd)}, а инструкция в Decode читает этот регистр → StallF = StallD = 1, FlushE = 1.`);
      hzWhy.push(
        real
          ? 'Данные lw появятся только в конце стадии Memory — переслать их в Execute следующим тактом нельзя. Конвейер придерживает Fetch и Decode на один такт, а в Execute вставляет пузырь; затем значение придёт форвардингом из Writeback.'
          : 'Формальное совпадение: поле Rs1D/Rs2D здесь не является читаемым регистром, но Hazard Unit из книги этого не различает и всё равно задерживает конвейер на такт.',
      );
      events.push({ kind: 'stall', text: `lw-stall: ждём ${regName(rDE.rd)}` });
    }
    if (PCSrcE) {
      hz.push(`PCSrcE=1: ${clsE === 'jal' ? 'jal' : 'beq'} в Execute выполняет переход на ${H(PCTargetE)} → FlushD = FlushE = 1.`);
      hzWhy.push('Решение о переходе принимается только в Execute; две инструкции, выбранные следом (сейчас в Fetch и Decode), попали в конвейер ошибочно и превращаются в пузыри — штраф 2 такта.');
      events.push({ kind: 'flush', text: `переход на ${H(PCTargetE)}: flush F/D и D/E` });
    } else if (useE.branch) {
      events.push({ kind: 'branch', text: 'beq: переход не выполняется' });
    }
    if (hz.length === 0) {
      hz.push('Конфликтов нет: ForwardAE = ForwardBE = 00, Stall = Flush = 0.');
      hzWhy.push('Hazard Unit каждый такт сравнивает номера регистров-источников в Execute/Decode с регистрами назначения в Memory/Writeback/Execute; совпадений нет — конвейер движется свободно.');
    }

    /* ---------------- Шаги трассы ---------------- */
    const ids = Object.keys(all);
    const activeAll = ids.filter((s) => act.has(s)).concat([...act].filter((s) => !(s in all)));
    const insts = (['F', 'D', 'E', 'M', 'W'] as const)
      .map((s) => (stages[s].status === 'instr' ? `${s}: ${stages[s].text}` : null))
      .filter(Boolean);
    const base = {
      cycle,
      stages,
      regs: regs.slice(),
    };

    // 1) работа стадий
    {
      const vis = ids.filter((s) => !LATE.includes(s));
      steps.push({
        ...base,
        phase: 'stages',
        values: pick(all, vis),
        active: activeAll.filter((s) => !LATE.includes(s)),
        fresh: activeAll.filter((s) => !HAZARD_OUT.includes(s)),
        activeBlocks: stageBlocks(stages, clsD, clsE, clsM, clsW, useD.imm),
        title: `Такт ${cycle} · работа стадий`,
        what: insts.length
          ? `Все стадии работают одновременно, каждая над своей инструкцией — ${insts.join(' · ')}.`
          : 'Конвейер пуст.',
        why:
          changedReg !== undefined
            ? `Writeback пишет ${regName(changedReg)} в первой половине такта, поэтому Decode во второй половине уже читает новое значение.`
            : 'Регистры стадий (F/D, D/E, E/M, M/W) хранят всё, что нужно инструкции на следующих стадиях, — данные и управляющие сигналы.',
        events: events.filter((e) => e.kind === 'regwrite'),
        mem: mem.snapshot(),
        changedReg,
      });
    }

    // 2) Hazard Unit
    {
      const hzIn: SignalId[] = ['Rs1D', 'Rs2D', 'Rs1E', 'Rs2E', 'RdE', 'ResultSrcE0', 'PCSrcE', 'RdM', 'RegWriteM', 'RdW', 'RegWriteW'];
      steps.push({
        ...base,
        phase: 'hazard',
        values: all,
        active: activeAll,
        fresh: HAZARD_OUT.filter((s) => act.has(s)).concat(hzIn.filter((s) => act.has(s))),
        activeBlocks: ['Hazard', ...(usesA && ForwardAE ? ['FwdAMux'] : []), ...(usesB && ForwardBE ? ['FwdBMux'] : [])],
        title: `Такт ${cycle} · Hazard Unit`,
        what: hz.join(' '),
        why: hzWhy.join(' '),
        events: events.filter((e) => e.kind !== 'regwrite' && e.kind !== 'memwrite'),
        mem: mem.snapshot(),
      });
    }

    // 3) фронт CLK
    let changedMem: number | undefined;
    if (rEM.MemWrite) {
      mem.write(rEM.alu, rEM.wd);
      changedMem = u32(rEM.alu) & ~3;
      events.push({ kind: 'memwrite', text: `Mem[${H(rEM.alu)}] ← ${HD(rEM.wd)}` });
    }
    {
      const latching: string[] = ['RegEM', 'RegMW'];
      const stalled: string[] = [];
      const flushed: string[] = [];
      const edge: string[] = [];
      if (StallF) {
        stalled.push('PC', 'RegFD');
        edge.push('PC и регистр F/D удерживают значения (EN=0): инструкции в Fetch и Decode остаются на месте.');
      } else {
        latching.push('PC');
        edge.push(`PCF ← ${H(PCFNext)} (${PCSrcE ? 'PCTargetE, переход' : 'PCPlus4F'}).`);
      }
      if (FlushD) {
        flushed.push('RegFD');
        edge.push('Регистр F/D сбрасывается (CLR): выбранная инструкция отменена.');
      } else if (!StallD) latching.push('RegFD');
      if (FlushE) {
        flushed.push('RegDE');
        edge.push(`Регистр D/E сбрасывается (CLR): в Execute войдёт пузырь${lwStall ? ' вместо задержанной инструкции' : ''}.`);
      } else latching.push('RegDE');
      if (!StallF && !FlushD && !FlushE) edge.push('Все регистры стадий защёлкивают новые значения: каждая инструкция переходит на следующую стадию.');
      if (changedMem !== undefined) {
        latching.push('DMem');
        edge.push(`Память данных: Mem[${H(rEM.alu)}] ← ${HD(rEM.wd)} (MemWriteM=1).`);
      }
      steps.push({
        ...base,
        phase: 'edge',
        values: all,
        active: activeAll,
        fresh: [],
        activeBlocks: [],
        title: `Такт ${cycle} · фронт CLK`,
        what: edge.join(' '),
        why:
          lwStall || PCSrcE
            ? 'Stall реализован входом разрешения EN регистра (значение не меняется), flush — синхронным сбросом CLR (в регистр попадают нули = nop, который ничего не записывает).'
            : 'По фронту тактового сигнала содержимое каждой стадии переписывается в следующий регистр — так конвейер выполняет до пяти инструкций одновременно.',
        events: events.filter((e) => e.kind === 'memwrite'),
        mem: mem.snapshot(),
        changedMem,
        latching,
        stalled,
        flushed,
      });
    }

    /* ---------------- Обновление состояния по фронту ---------------- */
    const nMW: MW = { RegWrite: rEM.RegWrite, ResultSrc: rEM.ResultSrc, alu: rEM.alu, rdata: ReadDataM, rd: rEM.rd, pcPlus4: rEM.pcPlus4, instr: rEM.instr, slot: rEM.slot };
    const nEM: EM = { RegWrite: cE.RegWrite, ResultSrc: cE.ResultSrc, MemWrite: cE.MemWrite, alu: ALUResultE, wd: WriteDataE, rd: rDE.rd, pcPlus4: rDE.pcPlus4, instr: rDE.instr, slot: rDE.slot };
    const nDE: DE = FlushE
      ? deEmpty(bubble(lwStall ? 'stall' : 'flush'))
      : { c: cD, rd1: RD1D, rd2: RD2D, pc: rFD.pc, rs1: fD.rs1, rs2: fD.rs2, rd: fD.rd, imm: ImmExtD, pcPlus4: rFD.pcPlus4, instr: InstrD, slot: rFD.slot };
    const nFD: FD = FlushD
      ? fdEmpty(fSlot.kind === 'instr' ? bubble('flush') : EMPTY)
      : StallD
        ? rFD
        : { instr: InstrF, pc: PCF, pcPlus4: PCPlus4F, slot: fSlot };
    // пузырь на месте «пустой» инструкции не показываем как пузырь
    if (FlushE && !lwStall && rFD.slot.kind !== 'instr') nDE.slot = EMPTY;
    rMW = nMW;
    rEM = nEM;
    rDE = nDE;
    rFD = nFD;
    if (!StallF) {
      PCF = PCFNext;
      fSlot = fetchSlot(PCF);
    }

    const busy = [fSlot, rFD.slot, rDE.slot, rEM.slot, rMW.slot].some((s) => s.kind === 'instr');
    if (!busy) break;
  }

  return {
    archId: 'riscv-pipelined',
    program,
    steps,
    cycles: cycle,
    pipeline: [...rows.values()].sort((a, b) => a.uid - b.uid),
    warnings,
  };
}

function stageBlocks(
  st: Record<string, StageSlot>,
  clsD: InstrClass,
  clsE: InstrClass,
  clsM: InstrClass,
  clsW: InstrClass,
  immD: boolean,
): string[] {
  const b: string[] = [];
  if (st.F.status === 'instr') b.push('PC', 'IMem', 'AddPC4', 'PCMux');
  if (clsD !== 'none') {
    b.push('Control', 'RF');
    if (immD) b.push('Ext');
  }
  if (clsE !== 'none') {
    if (clsE !== 'jal') b.push('ALU', 'SrcBMux', 'FwdAMux', 'FwdBMux');
    if (clsE === 'beq' || clsE === 'jal') b.push('AddTarget', 'PCLogic');
  }
  if (clsM === 'lw' || clsM === 'sw') b.push('DMem');
  if (clsW !== 'none' && usage(clsW).writesReg) b.push('ResultMux', 'RF');
  return b;
}
