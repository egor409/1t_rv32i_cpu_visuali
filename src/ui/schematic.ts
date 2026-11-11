/**
 * Отрисовка схемы по декларативному описанию (MicroarchDef) и её обновление по шагу трассы.
 * Ничего не знает о конкретной микроархитектуре.
 */
import { SLANT, blockMap, wirePoints, type Pt } from '../core/geometry';
import type { BlockDef, MicroarchDef, TraceStep, WireDef } from '../core/types';
import { s } from './dom';
import { fmtSignal, instrColor, type NumFmt } from './format';

export interface SchematicHandlers {
  onBlockClick(blockId: string): void;
  onHover(info: { kind: 'block' | 'signal'; id: string } | null, ev: MouseEvent): void;
}

interface WireView {
  def: WireDef;
  g: SVGGElement;
  label?: SVGTextElement;
  val?: SVGTSpanElement;
}

export class Schematic {
  readonly svg: SVGSVGElement;
  private wires: WireView[] = [];
  private wireLayer: SVGGElement;
  private blockEls = new Map<string, SVGGElement>();
  private stageEls = new Map<string, { band: SVGRectElement; name: SVGTextElement; instr: SVGTextElement }>();
  private view: { x: number; y: number; w: number; h: number };
  private fmt: NumFmt = 'hex';

  constructor(
    private host: HTMLElement,
    private def: MicroarchDef,
    private handlers: SchematicHandlers,
  ) {
    this.view = { x: 0, y: 0, w: def.width, h: def.height };
    this.svg = s('svg', { class: 'schem-svg', preserveAspectRatio: 'xMidYMid meet' });
    this.applyView();
    this.wireLayer = s('g', { class: 'wires' });
    const labelLayer = s('g', { class: 'wlabels' });
    const blockLayer = s('g', { class: 'blocks' });
    const stageLayer = s('g', { class: 'stages' });
    const bm = blockMap(def);

    /* стадии конвейера: фон и подписи */
    for (const st of def.stages ?? []) {
      const band = s('rect', { class: 'stage-band', x: st.x0, y: 36, width: st.x1 - st.x0, height: def.height - 36 - 112, rx: 6 });
      const name = s('text', { class: 'stage-name', x: st.x0 + 8, y: def.height - 26, text: st.label });
      const instr = s('text', { class: 'stage-instr', x: st.x0 + 8, y: def.height - 8 });
      stageLayer.append(band, name, instr);
      this.stageEls.set(st.id, { band, name, instr });
    }

    /* провода */
    for (const w of def.wires) {
      const sd = def.signals[w.signal];
      const pts = wirePoints(bm, w);
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
      const g = s('g', { class: `wire k-${sd?.kind ?? 'data'}${(sd?.width ?? 32) > 1 ? ' bus' : ''}`, 'data-signal': w.signal });
      g.append(s('path', { class: 'wl', d }));
      if (typeof w.to === 'string') g.append(arrow(pts[pts.length - 2], pts[pts.length - 1]));
      if (w.dotStart) g.append(s('circle', { class: 'dot', cx: pts[0][0], cy: pts[0][1], r: 2.6 }));
      const hit = s('path', { class: 'hit', d });
      hit.addEventListener('mousemove', (ev) => this.handlers.onHover({ kind: 'signal', id: w.signal }, ev));
      hit.addEventListener('mouseleave', (ev) => this.handlers.onHover(null, ev));
      g.append(hit);
      this.wireLayer.append(g);
      const view: WireView = { def: w, g };

      if (!w.noLabel) {
        const [pos, vertical, len] = labelPos(pts, w);
        const name = sd?.label ?? w.signal;
        // короткий горизонтальный сегмент: имя над проводом, значение под ним
        const estimate = (name.length + (sd && sd.width <= 7 ? 4 : 11)) * 6;
        const stack = w.stack ?? (!vertical && len < estimate);
        const x = pos[0] + (vertical ? 5 : 0) + (w.labelDx ?? 0);
        const y = pos[1] + (vertical ? 3 : -4) + (w.labelDy ?? 0);
        const t = s('text', { class: `wlabel k-${sd?.kind ?? 'data'}`, x, y, 'text-anchor': vertical ? 'start' : 'middle' });
        const nm = s('tspan', { class: 'wn', text: name });
        const val = stack ? s('tspan', { class: 'wv', x, dy: vertical ? 12 : 16 }) : s('tspan', { class: 'wv', dx: 4 });
        t.append(nm, val);
        labelLayer.append(t);
        view.label = t;
        view.val = val;
      }
      this.wires.push(view);
    }

    /* блоки */
    for (const b of def.blocks) {
      const g = drawBlock(b);
      g.addEventListener('click', () => this.handlers.onBlockClick(b.id));
      g.addEventListener('mousemove', (ev) => this.handlers.onHover({ kind: 'block', id: b.id }, ev));
      g.addEventListener('mouseleave', (ev) => this.handlers.onHover(null, ev));
      blockLayer.append(g);
      this.blockEls.set(b.id, g);
    }
    for (const n of def.notes ?? []) blockLayer.append(s('text', { class: `note ${n.cls ?? ''}`, x: n.x, y: n.y, text: n.text }));

    this.svg.append(stageLayer, this.wireLayer, blockLayer, labelLayer);
    host.append(this.svg);
    this.initPanZoom();
  }

