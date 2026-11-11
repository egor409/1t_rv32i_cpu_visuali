/**
 * Мини-анимации и «внутренности» блоков для окна детализации (веха M2).
 * Каждая функция получает блок, его входы/выходы (выведены из проводов схемы) и текущий шаг
 * трассы; ничего не знает о конкретной микроархитектуре, кроме типа блока (BlockDef.anim).
 */
import { blockIO, type BlockIO } from '../core/geometry';
import type { BlockDef, MicroarchDef, SignalId, Trace, TraceStep } from '../core/types';
import { ALU_CTRL_NAME, IMM_SRC_NAME, OP, aluDecoder, mainDecoder, regName, u32 } from '../isa/rv32i';
import { h, s } from './dom';
import { fmtNum, fmtSignal, type NumFmt } from './format';

interface Ctx {
  b: BlockDef;
  io: BlockIO;
  allIO: Map<string, BlockIO>;
  step: TraceStep | null;
  trace: Trace;
  def: MicroarchDef;
  fmt: NumFmt;
  /** Сигнал, подключённый к порту блока. */
  sig(port: string, block?: string): SignalId | undefined;
  /** Числовое значение сигнала на порту (undefined — ещё не вычислено). */
  num(port: string, block?: string): number | undefined;
  /** Отформатированное значение сигнала. */
  val(signal: SignalId | undefined): string;
  name(signal: SignalId | undefined): string;
}

const ioCache = new WeakMap<MicroarchDef, Map<string, BlockIO>>();

export function renderAnim(b: BlockDef, io: BlockIO, step: TraceStep | null, trace: Trace, def: MicroarchDef, fmt: NumFmt): Element | null {
  if (!b.anim && b.type !== 'adder') return null;
  let allIO = ioCache.get(def);
  if (!allIO) ioCache.set(def, (allIO = blockIO(def)));
  const sigOf = (port: string, block = b.id) => {
    const x = allIO!.get(block);
    return (x?.inputs.find((p) => p.port === port) ?? x?.outputs.find((p) => p.port === port))?.signal;
  };
  const c: Ctx = {
    b, io, allIO, step, trace, def, fmt,
    sig: sigOf,
    num: (port, block) => {
      const sg = sigOf(port, block);
      return sg ? step?.values[sg] : undefined;
    },
    val: (sg) => (sg && step?.values[sg] !== undefined ? fmtSignal(sg, def.signals[sg], step.values[sg], fmt) : '?'),
    name: (sg) => (sg ? (def.signals[sg]?.label ?? sg) : '—'),
  };
  switch (b.anim ?? b.type) {
    case 'mux': return animMux(c);
    case 'pc': return animPC(c);
    case 'alu': return animALU(c);
    case 'adder': return animAdder(c);
    case 'regfile': return animRegFile(c);
    case 'control': return animControl(c);
    case 'hazard': return animHazard(c);
    case 'extend': return animExtend(c);
    case 'imem': return animIMem(c);
    case 'dmem': return animDMem(c);
    case 'pipereg': return animPipeReg(c);
    case 'pclogic': return animPCLogic(c);
    default: return null;
  }
}

/* ------------------------------------------------------------------ */
/*  SVG-помощники                                                     */
/* ------------------------------------------------------------------ */

const W = 336;
const svgBox = (hgt: number) => s('svg', { class: 'anim-svg', viewBox: `0 0 ${W} ${hgt}`, width: '100%' });
const line = (pts: string, cls = '') => s('polyline', { class: `a-wire ${cls}`, points: pts });
const text = (x: number, y: number, t: string, cls = '', anchor = 'start') => s('text', { class: `a-text ${cls}`, x, y, 'text-anchor': anchor, text: t });

/** Точка, бегущая по пути (SMIL). frac — доля цикла, за которую проходит путь. */
function dot(path: string, dur = 2.4, frac = 0.6, cls = ''): SVGCircleElement {
  const c = s('circle', { class: `a-dot ${cls}`, r: 4.5 });
  c.append(s('animateMotion', { path, dur: `${dur}s`, repeatCount: 'indefinite', keyPoints: '0;1;1', keyTimes: `0;${frac};1`, calcMode: 'linear' }));
  return c;
}

