import './style.css';
import { ARCHS, archById } from './arch';
import type { ArchModule, Program, Trace } from './core/types';
import { assemble } from './isa/assembler';
import { EXAMPLES, exampleById } from './programs/examples';
import { BlockDetail } from './ui/blockDetail';
import { clear, h } from './ui/dom';
import { Editor } from './ui/editor';
import { fmtFull, type NumFmt } from './ui/format';
import { Narration } from './ui/narration';
import { PipelineDiagram } from './ui/pipelineDiagram';
import { Schematic } from './ui/schematic';
import { SidePanel } from './ui/sidepanel';
import { Player } from './ui/timeline';

/* ------------------------------------------------------------------ */
/*  Состояние                                                         */
/* ------------------------------------------------------------------ */

const LAYERS = [
  { id: 'names', label: 'Подписи сигналов' },
  { id: 'values', label: 'Значения шин' },
  { id: 'control', label: 'Упр. сигналы' },
  { id: 'path', label: 'Подсветка пути' },
  { id: 'explain', label: 'Пояснения' },
  { id: 'pipeline', label: 'Pipeline diagram' },
  { id: 'state', label: 'Регистры и память' },
] as const;
type LayerId = (typeof LAYERS)[number]['id'];

interface Saved {
  layers: Record<LayerId, boolean>;
  fmt: NumFmt;
}

function loadSaved(): Saved {
  const def: Saved = { layers: { names: true, values: true, control: true, path: true, explain: true, pipeline: true, state: true }, fmt: 'hex' };
  try {
    const s = JSON.parse(localStorage.getItem('rvviz') ?? '{}');
    return { layers: { ...def.layers, ...(s.layers ?? {}) }, fmt: s.fmt === 'dec' ? 'dec' : 'hex' };
  } catch {
    return def;
  }
}

const saved = loadSaved();
const hash = new URLSearchParams(location.hash.slice(1));

const state = {
  arch: archById(hash.get('a') ?? 'riscv-single') as ArchModule,
  exampleId: null as string | null,
  customSource: null as string | null,
  program: null as Program | null,
  trace: null as Trace | null,
  idx: 0,
  playing: false,
  speed: 1,
  fmt: saved.fmt,
  layers: saved.layers,
  presentation: false,
};

function persist() {
  try {
    localStorage.setItem('rvviz', JSON.stringify({ layers: state.layers, fmt: state.fmt }));
    if (state.customSource) localStorage.setItem('rvviz-src', state.customSource);
  } catch {
    /* localStorage может быть недоступен */
  }
}

/* ------------------------------------------------------------------ */
/*  Каркас страницы                                                   */
/* ------------------------------------------------------------------ */

const app = document.getElementById('app')!;
const archBtns = h('div', { class: 'seg' });
const progSel = h('select', { class: 'prog-sel', title: 'Программа' });
const fmtBtn = h('button', { class: 'btn', title: 'Формат чисел: hex / dec (H)', onclick: () => toggleFmt() });
const presBtn = h('button', { class: 'btn', title: 'Режим «презентация»: скрыть все пояснения и панели (P)', text: 'Презентация', onclick: () => togglePresentation() });
const editBtn = h('button', { class: 'btn', text: '✎ Своя программа', onclick: () => editor.open(state.customSource ?? state.program?.source ?? '') });
const layerBox = h('div', { class: 'layers' });
const schemHost = h('div', { class: 'schem' });
const zoomBox = h(
  'div',
  { class: 'zoom' },
  h('button', { text: '+', title: 'Увеличить (колесо мыши)', onclick: () => schematic?.zoom(1.25) }),
  h('button', { text: '−', title: 'Уменьшить', onclick: () => schematic?.zoom(0.8) }),
  h('button', { text: '⤢', title: 'Вписать (двойной клик)', onclick: () => schematic?.fit() }),
);
const legend = h('div', {
  class: 'legend',
  html:
    '<span><i class="lg-data"></i>данные</span><span><i class="lg-ctl"></i>управление</span><span class="lg-hzs"><i class="lg-hz"></i>Hazard Unit</span>' +
    '<span><i class="lg-on"></i>активный путь</span><span><i class="lg-fresh"></i>текущая фаза</span>',
  title: 'Клик по блоку — детали · колесо мыши — масштаб · ←/→ — шаг · пробел — пуск',
});
const tip = h('div', { class: 'tip hidden' });
const warnBox = h('div', { class: 'warn hidden' });
const center = h('div', { class: 'center' });
const mainEl = h('div', { class: 'main' });
const narrHost = h('div', { class: 'narr-host' });
const exitPres = h('button', { class: 'exit-pres', text: '✕ выйти из презентации', onclick: () => togglePresentation() });

