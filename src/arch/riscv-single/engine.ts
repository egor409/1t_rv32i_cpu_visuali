/**
 * Движок однотактного процессора (Harris & Harris, RISC-V Edition, разд. 7.3).
 * Каждый такт = одна инструкция; для наглядности такт разбит на 5 фаз,
 * в каждой фазе «проявляются» новые сигналы (комбинационная логика распространяется
 * слева направо), а запись состояния происходит в последней фазе (фронт CLK).
 */
import type { Program, SignalId, SimOptions, Trace, TraceEvent, TraceStep } from '../../core/types';
import {
  ALU_CTRL_NAME,
  IMM_SRC_NAME,
  alu,
  classify,
  controlUnit,
  extend,
  fields,
  regName,
  u32,
  usage,
} from '../../isa/rv32i';
import { D, H, HD, Memory, bin, initRegs, pick } from '../common';

const PHASES = ['fetch', 'decode', 'execute', 'memory', 'writeback'] as const;

/** Какие сигналы становятся известны в каждой фазе. */
const REVEAL: Record<(typeof PHASES)[number], SignalId[]> = {
  fetch: ['PC', 'Instr', 'PCPlus4', 'Const4'],
  decode: [
    'op', 'funct3', 'funct7b5', 'A1', 'A2', 'A3', 'ImmIn',
    'RegWrite', 'ImmSrc', 'ALUSrc', 'MemWrite', 'ResultSrc', 'Branch', 'Jump', 'ALUOp', 'ALUControl',
    'SrcA', 'RD2', 'ImmExt',
  ],
  execute: ['SrcB', 'ALUResult', 'Zero', 'PCTarget', 'PCSrc'],
  memory: ['WriteData', 'ReadData'],
  writeback: ['Result', 'PCNext'],
};

const ALU_SYM: Record<number, string> = { 0: '+', 1: '−', 2: '&', 3: '|', 5: '<' };

