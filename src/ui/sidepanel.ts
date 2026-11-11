/** Боковая панель: листинг программы (со стадиями), регистры, память данных. */
import type { Trace, TraceStep } from '../core/types';
import { abiName } from '../isa/rv32i';
import { clear, h } from './dom';
import { fmtNum, instrColor, type NumFmt } from './format';

export class SidePanel {
  readonly el: HTMLElement;
  private listing = h('div', { class: 'sp-listing' });
  private regs = h('div', { class: 'sp-regs' });
  private mem = h('div', { class: 'sp-mem' });
  private note = h('div', { class: 'sp-note' });
  private rows: HTMLElement[] = [];
  private regEls: HTMLElement[] = [];

  constructor(extra?: HTMLElement) {
    for (let i = 0; i < 32; i++) {
      const v = h('span', { class: 'rv' });
      const cell = h('div', { class: 'reg', title: `x${i} (${abiName(i)})` }, h('span', { class: 'rn', text: `x${i}` }), v);
      this.regEls.push(cell);
      this.regs.append(cell);
    }
    this.el = h(
      'aside',
      { class: 'side' },
      h('div', { class: 'sp-prog' }, h('h3', { text: 'Программа' }), this.note, this.listing),
      extra ?? null,
      h('div', { class: 'sp-state' }, h('h3', { text: 'Регистры' }), this.regs, h('h3', { text: 'Память данных' }), this.mem),
    );
  }

  setTrace(trace: Trace, note?: string) {
    this.note.textContent = note ?? '';
    clear(this.listing);
    this.rows = trace.program.instrs.map((ins) => {
      const row = h(
        'div',
        { class: 'li' },
        h('span', { class: 'li-addr', text: fmtNum(ins.addr, 'hex', 2) }),
        h('span', { class: 'li-text', text: ins.text }),
        h('span', { class: 'li-st' }),
      );
      this.listing.append(row);
      return row;
    });
  }

  update(step: TraceStep | null, fmt: NumFmt) {
    // листинг: где сейчас каждая инструкция
    const where = new Map<number, { st: string; uid?: number }[]>();
    if (step) {
      for (const [st, slot] of Object.entries(step.stages)) {
        if (slot.idx === null || slot.status !== 'instr') continue;
        if (!where.has(slot.idx)) where.set(slot.idx, []);
        where.get(slot.idx)!.push({ st, uid: slot.uid });
      }
    }
    this.rows.forEach((row, i) => {
      const w = where.get(i);
      row.classList.toggle('cur', !!w);
      const stEl = row.querySelector('.li-st')!;
      clear(stEl);
      for (const x of w ?? []) {
        const tag = h('span', { class: 'li-tag', text: x.st === 'X' ? '●' : x.st });
        tag.style.background = instrColor(x.uid);
        stEl.append(tag);
      }
      if (w?.length === 1) row.style.setProperty('--ic', instrColor(w[0].uid));
    });
    const curRow = this.rows.find((r) => r.classList.contains('cur'));
    curRow?.scrollIntoView({ block: 'nearest' });

    const regs = step?.regs;
    this.regEls.forEach((cell, i) => {
      const v = regs ? regs[i] : 0;
      cell.querySelector('.rv')!.textContent = fmtNum(v, fmt);
      cell.classList.toggle('nz', v !== 0);
      cell.classList.toggle('chg', step?.changedReg === i);
    });

    clear(this.mem);
    const entries = Object.entries(step?.mem ?? {});
    if (!entries.length) this.mem.append(h('div', { class: 'sp-empty', text: 'нет обращений' }));
    for (const [a, v] of entries) {
      this.mem.append(
        h(
          'div',
          { class: `mem-row${step?.changedMem === Number(a) ? ' chg' : ''}` },
          h('span', { class: 'ma', text: `[${fmtNum(Number(a), 'hex', 4)}]` }),
          h('span', { class: 'mv', text: fmtNum(v, fmt) }),
        ),
      );
    }
  }
}