const pd = new PipelineDiagram((cycle) => seekCycle(cycle));
const side = new SidePanel(pd.el);
const player = new Player({
  seek: (i) => seek(i),
  step: (d) => seek(state.idx + d),
  cycle: (d) => stepCycle(d),
  togglePlay: () => setPlaying(!state.playing),
  setSpeed: (v) => (state.speed = v),
});
const editor = new Editor((p) => {
  state.customSource = p.source;
  state.exampleId = null;
  persist();
  setProgram(p);
  fillPrograms();
});

let schematic: Schematic | null = null;
let narration: Narration | null = null;
let detail: BlockDetail | null = null;

app.append(
  h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'brand' }, h('b', { text: 'RISC-V' }), h('span', { text: ' микроархитектура' }), h('small', { text: 'Harris & Harris, гл. 7' })),
    archBtns,
    h('div', { class: 'prog' }, h('span', { class: 'cap', text: 'Программа:' }), progSel, editBtn),
    h('div', { class: 'spacer' }),
    fmtBtn,
    presBtn,
  ),
  h('div', { class: 'toolbar' }, h('span', { class: 'cap', text: 'Слои:' }), layerBox, h('div', { class: 'spacer' }), legend),
  narrHost,
  mainEl,
  player.el,
  editor.el,
  tip,
  exitPres,
);
center.append(schemHost);
mainEl.append(center, side.el);
schemHost.append(zoomBox, warnBox);

for (const a of ARCHS) {
  archBtns.append(
    h('button', { class: 'seg-btn', 'data-id': a.def.id, title: `${a.def.chapter}. ${a.summary}`, text: a.def.name, onclick: () => setArch(a) }),
  );
}
for (const l of LAYERS) {
  const cb = h('input', { type: 'checkbox', id: `L-${l.id}` });
  cb.checked = state.layers[l.id];
  cb.addEventListener('change', () => {
    state.layers[l.id] = cb.checked;
    applyLayers();
    persist();
  });
  layerBox.append(h('label', { class: 'layer' }, cb, l.label));
}
progSel.addEventListener('change', () => {
  if (progSel.value === '__custom') {
    if (state.customSource) loadSource(state.customSource, null);
  } else loadExample(progSel.value);
});

/* ------------------------------------------------------------------ */
/*  Логика                                                            */
/* ------------------------------------------------------------------ */

function applyLayers() {
  for (const l of LAYERS) app.classList.toggle(`L-${l.id}-off`, !state.layers[l.id]);
  for (const l of LAYERS) (document.getElementById(`L-${l.id}`) as HTMLInputElement).checked = state.layers[l.id];
  app.classList.toggle('presentation', state.presentation);
  presBtn.classList.toggle('active', state.presentation);
}

function togglePresentation() {
  state.presentation = !state.presentation;
  applyLayers();
}

function toggleFmt() {
  state.fmt = state.fmt === 'hex' ? 'dec' : 'hex';
  persist();
  render();
}

function fillPrograms() {
  clear(progSel);
  const ids = state.arch.examples;
  for (const id of ids) {
    const e = exampleById(id);
    if (e) progSel.append(h('option', { value: e.id, text: e.title }));
  }
  if (state.customSource) progSel.append(h('option', { value: '__custom', text: 'Своя программа' }));
  progSel.value = state.exampleId ?? '__custom';
  progSel.disabled = !!state.arch.def.stub;
}

