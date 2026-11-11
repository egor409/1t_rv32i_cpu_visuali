/**
 * Модель данных визуализатора.
 *
 * Две независимые части:
 *  1. MicroarchDef — декларативное описание схемы (блоки, порты, провода, сигналы, фазы).
 *     Используется ТОЛЬКО отображением. Движок о координатах ничего не знает.
 *  2. Trace — результат симуляции: последовательность шагов (такт × фаза) со значениями
 *     сигналов, набором активных путей и пояснениями. UI только проигрывает трассу,
 *     поэтому перемотка вперёд/назад — это просто смена индекса.
 *
 * Связь между ними — только через имена сигналов (SignalId), совпадающие с книгой
 * (PCF, InstrD, SrcAE, ALUControlE, ForwardAE, StallF, FlushE, …).
 */

export type SignalId = string;
export type BlockId = string;

/* ------------------------------------------------------------------ */
/*  Описание микроархитектуры                                         */
/* ------------------------------------------------------------------ */

export type SignalKind = 'data' | 'control' | 'hazard' | 'clock';

export interface SignalDef {
  /** Ширина в битах (для форматирования значения). */
  width: number;
  kind: SignalKind;
  /** Отображаемая подпись, если отличается от id (напр. "Instr[19:15]", "PCF'"). */
  label?: string;
  /** Краткое пояснение (тултип). */
  desc?: string;
}

export type BlockType =
  | 'register'       // PC, регистр стадии конвейера
  | 'pipereg'        // длинный регистр между стадиями
  | 'memory'         // Instr Mem / Data Mem
  | 'regfile'
  | 'alu'
  | 'adder'
  | 'mux'
  | 'extend'
  | 'control'
  | 'hazard'
  | 'logic'          // мелкая комбинационная логика (AND/OR для PCSrc)
  | 'stub';

export type Side = 'l' | 'r' | 't' | 'b';

export interface PortDef {
  id: string;
  side: Side;
  /** Смещение вдоль стороны в px от верхнего (для l/r) или левого (для t/b) угла блока. */
  off: number;
  /** Подпись порта внутри блока (A1, RD1, WE3, 0/1 у мультиплексора …). */
  label?: string;
}

export interface BlockDef {
  id: BlockId;
  type: BlockType;
  /** Подпись блока. */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ports: PortDef[];
  /** Стадия конвейера (F/D/E/M/W) — для подсветки стадии. */
  stage?: string;
  /** Пояснение (окно детализации). */
  info?: string;
  /** Есть ли тактовый вход (рисуется треугольник). */
  clocked?: boolean;
  /** Сигналы, относящиеся к блоку (показываются в окне детализации). */
  inputs?: SignalId[];
  outputs?: SignalId[];
  /** Ключ мини-анимации в окне детализации (M2). */
  anim?: string;
}

/** Конец провода: порт блока "Block.port" или точка [x, y] (ответвление/шина). */
export type WireEnd = string | [number, number];

export interface WireDef {
  id: string;
  signal: SignalId;
  from: WireEnd;
  to: WireEnd;
  /**
   * Промежуточные точки. Между соседними точками, если они не на одной оси,
   * автоматически вставляется угол (сначала по горизонтали).
   */
  via?: [number, number][];
  /** Вставлять угол сначала по вертикали. */
  vFirst?: boolean;
  /**
   * Провод активен, только если селектор мультиплексора равен value
   * (напр. вход 1 мультиплексора SrcB активен только при ALUSrc=1).
   */
  when?: { signal: SignalId; value: number | number[] };
  /** Где рисовать подпись/значение: индекс сегмента (по умолчанию — самый длинный). */
  labelSeg?: number;
  /** Смещение подписи относительно середины сегмента. */
  labelDx?: number;
  labelDy?: number;
  /** Не рисовать подпись (например, у второго ответвления того же сигнала). */
  noLabel?: boolean;
  /** Точка ветвления на начале провода. */
  dotStart?: boolean;
}

export interface PhaseDef {
  id: string;
  label: string;
  /** Короткая метка для таймлайна. */
  short: string;
}

export interface StageDef {
  id: string;     // 'F','D','E','M','W'
  label: string;  // 'Fetch', …
  /** Горизонтальный диапазон стадии на схеме (для фоновой подсветки). */
  x0: number;
  x1: number;
}

