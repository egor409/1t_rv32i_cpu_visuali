/** Верхняя панель: что происходит, почему, какая инструкция на какой стадии. */
import type { MicroarchDef, TraceStep } from '../core/types';
import { clear, h } from './dom';
import { instrColor } from './format';

const EVENT_ICON: Record<string, string> = { stall: '⏸', flush: '✕', forward: '↪', regwrite: '✎', memwrite: '▣', branch: '⤴', info: 'ℹ' };

export class Narration {
  readonly el: HTMLElement;
  private title = h('div', { class: 'narr-title' });
  private what = h('div', { class: 'narr-what' });
  private why = h('div', { class: 'narr-why' });
  private events = h('div', { class: 'narr-events' });
  private stages = h('div', { class: 'narr-stages' });

  constructor(private def: MicroarchDef) {
    this.el = h('section', { class: 'narr' }, h('div', { class: 'narr-main' }, this.title, this.what, this.why, this.events), this.stages);
  }

  update(step: TraceStep | null, message?: string) {
    clear(this.title);
    clear(this.events);
    clear(this.stages);
    if (!step) {
      this.title.textContent = message ?? '';
      this.what.textContent = '';
      this.why.textContent = '';
      return;
    }
    const phase = this.def.phases.find((p) => p.id === step.phase);
    this.title.append(
      h('span', { class: 'badge cyc', text: `Такт ${step.cycle}` }),
      h('span', { class: `badge ph ph-${step.phase}`, text: phase?.label ?? step.phase }),
    );
    this.what.textContent = step.what;
    clear(this.why);
    if (step.why) this.why.append(h('b', { text: 'Почему: ' }), step.why);
    for (const e of step.events) {
      this.events.append(h('span', { class: `ev ev-${e.kind}`, text: `${EVENT_ICON[e.kind] ?? ''} ${e.text}` }));
    }

    if (this.def.stages) {
      for (const st of this.def.stages) {
        const slot = step.stages[st.id];
        const row = h('div', { class: `st-row st-${slot?.status ?? 'empty'}`, title: slot?.detail ?? '' });
        row.style.setProperty('--ic', slot?.status === 'instr' ? instrColor(slot.uid) : '#adb5bd');
        row.append(h('span', { class: 'st-tag', text: st.label }), h('span', { class: 'st-instr', text: slot?.text ?? '—' }));
        if (slot?.note) row.append(h('span', { class: `st-note n-${slot.note.split(' ')[0]}`, text: slot.note }));
        row.append(h('span', { class: 'st-detail', text: slot?.detail ?? '' }));
        this.stages.append(row);
      }
    } else {
      // однотактный: одна инструкция, прогресс по фазам
      const slot = Object.values(step.stages)[0];
      const cur = this.def.phases.findIndex((p) => p.id === step.phase);
      const bar = h('div', { class: 'ph-bar' });
      this.def.phases.forEach((p, i) => {
        bar.append(h('span', { class: `ph-chip${i === cur ? ' cur' : i < cur ? ' done' : ''}`, text: p.label.split(' — ')[0] }));
      });
      this.stages.append(
        h('div', { class: 'sc-instr' }, h('span', { class: 'sc-cap', text: 'Инструкция:' }), h('code', { text: slot?.text ?? '—' })),
        bar,
        h('div', { class: 'sc-hint', text: 'Весь путь инструкции укладывается в один такт; фазы показывают, как сигнал распространяется по комбинационной логике.' }),
      );
    }
  }
}