function setArch(a: ArchModule) {
  setPlaying(false);
  state.arch = a;
  schematic?.destroy();
  detail?.el.remove();
  clear(narrHost);
  schematic = new Schematic(schemHost, a.def, {
    onBlockClick: (id) => {
      if (a.def.stub) return;
      if (detail?.openId === id) detail.close();
      else {
        detail?.open(id);
        schematic?.highlightBlock(id);
        render();
      }
    },
    onHover: (info, ev) => showTip(info, ev),
  });
  narration = new Narration(a.def);
  narrHost.append(narration.el);
  detail = new BlockDetail(a.def, () => schematic?.highlightBlock(null));
  schemHost.append(detail.el);
  for (const b of archBtns.children) b.classList.toggle('active', (b as HTMLElement).dataset.id === a.def.id);
  app.classList.toggle('no-pipeline', !a.def.stages);
  app.classList.toggle('stub', !!a.def.stub);

  // программа: оставить текущую, если она подходит, иначе первый пример архитектуры
  if (state.exampleId && !a.examples.includes(state.exampleId)) state.exampleId = null;
  if (state.exampleId) loadExample(state.exampleId, false);
  else if (state.customSource) loadSource(state.customSource, null, false);
  else if (a.examples.length) loadExample(a.examples[0], false);
  else setProgram(state.program ?? assemble(EXAMPLES[0].source, EXAMPLES[0].title));
  fillPrograms();
}

function loadExample(id: string, keepIdx = false) {
  const e = exampleById(id);
  if (!e) return;
  loadSource(e.source, id, keepIdx, e.title);
}

function loadSource(source: string, exampleId: string | null, keepIdx = false, name = 'Своя программа') {
  state.exampleId = exampleId;
  setProgram(assemble(source, name), keepIdx);
}

function setProgram(p: Program, keepIdx = false) {
  setPlaying(false);
  state.program = p;
  const trace = state.arch.simulate(p);
  state.trace = trace;
  state.idx = keepIdx ? Math.min(state.idx, Math.max(0, trace.steps.length - 1)) : 0;
  player.setTrace(trace, state.arch.def);
  side.setTrace(trace, state.exampleId ? exampleById(state.exampleId)?.note : undefined);
  pd.setTrace(trace);
  warnBox.textContent = trace.warnings.join(' ');
  warnBox.classList.toggle('hidden', trace.warnings.length === 0 || !!state.arch.def.stub);
  render();
}

function seek(i: number) {
  const n = state.trace?.steps.length ?? 0;
  if (!n) return;
  state.idx = Math.max(0, Math.min(n - 1, i));
  render();
}

function seekCycle(cycle: number) {
  const i = state.trace?.steps.findIndex((s) => s.cycle === cycle) ?? -1;
  if (i >= 0) seek(i);
}

function stepCycle(d: number) {
  const steps = state.trace?.steps ?? [];
  const cur = steps[state.idx];
  if (!cur) return;
  if (d > 0) {
    const i = steps.findIndex((s) => s.cycle > cur.cycle);
    seek(i < 0 ? steps.length - 1 : i);
  } else {
    // к началу текущего такта, а если уже там — к началу предыдущего
    const first = steps.findIndex((s) => s.cycle === cur.cycle);
    seek(first < state.idx ? first : steps.findIndex((s) => s.cycle === cur.cycle - 1));
  }
}

let timer: number | undefined;
function setPlaying(p: boolean) {
  const n = state.trace?.steps.length ?? 0;
  if (p && state.idx >= n - 1) state.idx = 0;
  state.playing = p && n > 0;
  window.clearTimeout(timer);
  if (state.playing) tick();
  render();
}
function tick() {
  timer = window.setTimeout(() => {
    const n = state.trace?.steps.length ?? 0;
    if (state.idx >= n - 1) {
      setPlaying(false);
      return;
    }
    state.idx++;
    render();
    tick();
  }, 1100 / state.speed);
}