/** Анимация атрибута по ключевым кадрам. */
function anim(attr: string, values: string, keyTimes: string, dur: number) {
  return s('animate', { attributeName: attr, values, keyTimes, dur: `${dur}s`, repeatCount: 'indefinite', calcMode: 'discrete' });
}

const note = (t: string, cls = '') => h('div', { class: `a-note ${cls}`, text: t });
const wrap = (...children: (Node | null)[]) => {
  const d = h('div', { class: 'a-wrap' });
  for (const ch of children) if (ch) d.append(ch);
  return d;
};

/* ------------------------------------------------------------------ */
/*  Мультиплексор                                                     */
/* ------------------------------------------------------------------ */

function muxParts(c: Ctx, block = c.b.id) {
  const bdef = c.def.blocks.find((x) => x.id === block)!;
  const ins = bdef.ports.filter((p) => /^in\d$/.test(p.id)).map((p) => ({ label: p.label ?? p.id, signal: c.sig(p.id, block) }));
  const selSig = c.sig('sel', block);
  const sel = selSig ? c.step?.values[selSig] : undefined;
  return { ins, selSig, sel, outSig: c.sig('out', block) };
}

function animMux(c: Ctx): Element {
  const { ins, selSig, sel, outSig } = muxParts(c);
  const n = ins.length;
  const rowH = 34;
  const top = 34;
  const hgt = top + n * rowH + 12;
  const svg = svgBox(hgt);
  const mx = 170;
  const my0 = top - 6;
  const my1 = top + n * rowH - 8;
  const outY = (my0 + my1) / 2;
  svg.append(s('polygon', { class: 'a-shape', points: `${mx},${my0} ${mx + 26},${my0 + 14} ${mx + 26},${my1 - 14} ${mx},${my1}` }));
  ins.forEach((inp, i) => {
    const y = top + i * rowH + 8;
    const on = sel === i;
    svg.append(line(`8,${y} ${mx},${y}`, on ? 'on' : ''));
    svg.append(text(10, y - 5, `${c.name(inp.signal)}`, on ? 'on' : 'dim'));
    svg.append(text(mx - 6, y - 5, c.val(inp.signal), `mono ${on ? 'on' : 'dim'}`, 'end'));
    svg.append(text(mx + 5, y + 4, inp.label, 'tiny'));
    if (on) svg.append(dot(`M8,${y} L${mx},${y} L${mx + 26},${outY} L${W - 10},${outY}`));
  });
  svg.append(line(`${mx + 26},${outY} ${W - 10},${outY}`, sel !== undefined ? 'on' : ''));
  svg.append(text(mx + 34, outY - 6, c.name(outSig), 'on'));
  svg.append(text(mx + 34, outY + 15, c.val(outSig), 'mono on'));
  svg.append(line(`${mx + 13},6 ${mx + 13},${my0 + 7}`, 'ctl'));
  svg.append(text(mx + 19, 14, `${c.name(selSig)} = ${c.val(selSig)}`, 'ctl'));
  return wrap(
    svg,
    note(sel === undefined ? 'Селектор ещё не вычислен в этой фазе.' : `Селектор ${c.name(selSig)} = ${c.val(selSig)} пропускает на выход вход «${ins[sel]?.label ?? '?'}» (${c.name(ins[sel]?.signal)}).`),
  );
}

/* ------------------------------------------------------------------ */
/*  PC: мультиплексор + регистр + фронт CLK                           */
/* ------------------------------------------------------------------ */