export function simulateSingle(program: Program, opts: SimOptions = {}): Trace {
  const maxCycles = opts.maxCycles ?? 64;
  const regs = initRegs(program);
  const mem = new Memory(program.initMem);
  const steps: TraceStep[] = [];
  const warnings: string[] = [];
  let pc = 0;
  let cycle = 0;
  const end = program.instrs.length * 4;

  while (pc >= 0 && pc < end && pc % 4 === 0) {
    if (cycle >= maxCycles) {
      warnings.push(`Достигнут лимит ${maxCycles} тактов — симуляция остановлена.`);
      break;
    }
    cycle++;
    const ins = program.instrs[pc / 4];
    const Instr = ins.word;
    const f = fields(Instr);
    const c = controlUnit(Instr);
    const cls = classify(Instr);
    const use = usage(cls);

    const PCPlus4 = u32(pc + 4);
    const SrcA = regs[f.rs1];
    const RD2 = regs[f.rs2];
    const ImmExt = extend(Instr, c.ImmSrc);
    const SrcB = c.ALUSrc ? ImmExt : RD2;
    const { result: ALUResult, zero: Zero } = alu(SrcA, SrcB, c.ALUControl);
    const PCTarget = u32(pc + ImmExt);
    const PCSrc = (c.Branch & Zero) | c.Jump;
    const ReadData = mem.read(ALUResult);
    const Result = c.ResultSrc === 0 ? ALUResult : c.ResultSrc === 1 ? ReadData : PCPlus4;
    const PCNext = PCSrc ? PCTarget : PCPlus4;

    const all: Record<SignalId, number> = {
      PC: pc, Instr, PCPlus4, Const4: 4,
      op: f.op, funct3: f.funct3, funct7b5: f.funct7b5,
      A1: f.rs1, A2: f.rs2, A3: f.rd, ImmIn: Instr >>> 7,
      RegWrite: c.RegWrite, ImmSrc: c.ImmSrc, ALUSrc: c.ALUSrc, MemWrite: c.MemWrite,
      ResultSrc: c.ResultSrc, Branch: c.Branch, Jump: c.Jump, ALUOp: c.ALUOp, ALUControl: c.ALUControl,
      SrcA, RD2, ImmExt, SrcB, ALUResult, Zero, PCTarget, PCSrc,
      WriteData: RD2, ReadData, Result, PCNext,
    };

    /* --- какие сигналы лежат на активном пути этой инструкции --- */
    const act = new Set<SignalId>([
      'PC', 'Instr', 'PCPlus4', 'Const4', 'PCNext', 'op', 'funct3', 'funct7b5',
      'RegWrite', 'ALUSrc', 'MemWrite', 'ResultSrc', 'Branch', 'Jump', 'ALUOp', 'ALUControl', 'PCSrc',
    ]);
    if (use.rs1) ['A1', 'SrcA'].forEach((s) => act.add(s));
    if (use.rs2) ['A2', 'RD2'].forEach((s) => act.add(s));
    if (use.imm) ['ImmIn', 'ImmSrc', 'ImmExt'].forEach((s) => act.add(s));
    if (use.writesReg) ['A3', 'Result'].forEach((s) => act.add(s));
    if (cls !== 'jal') ['SrcB', 'ALUResult'].forEach((s) => act.add(s));
    if (use.branch) act.add('Zero');
    if (use.branch || use.jump) act.add('PCTarget');
    if (use.writesMem) act.add('WriteData');
    if (use.readsMem) act.add('ReadData');
    if (use.readsMem || use.writesMem) act.add('MemAccess'); // псевдосигнал: адресный вход памяти используется

    const asm = ins.text;
    const sym = ALU_SYM[c.ALUControl] ?? '?';
    const visible = new Set<SignalId>();

    for (const phase of PHASES) {
      REVEAL[phase].forEach((s) => visible.add(s));
      const events: TraceEvent[] = [];
      let what = '';
      let why = '';
      let blocks: string[] = [];
      let latching: string[] | undefined;
      let changedReg: number | undefined;
      let changedMem: number | undefined;

      switch (phase) {
        case 'fetch':
          blocks = ['PC', 'IMem', 'AddPC4'];
          what = `PC = ${H(pc)} подаётся на адресный вход памяти команд; она выдаёт Instr = ${H(Instr)} — это «${asm}». Параллельно сумматор считает PCPlus4 = ${H(PCPlus4)}.`;
          why = 'Выборка одинакова для всех инструкций: PC хранит адрес текущей команды, а адрес следующей по порядку всегда PC + 4.';
          break;
        case 'decode': {
          blocks = ['Control', 'RF'];
          if (use.imm) blocks.push('Ext');
          const parts: string[] = [
            `Control Unit по op = ${bin(f.op, 7)} формирует управляющие сигналы (RegWrite=${c.RegWrite}, ALUSrc=${c.ALUSrc}, MemWrite=${c.MemWrite}, ResultSrc=${bin(c.ResultSrc, 2)}, Branch=${c.Branch}, Jump=${c.Jump}, ALUControl=${bin(c.ALUControl, 3)}).`,
          ];
          if (use.rs1) parts.push(`Регистровый файл читает ${regName(f.rs1)} → RD1 = ${HD(SrcA)}${use.rs2 ? `, ${regName(f.rs2)} → RD2 = ${HD(RD2)}` : ''}.`);
          if (use.imm) parts.push(`Extend (ImmSrc=${bin(c.ImmSrc, 2)}, ${IMM_SRC_NAME[c.ImmSrc]}) расширяет константу: ImmExt = ${HD(ImmExt)}.`);
          what = parts.join(' ');
          why = {
            lw: 'lw — I-type: базовый адрес берётся из rs1, 12-битное смещение — из Instr[31:20] с расширением знака.',
            sw: 'sw — S-type: смещение собрано из Instr[31:25] и Instr[11:7], поэтому ImmSrc=01; rs2 — записываемые данные.',
            R: 'R-type: оба операнда — регистры (ALUSrc=0), константа не нужна; операцию АЛУ определяет funct3/funct7 (ALUOp=10).',
            I: 'I-type ALU: второй операнд — константа (ALUSrc=1), операция определяется funct3 (ALUOp=10).',
            beq: 'beq — B-type: сравниваются rs1 и rs2, а константа (ImmSrc=10) — смещение перехода относительно PC.',
            jal: 'jal — J-type: 21-битное смещение (ImmSrc=11); регистры не читаются, в rd запишется адрес возврата PC+4.',
            none: '',
          }[cls];
          break;
        }
        case 'execute': {
          blocks = ['ALU'];
          if (cls !== 'jal') blocks.push('SrcBMux');
          if (use.branch || use.jump) blocks.push('AddTarget');
          if (cls === 'jal') {
            what = `Сумматор адреса перехода: PCTarget = PC + ImmExt = ${H(pc)} + ${D(ImmExt)} = ${H(PCTarget)}. Jump=1 → PCSrc=1. АЛУ не используется.`;
            why = 'Безусловный переход: PCSrc = Jump | (Branch & Zero) = 1, следующий PC будет взят из PCTarget.';
          } else {
            what = `Мультиплексор SrcB выбирает ${c.ALUSrc ? 'ImmExt' : 'RD2'} (ALUSrc=${c.ALUSrc}). АЛУ (${ALU_CTRL_NAME[c.ALUControl]}): ${HD(SrcA)} ${sym} ${HD(SrcB)} = ${HD(ALUResult)}${use.branch ? `, Zero = ${Zero}` : ''}.`;
            if (use.branch) {
              what += ` PCTarget = PC + ImmExt = ${H(PCTarget)}; PCSrc = Branch & Zero = ${PCSrc}.`;
              why = Zero
                ? 'beq: АЛУ вычитает операнды; результат 0 → Zero=1 → регистры равны, переход выполняется.'
                : 'beq: АЛУ вычитает операнды; результат ≠ 0 → Zero=0 → переход не выполняется, PC ← PC+4.';
              events.push({ kind: 'branch', text: Zero ? 'переход выполняется' : 'переход не выполняется' });
            } else if (cls === 'lw' || cls === 'sw') {
              why = 'Для обращения к памяти АЛУ складывает базовый адрес и смещение (ALUOp=00 → add).';
            } else {
              why = `ALU Decoder: ALUOp=10, funct3=${bin(f.funct3, 3)}${cls === 'R' ? `, funct7[5]=${f.funct7b5}` : ''} → ALUControl=${bin(c.ALUControl, 3)} (${ALU_CTRL_NAME[c.ALUControl]}).`;
            }
          }
          break;
        }
        case 'memory':
          if (use.readsMem) {
            blocks = ['DMem'];
            mem.touch(ALUResult);
            what = `Память данных читает слово по адресу A = ALUResult = ${H(ALUResult)}: ReadData = ${HD(ReadData)}.`;
            why = 'Чтение памяти комбинационное: данные появляются на RD в этом же такте.';
          } else if (use.writesMem) {
            blocks = ['DMem'];
            what = `MemWrite=1: на входах памяти адрес A = ${H(ALUResult)} и данные WD = WriteData = ${HD(RD2)}. Запись произойдёт по фронту CLK.`;
            why = 'sw ничего не пишет в регистры (RegWrite=0); значение rs2 идёт в память в обход АЛУ.';
          } else {
            what = 'Память данных не участвует: MemWrite=0, а выход ReadData не выбирается мультиплексором Result.';
            why = 'В однотактном процессоре все блоки «работают» каждый такт, но управляющие сигналы отключают ненужные.';
          }
          break;
        case 'writeback': {
          blocks = ['PCMux', 'PC'];
          latching = ['PC'];
          const parts: string[] = [];
          if (use.writesReg) {
            blocks.push('ResultMux', 'RF');
            const src = ['ALUResult', 'ReadData', 'PCPlus4'][c.ResultSrc];
            parts.push(`Result = ${src} = ${HD(Result)} (ResultSrc=${bin(c.ResultSrc, 2)}).`);
            if (f.rd !== 0) {
              parts.push(`По фронту CLK записывается в ${regName(f.rd)} (RegWrite=1).`);
              regs[f.rd] = Result;
              changedReg = f.rd;
              events.push({ kind: 'regwrite', text: `${regName(f.rd)} ← ${HD(Result)}` });
            } else {
              parts.push('Регистр назначения x0 — запись игнорируется (x0 всегда 0).');
            }
            latching.push('RF');
          } else {
            parts.push('RegWrite=0 — регистровый файл не изменяется.');
          }
          if (use.writesMem) {
            mem.write(ALUResult, RD2);
            changedMem = u32(ALUResult) & ~3;
            latching.push('DMem');
            parts.push(`По тому же фронту Mem[${H(ALUResult)}] ← ${HD(RD2)}.`);
            events.push({ kind: 'memwrite', text: `Mem[${H(ALUResult)}] ← ${HD(RD2)}` });
          }
          parts.push(`PCNext = ${PCSrc ? 'PCTarget' : 'PCPlus4'} = ${H(PCNext)} (PCSrc=${PCSrc}) → PC.`);
          what = parts.join(' ');
          why = 'Всё состояние (PC, регистры, память) обновляется одновременно по фронту CLK в конце такта — такт должен быть достаточно длинным для самой медленной инструкции (lw).';
          break;
        }
      }

      const vis = [...visible];
      steps.push({
        cycle,
        phase,
        values: pick(all, vis),
        active: vis.filter((s) => act.has(s)).concat(act.has('MemAccess') && visible.has('ALUResult') ? ['MemAccess'] : []),
        fresh: REVEAL[phase].filter((s) => act.has(s)),
        activeBlocks: blocks,
        stages: { X: { idx: ins.idx, text: asm, status: 'instr', uid: cycle } },
        title: `Такт ${cycle} · ${asm}`,
        what,
        why,
        events,
        regs: regs.slice(),
        mem: mem.snapshot(),
        changedReg,
        changedMem,
        latching,
      });
    }

    if (PCNext === pc) {
      warnings.push(`Инструкция по адресу ${H(pc)} переходит сама на себя — симуляция остановлена.`);
      break;
    }
    pc = PCNext;
  }

  return { archId: 'riscv-single', program, steps, cycles: cycle, warnings };
}