  destroy() {
    this.svg.remove();
  }

  setFormat(fmt: NumFmt) {
    this.fmt = fmt;
  }

  highlightBlock(id: string | null) {
    for (const [bid, el] of this.blockEls) el.classList.toggle('selected', bid === id);
  }

  update(step: TraceStep | null) {
    const def = this.def;
    const active = new Set(step?.active ?? []);
    const fresh = new Set(step?.fresh ?? []);
    const values = step?.values ?? {};
    const tail: SVGGElement[] = [];

    for (const v of this.wires) {
      const w = v.def;
      const sd = def.signals[w.signal];
      const val = values[w.signal];
      let on = active.has(w.signal);
      if (on && w.when) {
        const sel = values[w.when.signal];
        on = Array.isArray(w.when.value) ? w.when.value.includes(sel) : sel === w.when.value;
      }
      if (on && w.requires) on = w.requires.every((r) => active.has(r));
      if (on && sd && sd.kind !== 'data' && (sd.width === 1 || sd.kind === 'hazard') && !val) on = false;
      const isFresh = on && fresh.has(w.signal);
      v.g.classList.toggle('on', on);
      v.g.classList.toggle('fresh', isFresh);
      const uid = sd?.stage ? step?.stages[sd.stage]?.uid : undefined;
      const color = on && uid && sd?.kind !== 'hazard' ? instrColor(uid) : '';
      v.g.style.setProperty('--ic', color);
      if (on) tail.push(v.g);
      if (v.label && v.val) {
        v.val.textContent = fmtSignal(w.signal, sd, val, this.fmt);
        v.label.classList.toggle('on', on);
        v.label.classList.toggle('unknown', val === undefined);
        v.label.style.setProperty('--ic', color);
      }
    }
    // активные провода — поверх остальных
    for (const g of tail) this.wireLayer.append(g);

    const ab = new Set(step?.activeBlocks ?? []);
    const latch = new Set(step?.latching ?? []);
    const stall = new Set(step?.stalled ?? []);
    const flush = new Set(step?.flushed ?? []);
    for (const [id, el] of this.blockEls) {
      el.classList.toggle('on', ab.has(id));
      el.classList.toggle('latch', latch.has(id));
      el.classList.toggle('stall', stall.has(id));
      el.classList.toggle('flush', flush.has(id));
    }

    for (const [id, el] of this.stageEls) {
      const slot = step?.stages[id];
      const c = slot?.status === 'instr' ? instrColor(slot.uid) : '';
      el.band.style.setProperty('--ic', c);
      el.band.classList.toggle('busy', slot?.status === 'instr');
      el.band.classList.toggle('bubble', slot?.status === 'bubble');
      el.instr.textContent = slot ? slot.text + (slot.note ? `   ⟨${slot.note}⟩` : '') : '';
      el.instr.style.setProperty('--ic', c);
      el.name.style.setProperty('--ic', c);
    }
  }

  /* ---------------- масштаб и панорама ---------------- */

  private applyView() {
    const v = this.view;
    this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  }

  fit() {
    this.view = { x: 0, y: 0, w: this.def.width, h: this.def.height };
    this.applyView();
  }

  zoom(factor: number, cx?: number, cy?: number) {
    const v = this.view;
    const nw = Math.min(this.def.width * 1.5, Math.max(this.def.width / 6, v.w / factor));
    const k = nw / v.w;
    const px = cx ?? v.x + v.w / 2;
    const py = cy ?? v.y + v.h / 2;
    this.view = { x: px - (px - v.x) * k, y: py - (py - v.y) * k, w: nw, h: v.h * k };
    this.applyView();
  }

  private toSvg(ev: MouseEvent): Pt {
    const m = this.svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }

  private initPanZoom() {
    this.svg.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const [x, y] = this.toSvg(ev);
        this.zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15, x, y);
      },
      { passive: false },
    );
    let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
    this.svg.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      drag = { x: ev.clientX, y: ev.clientY, vx: this.view.x, vy: this.view.y, moved: false };
    });
    window.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      this.host.classList.add('panning');
      const m = this.svg.getScreenCTM();
      const k = m ? 1 / m.a : 1;
      this.view.x = drag.vx - dx * k;
      this.view.y = drag.vy - dy * k;
      this.applyView();
    });
    window.addEventListener('pointerup', () => {
      if (drag?.moved) {
        // подавить click после перетаскивания
        const stop = (e: Event) => e.stopPropagation();
        this.svg.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => this.svg.removeEventListener('click', stop, { capture: true }), 0);
      }
      drag = null;
      this.host.classList.remove('panning');
    });
    this.svg.addEventListener('dblclick', (ev) => {
      if ((ev.target as Element).closest('.block')) return;
      this.fit();
    });
  }
}

