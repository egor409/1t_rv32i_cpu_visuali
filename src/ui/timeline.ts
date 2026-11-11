/** Нижняя панель: кнопки воспроизведения, скорость и таймлайн с метками тактов/фаз. */
import type { MicroarchDef, Trace } from '../core/types';
import { clear, h } from './dom';

export interface PlayerHandlers {
  seek(step: number): void;
  step(delta: number): void;
  cycle(delta: number): void;
  togglePlay(): void;
  setSpeed(v: number): void;
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3, 5];

export class Player {
  readonly el: HTMLElement;
  private track = h('div', { class: 'tl-track' });
  private cells: HTMLElement[] = [];
  private cycleEls: HTMLElement[] = [];
  private pos = h('div', { class: 'pl-pos' });
  private playBtn: HTMLButtonElement;
  private speedLbl = h('span', { class: 'pl-speed-lbl', text: '1×' });
  private n = 0;

  constructor(private handlers: PlayerHandlers) {
    const btn = (label: string, title: string, fn: () => void, cls = '') => h('button', { class: `pl-btn ${cls}`, title, onclick: fn, text: label });
    this.playBtn = btn('▶', 'Воспроизведение / пауза (пробел)', () => handlers.togglePlay(), 'play');
    const speed = h('input', { type: 'range', min: 0, max: SPEEDS.length - 1, step: 1, value: 2, class: 'pl-speed', title: 'Скорость авто-воспроизведения' });
    speed.addEventListener('input', () => {
      const v = SPEEDS[Number(speed.value)];
      this.speedLbl.textContent = `${v}×`;
      handlers.setSpeed(v);
    });
    this.el = h(
      'footer',
      { class: 'player' },
      h(
        'div',
        { class: 'pl-buttons' },
        btn('⏮', 'В начало (Home)', () => handlers.seek(0)),
        btn('⏪', 'Предыдущий такт (Shift+←)', () => handlers.cycle(-1)),
        btn('◀', 'Шаг назад (←)', () => handlers.step(-1)),
        this.playBtn,
        btn('▶|', 'Шаг вперёд (→)', () => handlers.step(1), 'stepf'),
        btn('⏩', 'Следующий такт (Shift+→)', () => handlers.cycle(1)),
        btn('⏭', 'В конец (End)', () => handlers.seek(this.n - 1)),
      ),
      h('div', { class: 'pl-speedbox' }, h('span', { class: 'pl-cap', text: 'скорость' }), speed, this.speedLbl),
      h('div', { class: 'tl-wrap' }, this.track),
      this.pos,
    );
    this.initScrub();
  }

  setTrace(trace: Trace, def: MicroarchDef) {
    clear(this.track);
    this.cells = [];
    this.cycleEls = [];
    this.n = trace.steps.length;
    let cur: HTMLElement | null = null;
    let cells: HTMLElement | null = null;
    let lastCycle = -1;
    trace.steps.forEach((st, i) => {
      if (st.cycle !== lastCycle) {
        lastCycle = st.cycle;
        cells = h('div', { class: 'tl-cells' });
        cur = h('div', { class: 'tl-cycle' }, h('div', { class: 'tl-cnum', text: String(st.cycle) }), cells);
        this.track.append(cur);
        this.cycleEls.push(cur);
      }
      const ph = def.phases.find((p) => p.id === st.phase);
      const kinds = new Set(st.events.map((e) => e.kind));
      const mark = kinds.has('flush') ? 'flush' : kinds.has('stall') ? 'stall' : kinds.has('forward') ? 'forward' : '';
      const cell = h('div', { class: `tl-cell ph-${st.phase}${mark ? ' m-' + mark : ''}`, 'data-i': i, title: `${st.title}` }, h('span', { text: ph?.short ?? '' }));
      cells!.append(cell);
      this.cells.push(cell);
    });
    this.track.classList.toggle('dense', this.n > 90);
    this.track.classList.toggle('very-dense', this.n > 200);
  }

  update(idx: number, trace: Trace, playing: boolean) {
    this.cells.forEach((c, i) => {
      c.classList.toggle('past', i < idx);
      c.classList.toggle('cur', i === idx);
    });
    const st = trace.steps[idx];
    this.cycleEls.forEach((c, i) => c.classList.toggle('cur', !!st && i === st.cycle - 1));
    this.pos.textContent = st ? `шаг ${idx + 1} / ${this.n} · такт ${st.cycle} / ${trace.cycles}` : '—';
    this.playBtn.textContent = playing ? '⏸' : '▶';
    this.playBtn.classList.toggle('active', playing);
  }

  private initScrub() {
    const at = (ev: PointerEvent): number | null => {
      if (!this.cells.length) return null;
      // ближайшая по X ячейка
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < this.cells.length; i++) {
        const r = this.cells[i].getBoundingClientRect();
        const d = ev.clientX < r.left ? r.left - ev.clientX : ev.clientX > r.right ? ev.clientX - r.right : 0;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    };
    let down = false;
    this.track.addEventListener('pointerdown', (ev) => {
      down = true;
      this.track.setPointerCapture(ev.pointerId);
      const i = at(ev);
      if (i !== null) this.handlers.seek(i);
    });
    this.track.addEventListener('pointermove', (ev) => {
      if (!down) return;
      const i = at(ev);
      if (i !== null) this.handlers.seek(i);
    });
    const up = () => (down = false);
    this.track.addEventListener('pointerup', up);
    this.track.addEventListener('pointercancel', up);
  }
}