function animPC(c: Ctx): Element {
  const dSig = c.sig('d');
  const qSig = c.sig('q');
  const enSig = c.sig('en');
  const cur = c.num('q');
  const next = c.num('d');
  const stall = enSig ? !!c.step?.values[enSig] : false;
  const m = muxParts(c, 'PCMux');
  const svg = svgBox(168);
  const DUR = 3.2;
  const EDGE = 0.55; // момент фронта (доля цикла)

  // мультиплексор
  const ys = [44, 84];
  svg.append(s('polygon', { class: 'a-shape', points: '96,30 116,42 116,86 96,98' }));
  m.ins.forEach((inp, i) => {
    const on = m.sel === i;
    svg.append(line(`6,${ys[i]} 96,${ys[i]}`, on ? 'on' : ''));
    svg.append(text(6, ys[i] - 5, c.name(inp.signal), on ? 'on' : 'dim'));
    svg.append(text(6, ys[i] + 13, c.val(inp.signal), `mono ${on ? 'on' : 'dim'}`));
    svg.append(text(100, ys[i] + 4, inp.label, 'tiny'));
  });
  svg.append(line('106,8 106,36', 'ctl'));
  svg.append(text(112, 16, `${c.name(m.selSig)} = ${c.val(m.selSig)}`, 'ctl'));
  // регистр
  svg.append(line('116,64 176,64', next !== undefined ? 'on' : ''));
  svg.append(text(146, 58, c.name(dSig), 'on', 'middle'));
  svg.append(text(146, 79, c.val(dSig), 'mono on', 'middle'));
  const reg = s('rect', { class: 'a-shape', x: 176, y: 36, width: 50, height: 56, rx: 4 });
  svg.append(reg);
  svg.append(text(201, 62, 'PC', 'bold', 'middle'));
  svg.append(s('polyline', { class: 'a-clk', points: '192,92 201,82 210,92' }));
  if (enSig) svg.append(text(201, 76, `EN=${stall ? 0 : 1}`, stall ? 'bad tiny' : 'tiny', 'middle'));
  svg.append(line(`226,64 ${W - 6},64`, 'on'));
  svg.append(text(232, 58, c.name(qSig), 'on'));

  const canLatch = next !== undefined && !stall;
  const qOld = text(232, 80, cur !== undefined ? fmtNum(cur, c.fmt) : '?', 'mono on');
  svg.append(qOld);
  if (canLatch) {
    const qNew = text(232, 80, fmtNum(next!, c.fmt), 'mono ok');
    qNew.setAttribute('opacity', '0');
    qOld.append(anim('opacity', '1;0;0', `0;${EDGE};1`, DUR));
    qNew.append(anim('opacity', '0;1;1', `0;${EDGE};1`, DUR));
    svg.append(qNew);
    const flash = s('rect', { class: 'a-flash', x: 176, y: 36, width: 50, height: 56, rx: 4, opacity: 0 });
    flash.append(anim('opacity', '0;0.7;0.35;0', `0;${EDGE};${EDGE + 0.12};${EDGE + 0.3}`, DUR));
    svg.append(flash);
    if (m.sel !== undefined) svg.append(dot(`M6,${ys[m.sel]} L96,${ys[m.sel]} L116,64 L176,64`, DUR, EDGE - 0.08));
  }
  // CLK
  const x0 = 30;
  const x1 = W - 10;
  const xe = x0 + (x1 - x0) * EDGE;
  svg.append(text(4, 148, 'CLK', 'tiny'));
  svg.append(s('polyline', { class: 'a-clkwave', points: `${x0},150 ${xe},150 ${xe},128 ${x1},128` }));
  const marker = s('line', { class: 'a-marker', x1: x0, x2: x0, y1: 120, y2: 158 });
  const mv = `${x0};${x1}`;
  marker.append(
    s('animate', { attributeName: 'x1', values: mv, dur: `${DUR}s`, repeatCount: 'indefinite' }),
    s('animate', { attributeName: 'x2', values: mv, dur: `${DUR}s`, repeatCount: 'indefinite' }),
  );
  svg.append(marker);
  svg.append(text(xe + 4, 124, 'фронт ↑', 'tiny ok'));

  let msg: string;
  if (stall) msg = `EN = 0 (${c.name(enSig)} = 1): по фронту CLK регистр не обновляется — PC удерживает ${c.val(qSig)}.`;
  else if (next === undefined) msg = `${c.name(dSig)} ещё не вычислен в этой фазе: сначала должен определиться ${c.name(m.selSig)}.`;
  else msg = `Мультиплексор выбирает ${c.name(m.ins[m.sel ?? 0]?.signal)} (${c.name(m.selSig)} = ${c.val(m.selSig)}); по фронту CLK регистр защёлкивает ${c.name(dSig)}: PC ${c.val(qSig)} → ${fmtNum(next, c.fmt)}.`;
  return wrap(svg, note(msg));
}

/* ------------------------------------------------------------------ */
/*  АЛУ и сумматоры                                                   */
/* ------------------------------------------------------------------ */

const ALU_SYM: Record<number, string> = { 0: '+', 1: '−', 2: '&', 3: '|', 5: '<' };