export interface MicroarchDef {
  id: string;
  name: string;
  /** Глава/раздел книги — для группировки (расширяемость на другие главы). */
  chapter: string;
  width: number;
  height: number;
  signals: Record<SignalId, SignalDef>;
  blocks: BlockDef[];
  wires: WireDef[];
  phases: PhaseDef[];
  stages?: StageDef[];
  /** Заглушка (ещё не реализована). */
  stub?: boolean;
  /** Свободные текстовые подписи на схеме. */
  notes?: { x: number; y: number; text: string; cls?: string }[];
}

/* ------------------------------------------------------------------ */
/*  Программа                                                         */
/* ------------------------------------------------------------------ */

export interface AsmInstr {
  /** Индекс в программе. */
  idx: number;
  addr: number;
  word: number;
  /** Нормализованный текст (как в исходнике). */
  text: string;
  /** Номер строки исходника (1-based). */
  line: number;
}

export interface Program {
  name: string;
  source: string;
  instrs: AsmInstr[];
  /** Начальные значения регистров (директива .reg). */
  initRegs: Record<number, number>;
  /** Начальное содержимое памяти данных (директива .word addr value). */
  initMem: Record<number, number>;
}

/* ------------------------------------------------------------------ */
/*  Трасса                                                            */
/* ------------------------------------------------------------------ */

export type SlotStatus = 'instr' | 'bubble' | 'stall' | 'empty';

export interface StageSlot {
  /** Индекс инструкции в программе или null (пузырь / пусто). */
  idx: number | null;
  text: string;
  status: SlotStatus;
  /** Пометка: "stall", "flush", "forward A←M" … */
  note?: string;
}

export type EventKind = 'stall' | 'flush' | 'forward' | 'regwrite' | 'memwrite' | 'branch' | 'info';

export interface TraceEvent {
  kind: EventKind;
  text: string;
}

export interface TraceStep {
  cycle: number;
  phase: string;
  /** Значения видимых в этой фазе сигналов. Отсутствующий ключ = ещё не вычислен. */
  values: Record<SignalId, number>;
  /** Сигналы на активном пути (подсветка). */
  active: SignalId[];
  /** Блоки, работающие в этой фазе. */
  activeBlocks: BlockId[];
  /** Содержимое стадий (single-cycle: одна "стадия"). */
  stages: Record<string, StageSlot>;
  /** Заголовок шага: "Такт 3 · Execute". */
  title: string;
  /** Что происходит. */
  what: string;
  /** Почему (краткое обоснование по книге). */
  why: string;
  events: TraceEvent[];
  /** Состояние регистрового файла ПОСЛЕ шага. */
  regs: number[];
  /** Слова памяти данных, к которым было обращение (снимок после шага). */
  mem: Record<number, number>;
  /** Изменённые на этом шаге регистр/ячейка (для подсветки в панели состояния). */
  changedReg?: number;
  changedMem?: number;
  /** Блоки-регистры, защёлкивающие значение на этом шаге (фронт CLK). */
  latching?: BlockId[];
  /** Блоки-регистры, удерживаемые (stall) / сбрасываемые (flush). */
  stalled?: BlockId[];
  flushed?: BlockId[];
}

/** Строка pipeline-диаграммы: инструкция × такты. */
export interface PipelineRow {
  idx: number;
  text: string;
  /** cycle → обозначение стадии ('F','D','E','M','W', 'D*' при stall, 'x' при flush). */
  cells: Record<number, string>;
}

export interface Trace {
  archId: string;
  program: Program;
  steps: TraceStep[];
  cycles: number;
  pipeline?: PipelineRow[];
  /** Предупреждения симулятора (достигнут лимит тактов и т.п.). */
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/*  Модуль микроархитектуры = описание + движок                       */
/* ------------------------------------------------------------------ */

export interface SimOptions {
  maxCycles?: number;
}

export interface ArchModule {
  def: MicroarchDef;
  /** Короткое описание для UI. */
  summary: string;
  simulate(program: Program, opts?: SimOptions): Trace;
  /** Рекомендуемые примеры (id из каталога программ). */
  examples: string[];
}
