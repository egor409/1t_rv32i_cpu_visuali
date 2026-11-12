/**
 * Экран «Просто»: упрощённое объяснение 5-стадийного конвейера.
 * Принцип тот же, что у подробной версии: декларативная схема (MicroarchDef) + трасса (Trace),
 * экран только проигрывает трассу. Отличается подачей: минимум текста, команды — цветные «жетоны»,
 * которые на каждый тик переезжают на следующую станцию.
 */
import './kid.css';
import { SIMPLE_PROGRAM, buildSimpleDef, simplePipelined } from '../../arch/riscv-pipelined-simple';
import { blockMap, wirePoints } from '../../core/geometry';
import type { MicroarchDef, Trace, TraceStep } from '../../core/types';
import { assemble } from '../../isa/assembler';
import { fields, s32, usage, classify } from '../../isa/rv32i';
import { clear, h, s } from '../dom';

const COLORS = ['#FF6B6B', '#3A86FF', '#2DB84D', '#B565F5', '#FF9F1C', '#00B4D8', '#F15BB5'];
const color = (uid: number | undefined) => (uid ? COLORS[(uid - 1) % COLORS.length] : '#c9d1e0');

export const TOY_ICON =
  '<svg class="toy" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
  '<rect x="11" y="1.5" width="2" height="6" rx="1" fill="#8D99AE"/>' +
  '<rect x="8" y="6" width="8" height="3.6" rx="1.8" fill="#FF6B6B"/>' +
  '<rect x="6" y="10" width="12" height="3.6" rx="1.8" fill="#FFB703"/>' +
  '<rect x="4" y="14" width="16" height="3.6" rx="1.8" fill="#2DB84D"/>' +
  '<rect x="2" y="18.2" width="20" height="3.8" rx="1.9" fill="#3A86FF"/></svg>';

/* ------------------------------------------------------------------ */
/*  Сцена: станции, блоки, линия данных и жетоны команд               */
/* ------------------------------------------------------------------ */

interface Token {
  g: SVGGElement;
  label: SVGTextElement;
  sub: SVGTextElement;
  stage: number;
}

class Scene {
  readonly svg: SVGSVGElement;
  private tokens = new Map<number, Token>();
  private tokenLayer = s('g', { class: 'k-tokens' });
  private wires: { el: SVGGElement; signal: string }[] = [];
  private blocks = new Map<string, SVGGElement>();
  private bands = new Map<string, SVGGElement>();
  private vertical: boolean;