function aluSvg(c: Ctx, aSig: SignalId | undefined, bSig: SignalId | undefined, ySig: SignalId | undefined, sym: string, extra?: (svg: SVGSVGElement) => void): SVGSVGElement {
  const svg = svgBox(132);
  const ready = ySig !== undefined && c.step?.values[ySig] !== undefined;
  svg.append(s('polygon', { class: 'a-shape', points: '130,10 200,38 200,94 130,122 130,78 146,66 130,54' }));
  svg.append(line('8,32 130,32', 'on'), line('8,100 130,100', 'on'), line(`200,66 ${W - 8},66`, ready ? 'on' : ''));
  svg.append(text(10, 26, c.name(aSig), 'on'), text(124, 26, c.val(aSig), 'mono on', 'end'));
  svg.append(text(10, 94, c.name(bSig), 'on'), text(124, 94, c.val(bSig), 'mono on', 'end'));
  svg.append(text(170, 74, sym, 'big', 'middle'));
  svg.append(text(208, 60, c.name(ySig), 'on'), text(208, 82, c.val(ySig), 'mono on'));
  if (ready) {
    svg.append(dot('M8,32 L130,32 L165,66 L200,66 L328,66', 2.4, 0.7));
    svg.append(dot('M8,100 L130,100 L165,66 L200,66 L328,66', 2.4, 0.7));
  }
  extra?.(svg);
  return svg;
}

function animALU(c: Ctx): Element {
  const ctlSig = c.sig('ctl');
  const ctl = c.num('ctl');
  const zSig = c.sig('zero');
  const svg = aluSvg(c, c.sig('a'), c.sig('b'), c.sig('y'), ctl !== undefined ? (ALU_SYM[ctl] ?? '?') : '?', (g) => {
    g.append(line('165,4 165,24', 'ctl'));
    g.append(text(171, 12, `${c.name(ctlSig)} = ${c.val(ctlSig)}`, 'ctl'));
    g.append(text(208, 106, `${c.name(zSig)} = ${c.val(zSig)}`, 'ctl'));
  });
  const tbl = h('table', { class: 'a-table' });
  tbl.append(h('tr', {}, h('th', { text: 'ALUControl' }), h('th', { text: 'операция' })));
  for (const [code, nm] of Object.entries(ALU_CTRL_NAME)) {
    tbl.append(
      h('tr', { class: Number(code) === ctl ? 'cur' : '' }, h('td', { text: Number(code).toString(2).padStart(3, '0') }), h('td', { text: `${nm}  (A ${ALU_SYM[Number(code)]} B)` })),
    );
  }
  return wrap(svg, tbl, note('Zero = 1, когда результат равен нулю — так beq сравнивает регистры (вычитанием).'));
}

function animAdder(c: Ctx): Element {
  return wrap(aluSvg(c, c.sig('a'), c.sig('b'), c.sig('y'), '+'));
}

/* ------------------------------------------------------------------ */
/*  Регистровый файл                                                  */
/* ------------------------------------------------------------------ */

function animRegFile(c: Ctx): Element {
  const a1 = c.num('A1');
  const a2 = c.num('A2');
  const a3 = c.num('A3');
  const we = c.num('WE3');
  const active = new Set(c.step?.active ?? []);
  const rd1On = a1 !== undefined && active.has(c.sig('RD1') ?? '');
  const rd2On = a2 !== undefined && active.has(c.sig('RD2') ?? '');
  const wrOn = !!we && a3 !== undefined && a3 !== 0;
  const grid = h('div', { class: 'a-regs' });
  const regs = c.step?.regs ?? [];
  for (let i = 0; i < 32; i++) {
    const cls = ['a-reg'];
    if (rd1On && a1 === i) cls.push('r1');
    if (rd2On && a2 === i) cls.push('r2');
    if (wrOn && a3 === i) cls.push('wr');
    grid.append(h('div', { class: cls.join(' ') }, h('span', { text: `x${i}` }), h('b', { text: fmtNum(regs[i] ?? 0, c.fmt) })));
  }
  const lines: string[] = [];
  if (rd1On) lines.push(`Чтение 1: A1 = ${regName(a1!)} → RD1 = ${c.val(c.sig('RD1'))}`);
  if (rd2On) lines.push(`Чтение 2: A2 = ${regName(a2!)} → RD2 = ${c.val(c.sig('RD2'))}`);
  if (we === undefined) lines.push('WE3 ещё не определён в этой фазе.');
  else if (wrOn) lines.push(`Запись: WE3 = 1 → ${regName(a3!)} ← WD3 = ${c.val(c.sig('WD3'))} ${c.def.stages ? '(в первой половине такта)' : '(по фронту CLK)'}`);
  else if (we && a3 === 0) lines.push('WE3 = 1, но A3 = x0 — запись игнорируется.');
  else lines.push('WE3 = 0 — запись запрещена.');
  const legend = h('div', { class: 'a-legend', html: '<i class="r1"></i> чтение A1 &nbsp; <i class="r2"></i> чтение A2 &nbsp; <i class="wr"></i> запись A3' });
  return wrap(grid, legend, ...lines.map((l) => note(l)));
}

