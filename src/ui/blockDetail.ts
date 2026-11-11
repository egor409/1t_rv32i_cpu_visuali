/** Окно детализации блока: описание, входы/выходы со значениями, мини-анимация. */
import { blockIO, type BlockIO } from '../core/geometry';
import type { BlockDef, MicroarchDef, Trace, TraceStep } from '../core/types';
import { renderAnim } from './blockAnims';
import { clear, h } from './dom';
import { fmtFull, fmtSignal, type NumFmt } from './format';

export class BlockDetail {
  readonly el: HTMLElement;
  private body = h('div', { class: 'bd-body' });
  private titleEl = h('div', { class: 'bd-title' });
  private io: Map<string, BlockIO>;
  private block: BlockDef | null = null;

  constructor(
    private def: MicroarchDef,
    private onClose: () => void,
  ) {
    this.io = blockIO(def);
    this.el = h(
      'div',
      { class: 'bd hidden' },
      h('div', { class: 'bd-head' }, this.titleEl, h('button', { class: 'bd-x', text: '×', title: 'Закрыть (Esc)', onclick: () => this.close() })),
      this.body,
    );
  }

  get openId(): string | null {
    return this.block?.id ?? null;
  }

  open(blockId: string) {
    this.block = this.def.blocks.find((b) => b.id === blockId) ?? null;
    this.el.classList.toggle('hidden', !this.block);
  }

  close() {
    if (!this.block) return;
    this.block = null;
    this.el.classList.add('hidden');
    this.onClose();
  }

  update(step: TraceStep | null, trace: Trace, fmt: NumFmt) {
    const b = this.block;
    if (!b) return;
    clear(this.body);
    this.titleEl.textContent = b.label.replace(/\n/g, ' ') || BLOCK_NAMES[b.id] || b.id;
    if (b.type === 'mux') this.titleEl.textContent = `Мультиплексор ${b.id.replace('Mux', '')}`;
    if (b.type === 'adder') this.titleEl.textContent = `Сумматор ${b.id === 'AddPC4' ? 'PC + 4' : 'PC + Imm'}`;
    if (b.type === 'pipereg') this.titleEl.textContent = `Регистр стадий ${b.label}`;
    if (b.info) this.body.append(h('p', { class: 'bd-info', text: b.info }));

    const io = this.io.get(b.id)!;
    const anim = renderAnim(b, io, step, trace, this.def, fmt);
    if (anim) this.body.append(h('div', { class: 'bd-anim' }, anim));

    const active = new Set(step?.active ?? []);
    const tbl = (cap: string, list: BlockIO['inputs']) => {
      if (!list.length) return null;
      const t = h('table', { class: 'bd-io' });
      t.append(h('caption', { text: cap }));
      for (const { port, signal } of list) {
        const sd = this.def.signals[signal];
        const v = step?.values[signal];
        t.append(
          h(
            'tr',
            { class: active.has(signal) ? 'on' : '', title: sd?.desc ?? '' },
            h('td', { class: 'p', text: b.ports.find((p) => p.id === port)?.label ?? '' }),
            h('td', { class: 'n', text: sd?.label ?? signal }),
            h('td', { class: 'v', text: fmtSignal(signal, sd, v, fmt) || '—' }),
            h('td', { class: 'f', text: v === undefined ? '' : fmtFull(sd, v) }),
          ),
        );
      }
      return t;
    };
    const a = tbl('Входы', io.inputs);
    const o = tbl('Выходы', io.outputs);
    if (a) this.body.append(a);
    if (o) this.body.append(o);
  }
}

const BLOCK_NAMES: Record<string, string> = {};
