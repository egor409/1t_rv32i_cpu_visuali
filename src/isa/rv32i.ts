/**
 * Подмножество RV32I из гл. 7 Harris & Harris:
 *   lw, sw, R-type (add, sub, and, or, slt), I-type ALU (addi, andi, ori, slti), beq, jal.
 * Здесь же — логика блоков, общая для всех микроархитектур главы:
 * Main Decoder, ALU Decoder, Extend, ALU.
 */

export const OP = {
  LW: 0b0000011,
  SW: 0b0100011,
  R: 0b0110011,
  I: 0b0010011,
  BEQ: 0b1100011,
  JAL: 0b1101111,
} as const;

export const u32 = (x: number) => x >>> 0;
export const s32 = (x: number) => x | 0;

export interface Fields {
  op: number;
  rd: number;
  funct3: number;
  rs1: number;
  rs2: number;
  funct7: number;
  funct7b5: number;
}

export function fields(instr: number): Fields {
  instr = u32(instr);
  return {
    op: instr & 0x7f,
    rd: (instr >>> 7) & 0x1f,
    funct3: (instr >>> 12) & 0x7,
    rs1: (instr >>> 15) & 0x1f,
    rs2: (instr >>> 20) & 0x1f,
    funct7: (instr >>> 25) & 0x7f,
    funct7b5: (instr >>> 30) & 1,
  };
}

/* ---------------- Extend (табл. 7.? ImmSrc) ---------------- */

export const IMM_SRC_NAME = ['I-type', 'S-type', 'B-type', 'J-type'];

/** Блок Extend: на вход Instr[31:7] (здесь — всё слово), ImmSrc → ImmExt. */
export function extend(instr: number, immSrc: number): number {
  instr = u32(instr);
  const sign = s32(instr) >> 31; // 0 или -1
  switch (immSrc) {
    case 0: // I: {{20{Instr[31]}}, Instr[31:20]}
      return u32(s32(instr) >> 20);
    case 1: // S: {{20{Instr[31]}}, Instr[31:25], Instr[11:7]}
      return u32(((s32(instr) >> 25) << 5) | ((instr >>> 7) & 0x1f));
    case 2: // B: {{20{Instr[31]}}, Instr[7], Instr[30:25], Instr[11:8], 0}
      return u32(
        (sign << 12) |
          (((instr >>> 7) & 1) << 11) |
          (((instr >>> 25) & 0x3f) << 5) |
          (((instr >>> 8) & 0xf) << 1),
      );
    case 3: // J: {{12{Instr[31]}}, Instr[19:12], Instr[20], Instr[30:21], 0}
      return u32(
        (sign << 20) |
          (instr & 0xff000) |
          (((instr >>> 20) & 1) << 11) |
          (((instr >>> 21) & 0x3ff) << 1),
      );
    default:
      return 0;
  }
}

/* ---------------- Control Unit ---------------- */

export interface Controls {
  RegWrite: number;
  ImmSrc: number;
  ALUSrc: number;
  MemWrite: number;
  ResultSrc: number;
  Branch: number;
  ALUOp: number;
  Jump: number;
  ALUControl: number;
}

/**
 * Main Decoder — таблица из разд. 7.3 (с расширениями для I-type ALU и jal, разд. 7.3.4).
 * Для неопределённых значений (x в таблице книги) подставляем 0.
 * TODO(книга): сверить "x"-поля таблицы Main Decoder (ImmSrc у R-type, ResultSrc у sw/beq,
 *              ALUSrc/ALUOp у jal) — мы ставим 0, в книге там don't care.
 */
export function mainDecoder(op: number): Omit<Controls, 'ALUControl'> {
  switch (op) {
    case OP.LW:
      return { RegWrite: 1, ImmSrc: 0b00, ALUSrc: 1, MemWrite: 0, ResultSrc: 0b01, Branch: 0, ALUOp: 0b00, Jump: 0 };
    case OP.SW:
      return { RegWrite: 0, ImmSrc: 0b01, ALUSrc: 1, MemWrite: 1, ResultSrc: 0b00, Branch: 0, ALUOp: 0b00, Jump: 0 };
    case OP.R:
      return { RegWrite: 1, ImmSrc: 0b00, ALUSrc: 0, MemWrite: 0, ResultSrc: 0b00, Branch: 0, ALUOp: 0b10, Jump: 0 };
    case OP.BEQ:
      return { RegWrite: 0, ImmSrc: 0b10, ALUSrc: 0, MemWrite: 0, ResultSrc: 0b00, Branch: 1, ALUOp: 0b01, Jump: 0 };
    case OP.I:
      return { RegWrite: 1, ImmSrc: 0b00, ALUSrc: 1, MemWrite: 0, ResultSrc: 0b00, Branch: 0, ALUOp: 0b10, Jump: 0 };
    case OP.JAL:
      return { RegWrite: 1, ImmSrc: 0b11, ALUSrc: 0, MemWrite: 0, ResultSrc: 0b10, Branch: 0, ALUOp: 0b00, Jump: 1 };
    default:
      // Нули: пузырь (InstrD = 0 после сброса регистра) ничего не пишет.
      return { RegWrite: 0, ImmSrc: 0, ALUSrc: 0, MemWrite: 0, ResultSrc: 0, Branch: 0, ALUOp: 0, Jump: 0 };
  }
}

export const ALU_CTRL = { ADD: 0b000, SUB: 0b001, AND: 0b010, OR: 0b011, SLT: 0b101 } as const;
export const ALU_CTRL_NAME: Record<number, string> = { 0: 'add', 1: 'sub', 2: 'and', 3: 'or', 5: 'slt' };