/* ------------------------------------------------------------------ */
/*  Control Unit                                                      */
/* ------------------------------------------------------------------ */

const DEC_ROWS: [string, number][] = [
  ['lw', OP.LW], ['sw', OP.SW], ['R-type', OP.R], ['beq', OP.BEQ], ['I-type ALU', OP.I], ['jal', OP.JAL],
];

function animControl(c: Ctx): Element {
  const op = c.num('op');
  const f3 = c.num('funct3');
  const f7 = c.num('funct7b5');
  const tbl = h('table', { class: 'a-table dec' });
  const cols = ['RegWrite', 'ImmSrc', 'ALUSrc', 'MemWrite', 'ResultSrc', 'Branch', 'ALUOp', 'Jump'] as const;
  const short = ['RegW', 'ImmSrc', 'ALUSrc', 'MemW', 'ResSrc', 'Br', 'ALUOp', 'Jmp'];
  tbl.append(h('tr', {}, h('th', { text: 'инстр.' }), h('th', { text: 'op' }), ...short.map((x) => h('th', { text: x }))));
  for (const [nm, code] of DEC_ROWS) {
    const m = mainDecoder(code);
    const tr = h('tr', { class: code === op ? 'cur' : '' }, h('td', { text: nm }), h('td', { text: code.toString(2).padStart(7, '0') }));
    for (const k of cols) {
      const wdt = k === 'ImmSrc' || k === 'ResultSrc' || k === 'ALUOp' ? 2 : 1;
      tr.append(h('td', { text: m[k].toString(2).padStart(wdt, '0') }));
    }
    tbl.append(tr);
  }
  const out: (Node | null)[] = [h('div', { class: 'a-cap', text: 'Main Decoder (по полю op)' }), tbl];
  if (op === undefined) out.push(note('op ещё не поступил (инструкция выбирается).'));
  else {
    const known = DEC_ROWS.some(([, code]) => code === op);
    if (!known) out.push(note('В стадии нет инструкции (пузырь): все управляющие сигналы равны 0.'));
    else {
      const m = mainDecoder(op);
      const ac = aluDecoder(m.ALUOp, f3 ?? 0, (op >> 5) & 1, f7 ?? 0);
      const how =
        m.ALUOp === 0 ? 'ALUOp = 00 → сложение (адрес)' : m.ALUOp === 1 ? 'ALUOp = 01 → вычитание (сравнение)' : `ALUOp = 10 → смотрим funct3 = ${(f3 ?? 0).toString(2).padStart(3, '0')}, op[5] = ${(op >> 5) & 1}, funct7[5] = ${f7 ?? 0}`;
      out.push(h('div', { class: 'a-cap', text: 'ALU Decoder' }), note(`${how} → ALUControl = ${ac.toString(2).padStart(3, '0')} (${ALU_CTRL_NAME[ac]}).`));
    }
  }
  const pcsrc = c.sig('PCSrc');
  if (pcsrc) out.push(note(`PCSrc = Branch & Zero | Jump = ${c.val(pcsrc)}  (Zero = ${c.val(c.sig('Zero'))}).`));
  out.push(note('Ячейки «x» (don\'t care) из таблицы книги показаны нулями.', 'dim'));
  return wrap(...out);
}

/* ------------------------------------------------------------------ */
/*  Hazard Unit и логика PCSrc                                        */
/* ------------------------------------------------------------------ */

