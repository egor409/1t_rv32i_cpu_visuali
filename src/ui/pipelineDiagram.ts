/** Pipeline-диаграмма: инструкции × такты (как в книге, разд. 7.5). */
import type { Trace } from '../core/types';
import { clear, h } from './dom';
import { instrColor } from './format';

export class PipelineDiagram {
  readonly el: HTMLElement;
  private table = h('table', { class: 'pd-table' });
  private colEls: HTMLElement[][] = [];
  private cur = -1;

  constructor(private onSeekCycle: (cycle: number) => void) {
    this.el = h(
      'section',
      { class: 'pd' },
      h(
        'div',
        { class: 'pd-head' },
        h('h3', { text: 'Pipeline diagram' }),
        h('span', { class: 'pd-legend', html: '<i class="lg stall"></i> stall &nbsp; <i class="lg flush"></i> flush', title: 'Клик по такту — перейти к нему' }),
      ),
      h('div', { class: 'pd-scroll' }, this.table),
    );
  }

  setTrace(trace: Trace) {
    clear(this.table);
    this.colEls = [];
    this.cur = -1;
    const rows = trace.pipeline;
    this.el.classList.toggle('hidden-nodata', !rows);
    if (!rows) return;
    const n = trace.cycles;
    const head = h('tr', {}, h('th', { class: 'pd-ih', text: 'такт →' }));
    for (let c = 1; c <= n; c++) {
      const th = h('th', { class: 'pd-c', text: String(c), onclick: () => this.onSeekCycle(c) });
      head.append(th);
      this.colEls[c] = [th];
    }
    this.table.append(h('thead', {}, head));
    const body = h('tbody');
    for (const r of rows) {
      const tr = h('tr', {}, h('td', { class: 'pd-i' }, h('span', { class: 'pd-dot', style: `background:${instrColor(r.uid)}` }), r.text));
      for (let c = 1; c <= n; c++) {
        const cell = r.cells[c];
        const td = h('td', { class: `pd-c${cell ? ` s-${cell.stage}${cell.mark ? ' mk-' + cell.mark : ''}` : ''}`, text: cell?.stage ?? '', onclick: () => this.onSeekCycle(c) });
        if (cell) td.style.setProperty('--ic', instrColor(r.uid));
        if (cell?.mark) td.title = cell.mark === 'stall' ? 'stall: инструкция задержана на этой стадии' : 'flush: инструкция отменена в конце такта';
        tr.append(td);
        this.colEls[c].push(td);
      }
      body.append(tr);
    }
    this.table.append(body);
  }

  update(cycle: number) {
    if (cycle === this.cur) return;
    this.colEls[this.cur]?.forEach((e) => e.classList.remove('cur'));
    this.colEls[cycle]?.forEach((e) => e.classList.add('cur'));
    this.cur = cycle;
    this.colEls[cycle]?.[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
