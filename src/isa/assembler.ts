/**
 * Мини-ассемблер для поддерживаемого подмножества.
 *
 * Синтаксис:
 *   label:  add x1, x2, x3     # комментарий (также // и ;)
 *   lw  x6, -4(x9)
 *   sw  x6, 8(x9)
 *   addi x1, x0, 5      (также andi, ori, slti)
 *   beq x1, x2, label   (или числовое смещение в байтах)
 *   jal x1, label       (jal label  ==  jal x1, label)
 *   nop                 (= addi x0, x0, 0)
 *   j label             (= jal x0, label)
 * Директивы начального состояния (не занимают память команд):
 *   .reg x9, 0x2004         — начальное значение регистра
 *   .word 0x2000, 10        — слово в памяти данных
 */
import type { AsmInstr, Program } from '../core/types';
import { OP, parseReg, u32 } from './rv32i';

export class AsmError extends Error {
  constructor(public line: number, msg: string) {
    super(`строка ${line}: ${msg}`);
  }
}

const R_FUNCT: Record<string, [number, number]> = {
  add: [0b000, 0b0000000],
  sub: [0b000, 0b0100000],
  slt: [0b010, 0b0000000],
  or: [0b110, 0b0000000],
  and: [0b111, 0b0000000],
};
const I_FUNCT: Record<string, number> = { addi: 0b000, slti: 0b010, ori: 0b110, andi: 0b111 };

export const SUPPORTED = ['lw', 'sw', 'add', 'sub', 'and', 'or', 'slt', 'addi', 'andi', 'ori', 'slti', 'beq', 'jal', 'nop', 'j'];

function parseNum(s: string, line: number): number {
  s = s.trim();
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  let v: number;
  if (/^0x[0-9a-f]+$/i.test(body)) v = parseInt(body.slice(2), 16);
  else if (/^0b[01]+$/i.test(body)) v = parseInt(body.slice(2), 2);
  else if (/^[0-9]+$/.test(body)) v = parseInt(body, 10);
  else throw new AsmError(line, `ожидалось число, получено "${s}"`);
  return neg ? -v : v;
}

function reg(s: string | undefined, line: number): number {
  if (s === undefined) throw new AsmError(line, 'не хватает операнда-регистра');
  const r = parseReg(s);
  if (r === null) throw new AsmError(line, `неизвестный регистр "${s}"`);
  return r;
}

function checkRange(v: number, bits: number, line: number, what: string) {
  const min = -(2 ** (bits - 1));
  const max = 2 ** (bits - 1) - 1;
  if (v < min || v > max) throw new AsmError(line, `${what} ${v} не помещается в ${bits} бит`);
}