function term(textStr: string, truth: boolean | undefined): HTMLElement {
  return h('span', { class: `a-term ${truth === undefined ? '' : truth ? 't' : 'f'}`, text: textStr });
}

function animHazard(c: Ctx): Element {
  const v = c.step?.values ?? {};
  const R = (x: number | undefined) => (x === undefined ? '?' : regName(x));
  const eqRow = (title: string, parts: (Node | string)[], result: string) => {
    const d = h('div', { class: 'a-eq' }, h('b', { text: title }));
    for (const p of parts) d.append(p);
    d.append(h('span', { class: 'a-res', text: ` → ${result}` }));
    return d;
  };
  const fwd = (which: 'A' | 'B') => {
    const rs = v[which === 'A' ? 'Rs1E' : 'Rs2E'];
    const nm = which === 'A' ? 'Rs1E' : 'Rs2E';
    const out = v[`Forward${which}E`];
    const mHit = rs === v.RdM && !!v.RegWriteM && rs !== 0;
    const wHit = rs === v.RdW && !!v.RegWriteW && rs !== 0;
    return h(
      'div',
      { class: 'a-block' },
      eqRow(`Forward${which}E: `, [
        term(`${nm}=${R(rs)} == RdM=${R(v.RdM)}`, rs === v.RdM),
        ' & ',
        term(`RegWriteM=${v.RegWriteM ?? '?'}`, !!v.RegWriteM),
        ' & ',
        term(`${nm}≠x0`, rs !== 0),
      ], mHit ? '10 (из Memory)' : 'нет'),
      eqRow('иначе: ', [
        term(`${nm}=${R(rs)} == RdW=${R(v.RdW)}`, rs === v.RdW),
        ' & ',
        term(`RegWriteW=${v.RegWriteW ?? '?'}`, !!v.RegWriteW),
        ' & ',
        term(`${nm}≠x0`, rs !== 0),
      ], !mHit && wHit ? '01 (из Writeback)' : mHit ? '—' : 'нет'),
      h('div', { class: 'a-out', text: `Forward${which}E = ${(out ?? 0).toString(2).padStart(2, '0')}` }),
    );
  };
  const lw = !!v.ResultSrcE0 && (v.Rs1D === v.RdE || v.Rs2D === v.RdE);
  const stall = h(
    'div',
    { class: 'a-block' },
    eqRow('lwStall: ', [
      term(`ResultSrcE[0]=${v.ResultSrcE0 ?? '?'}`, !!v.ResultSrcE0),
      ' & ( ',
      term(`Rs1D=${R(v.Rs1D)} == RdE=${R(v.RdE)}`, v.Rs1D === v.RdE),
      ' | ',
      term(`Rs2D=${R(v.Rs2D)} == RdE=${R(v.RdE)}`, v.Rs2D === v.RdE),
      ' )',
    ], lw ? '1' : '0'),
    h('div', { class: 'a-out', text: `StallF = StallD = ${v.StallF ?? '?'}` }),
  );
  const flush = h(
    'div',
    { class: 'a-block' },
    eqRow('FlushD = ', [term(`PCSrcE=${v.PCSrcE ?? '?'}`, !!v.PCSrcE)], String(v.FlushD ?? '?')),
    eqRow('FlushE = ', [term(`lwStall=${lw ? 1 : 0}`, lw), ' | ', term(`PCSrcE=${v.PCSrcE ?? '?'}`, !!v.PCSrcE)], String(v.FlushE ?? '?')),
  );
  return wrap(
    h('div', { class: 'a-cap', text: 'Пересылка (forwarding)' }),
    fwd('A'),
    fwd('B'),
    h('div', { class: 'a-cap', text: 'Задержка (stall) из-за lw' }),
    stall,
    h('div', { class: 'a-cap', text: 'Сброс (flush) при переходе' }),
    flush,
    h('div', { class: 'a-legend', html: '<i class="t"></i> условие истинно &nbsp; <i class="f"></i> ложно' }),
  );
}