function render() {
  const trace = state.trace;
  if (!trace) return;
  const step = trace.steps[state.idx] ?? null;
  schematic?.setFormat(state.fmt);
  schematic?.update(step);
  narration?.update(step, state.arch.def.stub ? 'Эта микроархитектура ещё не реализована — выберите однотактный или конвейерный процессор.' : undefined);
  side.update(step, state.fmt);
  if (step) pd.update(step.cycle);
  player.update(state.idx, trace, state.playing);
  detail?.update(step, trace, state.fmt);
  fmtBtn.textContent = state.fmt === 'hex' ? 'hex | dec'.replace('hex', 'HEX') : 'hex | DEC';
  const q = new URLSearchParams({ a: state.arch.def.id });
  q.set('p', state.exampleId ?? 'custom');
  q.set('s', String(state.idx));
  history.replaceState(null, '', '#' + q.toString());
}

function showTip(info: { kind: 'block' | 'signal'; id: string } | null, ev: MouseEvent) {
  if (!info || !state.layers.explain || state.presentation) {
    tip.classList.add('hidden');
    return;
  }
  clear(tip);
  const def = state.arch.def;
  if (info.kind === 'signal') {
    const sd = def.signals[info.id];
    const v = state.trace?.steps[state.idx]?.values[info.id];
    tip.append(h('b', { text: sd?.label ?? info.id }), h('span', { class: 'tip-v', text: ' = ' + fmtFull(sd, v) }));
    if (sd?.desc) tip.append(h('div', { text: sd.desc }));
  } else {
    const b = def.blocks.find((x) => x.id === info.id);
    if (!b || b.type === 'stub') {
      tip.classList.add('hidden');
      return;
    }
    tip.append(h('b', { text: b.label.replace(/\n/g, ' ') || b.id }));
    if (b.info) tip.append(h('div', { text: b.info }));
    tip.append(h('div', { class: 'tip-hint', text: 'клик — подробности' }));
  }
  tip.classList.remove('hidden');
  const pad = 14;
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
  tip.style.left = `${Math.max(4, x)}px`;
  tip.style.top = `${Math.max(4, y)}px`;
}

window.addEventListener('keydown', (ev) => {
  const t = ev.target as HTMLElement;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox' && (t as HTMLInputElement).type !== 'range')) return;
  switch (ev.key) {
    case 'ArrowRight':
      ev.shiftKey ? stepCycle(1) : seek(state.idx + 1);
      break;
    case 'ArrowLeft':
      ev.shiftKey ? stepCycle(-1) : seek(state.idx - 1);
      break;
    case ' ':
      setPlaying(!state.playing);
      break;
    case 'Home':
      seek(0);
      break;
    case 'End':
      seek(Infinity);
      break;
    case 'p':
    case 'P':
    case 'з':
    case 'З':
      togglePresentation();
      break;
    case 'h':
    case 'H':
    case 'р':
    case 'Р':
      toggleFmt();
      break;
    case 'Escape':
      if (detail?.openId) detail.close();
      else if (state.presentation) togglePresentation();
      break;
    default:
      return;
  }
  ev.preventDefault();
});

/* ------------------------------------------------------------------ */
/*  Запуск                                                            */
/* ------------------------------------------------------------------ */

applyLayers();
{
  const p = hash.get('p');
  try {
    state.customSource = localStorage.getItem('rvviz-src');
  } catch {
    /* localStorage может быть недоступен */
  }
  if (p && exampleById(p)) state.exampleId = p;
  const wantCustom = p === 'custom' && !!state.customSource;
  if (!wantCustom) {
    // своя программа остаётся в списке, но при обычной загрузке открываем пример
    const keep = state.customSource;
    state.customSource = null;
    setArch(state.arch);
    state.customSource = keep;
    fillPrograms();
  } else {
    try {
      setArch(state.arch);
    } catch {
      // сохранённая программа больше не собирается — показываем пример
      state.customSource = null;
      setArch(state.arch);
    }
  }
  const s0 = Number(hash.get('s') ?? 0);
  if (s0) seek(s0);
}