const encR = (f7: number, rs2: number, rs1: number, f3: number, rd: number, op: number) =>
  u32((f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op);
const encI = (imm: number, rs1: number, f3: number, rd: number, op: number) =>
  u32(((imm & 0xfff) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op);
const encS = (imm: number, rs2: number, rs1: number, f3: number, op: number) =>
  u32((((imm >> 5) & 0x7f) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | ((imm & 0x1f) << 7) | op);
const encB = (imm: number, rs2: number, rs1: number, f3: number, op: number) =>
  u32(
    (((imm >> 12) & 1) << 31) |
      (((imm >> 5) & 0x3f) << 25) |
      (rs2 << 20) |
      (rs1 << 15) |
      (f3 << 12) |
      (((imm >> 1) & 0xf) << 8) |
      (((imm >> 11) & 1) << 7) |
      op,
  );
const encJ = (imm: number, rd: number, op: number) =>
  u32(
    (((imm >> 20) & 1) << 31) |
      (((imm >> 1) & 0x3ff) << 21) |
      (((imm >> 11) & 1) << 20) |
      (((imm >> 12) & 0xff) << 12) |
      (rd << 7) |
      op,
  );

interface Line {
  line: number;
  mnem: string;
  args: string[];
  text: string;
  addr: number;
}

export function assemble(source: string, name = 'program'): Program {
  const labels = new Map<string, number>();
  const lines: Line[] = [];
  const initRegs: Record<number, number> = {};
  const initMem: Record<number, number> = {};
  let addr = 0;

  source.split(/\r?\n/).forEach((raw, i) => {
    const ln = i + 1;
    let s = raw.replace(/(#|\/\/|;).*$/, '').trim();
    // метки (может быть несколько)
    for (;;) {
      const m = /^([A-Za-z_.][\w.]*)\s*:\s*/.exec(s);
      if (!m) break;
      if (labels.has(m[1])) throw new AsmError(ln, `метка "${m[1]}" уже определена`);
      labels.set(m[1], addr);
      s = s.slice(m[0].length);
    }
    if (!s) return;
    const sp = s.search(/\s/);
    const mnem = (sp < 0 ? s : s.slice(0, sp)).toLowerCase();
    const rest = sp < 0 ? '' : s.slice(sp + 1);
    const args = rest
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a.length > 0);

    if (mnem === '.reg') {
      if (args.length !== 2) throw new AsmError(ln, '.reg ожидает: .reg xN, значение');
      initRegs[reg(args[0], ln)] = u32(parseNum(args[1], ln));
      return;
    }
    if (mnem === '.word') {
      if (args.length !== 2) throw new AsmError(ln, '.word ожидает: .word адрес, значение');
      const a = parseNum(args[0], ln);
      if (a % 4) throw new AsmError(ln, 'адрес .word должен быть кратен 4');
      initMem[u32(a)] = u32(parseNum(args[1], ln));
      return;
    }
    if (!SUPPORTED.includes(mnem)) {
      throw new AsmError(ln, `инструкция "${mnem}" не поддерживается (доступны: ${SUPPORTED.join(', ')})`);
    }
    lines.push({ line: ln, mnem, args, text: s.replace(/\s+/g, ' '), addr });
    addr += 4;
  });

  const target = (s: string, pc: number, ln: number): number => {
    if (labels.has(s)) return labels.get(s)! - pc;
    return parseNum(s, ln);
  };

  const instrs: AsmInstr[] = lines.map((L, idx) => {
    const { mnem, args, line: ln } = L;
    const need = (n: number) => {
      if (args.length !== n) throw new AsmError(ln, `${mnem} ожидает ${n} операнд(а), получено ${args.length}`);
    };
    let word: number;
    if (mnem in R_FUNCT) {
      need(3);
      const [f3, f7] = R_FUNCT[mnem];
      word = encR(f7, reg(args[2], ln), reg(args[1], ln), f3, reg(args[0], ln), OP.R);
    } else if (mnem in I_FUNCT) {
      need(3);
      const imm = parseNum(args[2], ln);
      checkRange(imm, 12, ln, 'константа');
      word = encI(imm, reg(args[1], ln), I_FUNCT[mnem], reg(args[0], ln), OP.I);
    } else if (mnem === 'nop') {
      need(0);
      word = encI(0, 0, 0, 0, OP.I);
    } else if (mnem === 'lw' || mnem === 'sw') {
      need(2);
      const m = /^(-?[\w]+)?\s*\(\s*(\w+)\s*\)$/.exec(args[1]);
      if (!m) throw new AsmError(ln, `ожидалось смещение(регистр), получено "${args[1]}"`);
      const imm = m[1] ? parseNum(m[1], ln) : 0;
      checkRange(imm, 12, ln, 'смещение');
      const base = reg(m[2], ln);
      word = mnem === 'lw' ? encI(imm, base, 0b010, reg(args[0], ln), OP.LW) : encS(imm, reg(args[0], ln), base, 0b010, OP.SW);
    } else if (mnem === 'beq') {
      need(3);
      const off = target(args[2], L.addr, ln);
      if (off % 2) throw new AsmError(ln, 'смещение ветвления должно быть чётным');
      checkRange(off, 13, ln, 'смещение');
      word = encB(off, reg(args[1], ln), reg(args[0], ln), 0b000, OP.BEQ);
    } else if (mnem === 'jal' || mnem === 'j') {
      let rd: number;
      let t: string;
      if (mnem === 'j') {
        need(1);
        rd = 0;
        t = args[0];
      } else if (args.length === 1) {
        rd = 1;
        t = args[0];
      } else {
        need(2);
        rd = reg(args[0], ln);
        t = args[1];
      }
      const off = target(t, L.addr, ln);
      if (off % 2) throw new AsmError(ln, 'смещение перехода должно быть чётным');
      checkRange(off, 21, ln, 'смещение');
      word = encJ(off, rd, OP.JAL);
    } else {
      throw new AsmError(ln, `не реализовано: ${mnem}`);
    }
    return { idx, addr: L.addr, word, text: L.text, line: ln };
  });

  if (instrs.length === 0) throw new AsmError(1, 'программа пуста');
  return { name, source, instrs, initRegs, initMem };
}