  constructor(host: HTMLElement, private def: MicroarchDef) {
    this.vertical = def.height > def.width;
    this.svg = s('svg', { class: 'k-svg', viewBox: `0 0 ${def.width} ${def.height}`, preserveAspectRatio: 'xMidYMid meet' });
    const bm = blockMap(def);

    def.stages!.forEach((st, i) => {
      const g = s('g', { class: 'k-band' });
      g.style.setProperty('--sc', st.color ?? '#ccc');
      g.append(
        s('rect', { class: 'k-band-bg', x: st.x0, y: st.y0 ?? 0, width: st.x1 - st.x0, height: (st.y1 ?? def.height) - (st.y0 ?? 0), rx: 22 }),
        s('circle', { class: 'k-num-bg', cx: st.x0 + 30, cy: (st.y0 ?? 0) + 34, r: 17 }),
        s('text', { class: 'k-num', x: st.x0 + 30, y: (st.y0 ?? 0) + 40, 'text-anchor': 'middle', text: String(i + 1) }),
        s('text', { class: 'k-name', x: st.x0 + 56, y: (st.y0 ?? 0) + 33, text: st.label }),
        s('text', { class: 'k-hint', x: st.x0 + 56, y: (st.y0 ?? 0) + 52, text: st.hint ?? '' }),
      );
      this.svg.append(g);
      this.bands.set(st.id, g);
    });

    for (const w of def.wires) {
      const pts = wirePoints(bm, w);
      const g = s('g', { class: 'k-wire' });
      g.append(s('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ') }));
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      g.append(s('polygon', { points: '0,0 -11,-7 -11,7', transform: `translate(${b[0]} ${b[1]}) rotate(${ang})` }));
      this.svg.append(g);
      this.wires.push({ el: g, signal: w.signal });
    }

    for (const b of def.blocks) {
      const g = s('g', { class: `k-block k-${b.type}` });
      g.append(s('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: b.type === 'pipereg' ? 4 : 16 }));
      const lines = b.label ? b.label.split('\n') : [];
      lines.forEach((ln, i) => g.append(s('text', { x: b.x + b.w / 2, y: b.y + b.h / 2 + 5 - ((lines.length - 1) * 16) / 2 + i * 16, 'text-anchor': 'middle', text: ln })));
      if (b.info) g.append(s('title', { text: b.info }));
      this.svg.append(g);
      this.blocks.set(b.id, g);
    }
    this.svg.append(this.tokenLayer);
    host.append(this.svg);
  }

  destroy() {
    this.svg.remove();
  }

  private place(t: Token, x: number, y: number, visible: boolean) {
    t.g.style.transform = `translate(${x}px, ${y}px)`;
    t.g.style.opacity = visible ? '1' : '0';
  }

  /** dir: 1 — вперёд, -1 — назад, 0 — без анимации. */
  update(step: TraceStep, dir: number) {
    const stages = this.def.stages!;
    const edge = (end: boolean): [number, number] => {
      const a = stages[end ? stages.length - 1 : 0].anchor!;
      const d = end ? 1 : -1;
      return this.vertical ? [a[0], a[1] + d * 70] : [a[0] + d * 110, a[1]];
    };
    const seen = new Set<number>();
    stages.forEach((st, i) => {
      const slot = step.stages[st.id];
      const on = slot?.status === 'instr' && !!slot.uid;
      const band = this.bands.get(st.id)!;
      band.classList.toggle('busy', on);
      if (!on) return;
      const uid = slot.uid!;
      seen.add(uid);
      let t = this.tokens.get(uid);
      if (!t) {
        const g = s('g', { class: 'k-token' });
        const label = s('text', { class: 'k-tok-text', y: 5, 'text-anchor': 'middle' });
        const sub = s('text', { class: 'k-tok-sub', y: 42, 'text-anchor': 'middle' });
        g.append(s('rect', { x: -92, y: -21, width: 184, height: 42, rx: 21 }), label, sub);
        g.style.setProperty('--tc', color(uid));
        this.tokenLayer.append(g);
        t = { g, label, sub, stage: i };
        this.tokens.set(uid, t);
        if (dir !== 0) {
          // появляется со стороны, откуда приехал
          const from = edge(dir < 0 && i === stages.length - 1);
          t.g.style.transition = 'none';
          this.place(t, from[0], from[1], false);
          void t.g.getBoundingClientRect();
          t.g.style.transition = '';
        }
      }
      t.stage = i;
      t.label.textContent = slot.text;
      t.sub.textContent = slot.detail ?? '';
      if (dir === 0) t.g.style.transition = 'none';
      this.place(t, st.anchor![0], st.anchor![1], true);
      if (dir === 0) {
        void t.g.getBoundingClientRect();
        t.g.style.transition = '';
      }
    });
    for (const [uid, t] of this.tokens) {
      if (seen.has(uid)) continue;
      this.tokens.delete(uid);
      const to = edge(dir >= 0);
      t.sub.textContent = '';
      this.place(t, to[0], to[1], false);
      setTimeout(() => t.g.remove(), dir === 0 ? 0 : 650);
    }

    const active = new Set(step.active);
    for (const w of this.wires) {
      const st = this.def.signals[w.signal]?.stage;
      const on = active.has(w.signal);
      w.el.classList.toggle('on', on);
      w.el.style.setProperty('--tc', on && st ? color(step.stages[st]?.uid) : '');
    }
    const ab = new Set(step.activeBlocks);
    for (const b of this.def.blocks) {
      const el = this.blocks.get(b.id)!;
      const on = ab.has(b.id);
      el.classList.toggle('on', on);
      el.style.setProperty('--tc', on && b.stage ? color(step.stages[b.stage]?.uid) : '');
      if (b.type === 'pipereg' && dir > 0) {
        el.classList.remove('tick');
        void el.getBoundingClientRect();
        el.classList.add('tick');
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Экран целиком                                                     */
/* ------------------------------------------------------------------ */

export class KidApp {
  readonly el: HTMLElement;
  private trace: Trace;
  private idx = 0;
  private playing = false;
  private timer: number | undefined;
  private scene: Scene | null = null;
  private sceneHost = h('div', { class: 'k-scene' });
  private list = h('div', { class: 'k-list' });
  private regsEl = h('div', { class: 'k-chips' });
  private memEl = h('div', { class: 'k-chips' });
  private dots = h('div', { class: 'k-dots' });
  private posEl = h('div', { class: 'k-pos' });
  private playBtn: HTMLButtonElement;
  private rows: { el: HTMLElement; status: HTMLElement; first: number; last: number; uid: number; done: string }[] = [];
  private regIds: number[] = [];
  private mql = window.matchMedia('(max-width: 760px)');
  private active = false;

  constructor(onExit: () => void) {
    const program = assemble(SIMPLE_PROGRAM, 'Просто');
    this.trace = simplePipelined.simulate(program);
    this.playBtn = h('button', { class: 'k-btn k-play', onclick: () => this.setPlaying(!this.playing) });

    this.el = h(
      'div',
      { class: 'kid' },
      h(
        'header',
        { class: 'k-top' },
        h('div', { class: 'k-title', html: `${TOY_ICON}<span>Процессор-конвейер</span>` }),
        h('button', { class: 'k-back', text: 'Подробная версия →', onclick: onExit }),
      ),
      h('p', {
        class: 'k-intro',
        html:
          'Процессор выполняет команды как <b>конвейер на заводе</b>. Каждая команда по очереди проезжает <b>5 станций</b>: ' +
          'её берут из памяти, разбирают, считают, заглядывают в память и записывают ответ. ' +
          'На каждый «тик» часов все команды сдвигаются на одну станцию вперёд — поэтому в работе сразу несколько команд, ' +
          'и ответы появляются один за другим. Нажми <b>▶ Пуск</b> и следи за цветными командами.',
      }),
      h(
        'div',
        { class: 'k-body' },
        this.sceneHost,
        h(
          'aside',
          { class: 'k-side' },
          h('section', { class: 'k-card' }, h('h3', { text: 'Команды' }), this.list),
          h('section', { class: 'k-card' }, h('h3', { text: 'Регистры' }), this.regsEl, h('h3', { text: 'Память' }), this.memEl),
        ),
      ),
      h(
        'footer',
        { class: 'k-player' },
        h(
          'div',
          { class: 'k-buttons' },
          h('button', { class: 'k-btn', title: 'Сначала', text: '↺', onclick: () => this.seek(0) }),
          h('button', { class: 'k-btn', title: 'Назад (←)', text: '◀', onclick: () => this.seek(this.idx - 1) }),
          this.playBtn,
          h('button', { class: 'k-btn', title: 'Вперёд (→)', text: '▶', onclick: () => this.seek(this.idx + 1) }),
        ),
        h('div', { class: 'k-progress' }, this.dots, this.posEl),
      ),
    );

    this.buildLists();
    this.trace.steps.forEach((st, i) => {
      this.dots.append(h('button', { class: 'k-dot', text: st.tick ?? String(st.cycle), title: st.title, onclick: () => this.seek(i) }));
    });
    this.mql.addEventListener('change', () => this.buildScene());
    window.addEventListener('keydown', (ev) => {
      if (!this.active) return;
      if (ev.key === 'ArrowRight') this.seek(this.idx + 1);
      else if (ev.key === 'ArrowLeft') this.seek(this.idx - 1);
      else if (ev.key === ' ') this.setPlaying(!this.playing);
      else if (ev.key === 'Home') this.seek(0);
      else return;
      ev.preventDefault();
    });
    this.buildScene();
  }

  setActive(on: boolean) {
    this.active = on;
    if (!on) this.setPlaying(false);
  }

  private buildScene() {
    this.scene?.destroy();
    this.scene = new Scene(this.sceneHost, buildSimpleDef(this.mql.matches));
    this.render(0);
  }

  private buildLists() {
    const steps = this.trace.steps;
    const regs = new Set<number>();
    this.rows = this.trace.program.instrs.map((ins) => {
      const f = fields(ins.word);
      const u = usage(classify(ins.word));
      if (u.rs1) regs.add(f.rs1);
      if (u.rs2) regs.add(f.rs2);
      if (u.writesReg) regs.add(f.rd);
      let first = -1;
      let last = -1;
      let uid = 0;
      let text = ins.text;
      let done = '';
      steps.forEach((st, i) => {
        for (const slot of Object.values(st.stages)) {
          if (slot.idx !== ins.idx || slot.status !== 'instr') continue;
          if (first < 0) first = i;
          last = i;
          uid = slot.uid ?? 0;
          text = slot.text;
        }
        const wslot = st.stages.W;
        if (wslot?.idx === ins.idx && wslot.status === 'instr') done = wslot.detail ?? '';
      });
      const pill = h('span', { class: 'k-pill', text });
      pill.style.setProperty('--tc', color(uid));
      const status = h('span', { class: 'k-status' });
      const el = h('div', { class: 'k-row' }, pill, status);
      this.list.append(el);
      return { el, status, first, last, uid, done };
    });
    regs.delete(0);
    this.regIds = [...regs].sort((a, b) => a - b);
  }

  seek(i: number) {
    const n = this.trace.steps.length;
    const next = Math.max(0, Math.min(n - 1, i));
    if (next === this.idx) return;
    const dir = Math.abs(next - this.idx) === 1 ? Math.sign(next - this.idx) : 0;
    this.idx = next;
    this.render(dir);
  }

  private setPlaying(p: boolean) {
    window.clearTimeout(this.timer);
    const n = this.trace.steps.length;
    if (p && this.idx >= n - 1) {
      this.idx = 0;
      this.render(0);
    }
    this.playing = p;
    // на телефоне страница длинная — при запуске подводим схему под глаза
    if (p && this.mql.matches) this.sceneHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const tick = () => {
      this.timer = window.setTimeout(() => {
        if (this.idx >= n - 1) {
          this.setPlaying(false);
          return;
        }
        this.seek(this.idx + 1);
        tick();
      }, 1500);
    };
    if (p) tick();
    this.renderPlayer();
  }

  private renderPlayer() {
    const n = this.trace.steps.length;
    this.playBtn.textContent = this.playing ? '⏸ Пауза' : this.idx >= n - 1 ? '↺ Ещё раз' : '▶ Пуск';
    this.playBtn.classList.toggle('playing', this.playing);
    const st = this.trace.steps[this.idx];
    this.posEl.textContent = this.idx === 0 ? 'Старт' : this.idx === n - 1 ? 'Готово! Все ответы записаны' : `Тик ${st.cycle} из ${n - 2}`;
    [...this.dots.children].forEach((d, i) => {
      d.classList.toggle('past', i < this.idx);
      d.classList.toggle('cur', i === this.idx);
    });
  }

  private render(dir: number) {
    const st = this.trace.steps[this.idx];
    this.scene?.update(st, dir);
    for (const r of this.rows) {
      const state = this.idx < r.first ? 'wait' : this.idx > r.last ? 'done' : 'run';
      r.el.className = `k-row ${state}`;
      if (state === 'wait') r.status.textContent = 'ждёт';
      else if (state === 'done') r.status.textContent = `✓ ${r.done}`;
      else {
        const k = Object.values(st.stages).findIndex((sl) => sl.uid === r.uid && sl.status === 'instr');
        r.status.textContent = `станция ${k + 1}`;
      }
    }
    clear(this.regsEl);
    for (const i of this.regIds) {
      this.regsEl.append(h('span', { class: `k-chip${st.changedReg === i ? ' chg' : ''}`, html: `x${i} <b>${s32(st.regs[i])}</b>` }));
    }
    clear(this.memEl);
    for (const [a, v] of Object.entries(st.mem)) {
      this.memEl.append(h('span', { class: `k-chip${st.changedMem === Number(a) ? ' chg' : ''}`, html: `ячейка ${a} <b>${s32(v)}</b>` }));
    }
    this.renderPlayer();
  }
}