/** ALU Decoder (разд. 7.3.2). */
export function aluDecoder(aluOp: number, funct3: number, op5: number, funct7b5: number): number {
  if (aluOp === 0b00) return ALU_CTRL.ADD;
  if (aluOp === 0b01) return ALU_CTRL.SUB;
  switch (funct3) {
    case 0b000:
      return op5 && funct7b5 ? ALU_CTRL.SUB : ALU_CTRL.ADD;
    case 0b010:
      return ALU_CTRL.SLT;
    case 0b110:
      return ALU_CTRL.OR;
    case 0b111:
      return ALU_CTRL.AND;
    default:
      return ALU_CTRL.ADD; // TODO(книга): поведение для неподдерживаемых funct3 не определено
  }
}

export function controlUnit(instr: number): Controls {
  const f = fields(instr);
  const m = mainDecoder(f.op);
  const ALUControl = aluDecoder(m.ALUOp, f.funct3, (f.op >> 5) & 1, f.funct7b5);
  return { ...m, ALUControl };
}

/* ---------------- ALU ---------------- */

export function alu(a: number, b: number, ctrl: number): { result: number; zero: number } {
  let r: number;
  switch (ctrl) {
    case ALU_CTRL.ADD:
      r = a + b;
      break;
    case ALU_CTRL.SUB:
      r = a - b;
      break;
    case ALU_CTRL.AND:
      r = a & b;
      break;
    case ALU_CTRL.OR:
      r = a | b;
      break;
    case ALU_CTRL.SLT:
      r = s32(a) < s32(b) ? 1 : 0;
      break;
    default:
      r = 0;
  }
  r = u32(r);
  return { result: r, zero: r === 0 ? 1 : 0 };
}

/* ---------------- Классификация (для подсветки путей и пояснений) ---------------- */

export type InstrClass = 'lw' | 'sw' | 'R' | 'I' | 'beq' | 'jal' | 'none';

export function classify(instr: number): InstrClass {
  switch (u32(instr) & 0x7f) {
    case OP.LW:
      return 'lw';
    case OP.SW:
      return 'sw';
    case OP.R:
      return 'R';
    case OP.I:
      return 'I';
    case OP.BEQ:
      return 'beq';
    case OP.JAL:
      return 'jal';
    default:
      return 'none';
  }
}

export interface Usage {
  rs1: boolean;
  rs2: boolean;
  imm: boolean;
  writesReg: boolean;
  readsMem: boolean;
  writesMem: boolean;
  branch: boolean;
  jump: boolean;
}

export function usage(cls: InstrClass): Usage {
  const u: Usage = { rs1: false, rs2: false, imm: false, writesReg: false, readsMem: false, writesMem: false, branch: false, jump: false };
  switch (cls) {
    case 'lw':
      return { ...u, rs1: true, imm: true, writesReg: true, readsMem: true };
    case 'sw':
      return { ...u, rs1: true, rs2: true, imm: true, writesMem: true };
    case 'R':
      return { ...u, rs1: true, rs2: true, writesReg: true };
    case 'I':
      return { ...u, rs1: true, imm: true, writesReg: true };
    case 'beq':
      return { ...u, rs1: true, rs2: true, imm: true, branch: true };
    case 'jal':
      return { ...u, imm: true, writesReg: true, jump: true };
    default:
      return u;
  }
}

/* ---------------- Регистры ---------------- */

const ABI = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
  's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11',
  't3', 't4', 't5', 't6',
];

export function regName(i: number): string {
  return `x${i}`;
}
export function abiName(i: number): string {
  return ABI[i] ?? `x${i}`;
}

export function parseReg(s: string): number | null {
  s = s.trim().toLowerCase();
  if (/^x([0-9]|[12][0-9]|3[01])$/.test(s)) return Number(s.slice(1));
  if (s === 'fp') return 8;
  const i = ABI.indexOf(s);
  return i >= 0 ? i : null;
}

/* ---------------- Дизассемблер ---------------- */

export function disasm(word: number, pc = 0): string {
  word = u32(word);
  if (word === 0) return 'bubble';
  const f = fields(word);
  const r = (i: number) => regName(i);
  switch (f.op) {
    case OP.LW:
      return `lw ${r(f.rd)}, ${s32(extend(word, 0))}(${r(f.rs1)})`;
    case OP.SW:
      return `sw ${r(f.rs2)}, ${s32(extend(word, 1))}(${r(f.rs1)})`;
    case OP.R: {
      const n = { 0: f.funct7b5 ? 'sub' : 'add', 2: 'slt', 6: 'or', 7: 'and' }[f.funct3] ?? '?';
      return `${n} ${r(f.rd)}, ${r(f.rs1)}, ${r(f.rs2)}`;
    }
    case OP.I: {
      const n = { 0: 'addi', 2: 'slti', 6: 'ori', 7: 'andi' }[f.funct3] ?? '?';
      if (word === 0x00000013) return 'nop';
      return `${n} ${r(f.rd)}, ${r(f.rs1)}, ${s32(extend(word, 0))}`;
    }
    case OP.BEQ:
      return `beq ${r(f.rs1)}, ${r(f.rs2)}, ${hex(pc + s32(extend(word, 2)))}`;
    case OP.JAL:
      return `jal ${r(f.rd)}, ${hex(pc + s32(extend(word, 3)))}`;
    default:
      return `.word ${hex(word)}`;
  }
}

export function hex(x: number, digits = 0): string {
  const s = u32(x).toString(16).toUpperCase();
  return '0x' + (digits ? s.padStart(digits, '0') : s);
}