function animPCLogic(c: Ctx): Element {
  const v = c.step?.values ?? {};
  const d = h('div', { class: 'a-eq' }, h('b', { text: 'PCSrcE = ' }));
  d.append('( ', term(`BranchE=${v.BranchE ?? '?'}`, !!v.BranchE), ' & ', term(`ZeroE=${v.ZeroE ?? '?'}`, !!v.ZeroE), ' ) | ', term(`JumpE=${v.JumpE ?? '?'}`, !!v.JumpE));
  d.append(h('span', { class: 'a-res', text: ` → ${v.PCSrcE ?? '?'}` }));
  return wrap(
    h('div', { class: 'a-block' }, d),
    note(v.PCSrcE ? 'Переход выполняется: PCF ← PCTargetE, а инструкции в Fetch и Decode будут отменены (flush).' : 'Перехода нет: конвейер продолжает выборку по PC + 4.'),
  );
}

/* ------------------------------------------------------------------ */
/*  Extend                                                            */
/* ------------------------------------------------------------------ */

const FIELDS: [string, number, number][] = [
  ['31:25', 31, 25], ['24:20', 24, 20], ['19:15', 19, 15], ['14:12', 14, 12], ['11:7', 11, 7], ['6:0', 6, 0],
];
// какие поля инструкции образуют константу для каждого ImmSrc
const IMM_FIELDS: Record<number, string[]> = { 0: ['31:25', '24:20'], 1: ['31:25', '11:7'], 2: ['31:25', '11:7'], 3: ['31:25', '24:20', '19:15', '14:12'] };
const IMM_FORMULA = [
  '{{20{Instr[31]}}, Instr[31:20]}',
  '{{20{Instr[31]}}, Instr[31:25], Instr[11:7]}',
  '{{20{Instr[31]}}, Instr[7], Instr[30:25], Instr[11:8], 1\'b0}',
  '{{12{Instr[31]}}, Instr[19:12], Instr[20], Instr[30:21], 1\'b0}',
];

function animExtend(c: Ctx): Element {
  const immSrc = c.num('ImmSrc');
  const inSig = c.sig('in');
  const raw = inSig ? c.step?.values[inSig] : undefined; // Instr[31:7]
  const instr = raw !== undefined ? u32(raw << 7) : undefined;
  const row = h('div', { class: 'a-bits' });
  for (const [nm, hi, lo] of FIELDS) {
    const used = immSrc !== undefined && IMM_FIELDS[immSrc]?.includes(nm);
    const bits = instr === undefined || nm === '6:0' ? '·'.repeat(hi - lo + 1) : ((instr >>> lo) & ((1 << (hi - lo + 1)) - 1)).toString(2).padStart(hi - lo + 1, '0');
    row.append(h('div', { class: `a-field${used ? ' used' : ''}${nm === '6:0' ? ' op' : ''}` }, h('small', { text: nm }), h('code', { text: bits })));
  }
  const out = c.sig('out');
  return wrap(
    h('div', { class: 'a-cap', text: 'Биты инструкции → константа' }),
    row,
    immSrc === undefined
      ? note('ImmSrc ещё не определён.')
      : note(`ImmSrc = ${immSrc.toString(2).padStart(2, '0')} (${IMM_SRC_NAME[immSrc]}):  ImmExt = ${IMM_FORMULA[immSrc]}`),
    note(`${c.name(out)} = ${c.val(out)}${out && c.step?.values[out] !== undefined ? `  (${fmtNum(c.step.values[out], c.fmt === 'hex' ? 'dec' : 'hex')})` : ''}`, 'res'),
    note('Старший бит Instr[31] всегда знаковый — он размножается в старшие разряды.', 'dim'),
  );
}

/* ------------------------------------------------------------------ */
/*  Памяти                                                            */
/* ------------------------------------------------------------------ */

function animIMem(c: Ctx): Element {
  const a = c.num('A');
  const list = h('div', { class: 'a-mem' });
  for (const ins of c.trace.program.instrs) {
    const cur = ins.addr === a;
    list.append(
      h('div', { class: `a-mrow${cur ? ' cur' : ''}` }, h('span', { class: 'ptr', text: cur ? '▶' : '' }), h('span', { class: 'ad', text: fmtNum(ins.addr, 'hex', 2) }), h('code', { text: fmtNum(ins.word, 'hex', 8) }), h('span', { class: 'tx', text: ins.text })),
    );
  }
  const inProg = c.trace.program.instrs.some((i) => i.addr === a);
  return wrap(
    list,
    note(a === undefined ? 'Адрес ещё не подан.' : inProg ? `A = ${c.val(c.sig('A'))} → RD = ${c.val(c.sig('RD'))} (чтение комбинационное, без CLK).` : `A = ${c.val(c.sig('A'))} — за пределами программы, выдаётся 0 (пусто).`),
  );
}