/* ---------------- помощники отрисовки ---------------- */

function arrow(a: Pt, b: Pt): SVGPolygonElement {
  const dx = Math.sign(b[0] - a[0]);
  const dy = Math.sign(b[1] - a[1]);
  const L = 6;
  const Wd = 3;
  const [x, y] = b;
  const pts =
    dx !== 0
      ? `${x},${y} ${x - dx * L},${y - Wd} ${x - dx * L},${y + Wd}`
      : `${x},${y} ${x - Wd},${y - dy * L} ${x + Wd},${y - dy * L}`;
  return s('polygon', { class: 'arrow', points: pts });
}

/** Точка подписи: середина выбранного (или самого длинного) сегмента. */
function labelPos(pts: Pt[], w: WireDef): [Pt, boolean, number] {
  let idx = 0;
  if (w.labelSeg !== undefined) {
    idx = w.labelSeg < 0 ? pts.length - 1 + w.labelSeg : w.labelSeg;
    idx = Math.max(0, Math.min(pts.length - 2, idx));
  } else {
    let best = -1;
    for (let i = 0; i < pts.length - 1; i++) {
      const len = Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
      const horiz = Math.abs(pts[i + 1][1] - pts[i][1]) < 0.5;
      const score = len + (horiz ? 20 : 0);
      if (score > best) {
        best = score;
        idx = i;
      }
    }
  }
  const a = pts[idx];
  const b = pts[idx + 1];
  const vertical = Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) > 0.5;
  return [[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], vertical, Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])];
}

function drawBlock(b: BlockDef): SVGGElement {
  const g = s('g', { class: `block t-${b.type}`, 'data-block': b.id });
  const { x, y, w, h } = b;
  let shape: SVGElement;
  switch (b.type) {
    case 'mux': {
      const k = SLANT.mux * h;
      shape = s('polygon', { class: 'shape', points: `${x},${y} ${x + w},${y + k} ${x + w},${y + h - k} ${x},${y + h}` });
      break;
    }
    case 'alu':
    case 'adder': {
      const k = SLANT.alu * h;
      shape = s('polygon', {
        class: 'shape',
        points: `${x},${y} ${x + w},${y + k} ${x + w},${y + h - k} ${x},${y + h} ${x},${y + h * 0.6} ${x + w * 0.22},${y + h * 0.5} ${x},${y + h * 0.4}`,
      });
      break;
    }
    case 'pipereg':
      shape = s('rect', { class: 'shape', x, y, width: w, height: h, rx: 2 });
      break;
    default:
      shape = s('rect', { class: 'shape', x, y, width: w, height: h, rx: b.type === 'logic' ? 10 : 5 });
  }
  g.append(shape);

  if (b.clocked) {
    if (b.type === 'pipereg') {
      g.append(s('polyline', { class: 'clk', points: `${x + 3},${y} ${x + w / 2},${y + 8} ${x + w - 3},${y}` }));
    } else {
      const cx = x + w - 14;
      g.append(s('polyline', { class: 'clk', points: `${cx - 6},${y + h} ${cx},${y + h - 9} ${cx + 6},${y + h}` }));
    }
  }

  // подписи портов
  for (const p of b.ports) {
    if (!p.label) continue;
    let tx = x;
    let ty = y;
    let anchor = 'start';
    if (p.side === 'l') {
      tx = x + 4;
      ty = y + p.off + 3.5;
    } else if (p.side === 'r') {
      tx = x + w - 4;
      ty = y + p.off + 3.5;
      anchor = 'end';
    } else if (p.side === 't') {
      tx = x + p.off;
      ty = y + 12;
      anchor = 'middle';
    } else {
      tx = x + p.off;
      ty = y + h - 5;
      anchor = 'middle';
    }
    g.append(s('text', { class: 'plabel', x: tx, y: ty, 'text-anchor': anchor, text: p.label }));
  }

  // название
  const lines = b.label.split('\n');
  if (b.type === 'pipereg') {
    g.append(s('text', { class: 'blabel reg', x: x + w / 2, y: y - 4, 'text-anchor': 'middle', text: b.label }));
  } else if (b.label) {
    const lh = 14;
    const cy = y + h / 2 - ((lines.length - 1) * lh) / 2 + 4;
    const cx = b.type === 'alu' || b.type === 'adder' ? x + w * 0.6 : x + w / 2;
    lines.forEach((ln, i) => g.append(s('text', { class: 'blabel', x: cx, y: cy + i * lh, 'text-anchor': 'middle', text: ln })));
  }
  // значок состояния (stall / flush) — показывается через CSS
  g.append(s('text', { class: 'badge', x: x + w / 2, y: b.type === 'pipereg' ? y + h + 13 : y - 5, 'text-anchor': 'middle' }));
  return g;
}
