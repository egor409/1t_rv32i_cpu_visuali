/** Модальное окно: редактор своей asm-программы. */
import type { Program } from '../core/types';
import { AsmError, SUPPORTED, assemble } from '../isa/assembler';
import { h } from './dom';

export class Editor {
  readonly el: HTMLElement;
  private ta = h('textarea', { class: 'ed-ta', spellcheck: 'false', rows: 16 });
  private err = h('div', { class: 'ed-err' });

  constructor(private onRun: (p: Program) => void) {
    const run = h('button', { class: 'btn primary', text: 'Собрать и запустить (Ctrl+Enter)', onclick: () => this.run() });
    const close = h('button', { class: 'btn', text: 'Закрыть', onclick: () => this.close() });
    this.ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) this.run();
      if (ev.key === 'Escape') this.close();
      ev.stopPropagation();
    });
    this.el = h(
      'div',
      { class: 'modal hidden', onclick: (ev: MouseEvent) => ev.target === this.el && this.close() },
      h(
        'div',
        { class: 'modal-box' },
        h('h2', { text: 'Своя программа' }),
        h('p', {
          class: 'ed-help',
          html: `Поддерживается: <code>${SUPPORTED.join('</code>, <code>')}</code>. Метки — <code>имя:</code>, комментарии — <code>#</code>.<br>
            Начальное состояние: <code>.reg x9, 0x2004</code> — регистр, <code>.word 0x2000, 10</code> — слово памяти данных.`,
        }),
        this.ta,
        this.err,
        h('div', { class: 'ed-actions' }, run, close),
      ),
    );
  }

  open(source: string) {
    this.ta.value = source;
    this.err.textContent = '';
    this.el.classList.remove('hidden');
    this.ta.focus();
  }

  close() {
    this.el.classList.add('hidden');
  }

  private run() {
    try {
      const p = assemble(this.ta.value, 'Своя программа');
      this.err.textContent = '';
      this.close();
      this.onRun(p);
    } catch (e) {
      this.err.textContent = e instanceof AsmError ? `Ошибка: ${e.message}` : String(e);
    }
  }
}