function animDMem(c: Ctx): Element {
  const a = c.num('A');
  const we = c.num('WE');
  const active = new Set(c.step?.active ?? []);
  const reading = active.has(c.sig('RD') ?? '');
  const writing = !!we && active.has(c.sig('WD') ?? '');
  const addr = a !== undefined ? u32(a) & ~3 : undefined;
  const list = h('div', { class: 'a-mem' });
  const mem = c.step?.mem ?? {};
  const entries = Object.entries(mem);
  if (!entries.length) list.append(h('div', { class: 'a-mrow', text: 'память пока не использовалась' }));
  for (const [ad, val] of entries) {
    const cur = (reading || writing) && Number(ad) === addr;
    list.append(
      h('div', { class: `a-mrow${cur ? (writing ? ' wr' : ' cur') : ''}` }, h('span', { class: 'ptr', text: cur ? (writing ? '✎' : '▶') : '' }), h('span', { class: 'ad', text: `[${fmtNum(Number(ad), 'hex', 4)}]` }), h('code', { text: fmtNum(val, c.fmt) })),
    );
  }
  let msg: string;
  if (we === undefined) msg = 'Адрес и WE ещё не определены в этой фазе.';
  else if (writing) msg = `WE = 1: по фронту CLK  Mem[${c.val(c.sig('A'))}] ← WD = ${c.val(c.sig('WD'))}.`;
  else if (reading) msg = `Чтение: RD = Mem[${c.val(c.sig('A'))}] = ${c.val(c.sig('RD'))} (комбинационно).`;
  else msg = 'Память не используется этой инструкцией (WE = 0, выход RD не выбран).';
  return wrap(list, note(msg));
}

/* ------------------------------------------------------------------ */
/*  Регистр стадий конвейера                                          */
/* ------------------------------------------------------------------ */

function animPipeReg(c: Ctx): Element {
  const st = c.step;
  const id = c.b.id;
  const flushed = st?.flushed?.includes(id);
  const stalled = st?.stalled?.includes(id);
  const enSig = c.sig('en');
  const clrSig = c.sig('clr');
  const en = enSig ? st?.values[enSig] : undefined;
  const clr = clrSig ? st?.values[clrSig] : undefined;
  const willStall = !!en; // сигнал Stall = 1 → EN = 0
  const willFlush = !!clr;
  const tbl = h('table', { class: 'a-table pr' });
  tbl.append(h('tr', {}, h('th', { text: 'вход (D)' }), h('th', { text: '' }), h('th', { text: '' }), h('th', { text: 'выход (Q)' }), h('th', { text: '' })));
  const names = [...new Set(c.b.ports.filter((p) => p.id.endsWith('_i')).map((p) => p.id.slice(0, -2)))];
  for (const n of names) {
    const i = c.sig(`${n}_i`);
    const o = c.sig(`${n}_o`);
    if (!i && !o) continue;
    tbl.append(
      h('tr', {}, h('td', { text: c.name(i) }), h('td', { class: 'v', text: c.val(i) }), h('td', { class: 'arr', text: willFlush ? '✕' : willStall ? '‖' : '→' }), h('td', { text: c.name(o) }), h('td', { class: 'v', text: c.val(o) })),
    );
  }
  let msg = 'По фронту CLK значения со входов переписываются на выходы: инструкция переходит на следующую стадию.';
  let cls = 'ok';
  if (willFlush) {
    msg = `${c.name(clrSig)} = 1 → CLR: по фронту в регистр запишутся нули (пузырь, nop).`;
    cls = 'bad';
  } else if (willStall) {
    msg = `${c.name(enSig)} = 1 → EN = 0: регистр удерживает текущее содержимое (инструкция остаётся на стадии).`;
    cls = 'warn';
  }
  const state = st?.phase === 'edge' ? (flushed ? 'сейчас: сброс' : stalled ? 'сейчас: удержание' : 'сейчас: запись') : '';
  return wrap(tbl, note(msg, cls), state ? note(state, 'dim') : null);
}
