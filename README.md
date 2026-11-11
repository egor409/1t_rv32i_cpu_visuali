# RISC-V: визуализация микроархитектуры

Учебное веб-приложение по главе 7 книги Harris & Harris «Digital Design and Computer Architecture,
RISC-V Edition». Показывает, как инструкция проходит по тракту данных однотактного и конвейерного
процессоров: значения на шинах, управляющие сигналы, работу Hazard Unit (forwarding, stall, flush).

Стек: TypeScript + Vite, схема в SVG, без фреймворков. Собирается в статику (GitHub Pages).

## Запуск

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # тесты движков и согласованности схем
npm run build      # статика в dist/
```

Деплой: workflow `.github/workflows/deploy.yml` собирает и публикует `dist/` при пуше в `main`.
В настройках репозитория нужно один раз включить **Settings → Pages → Source: GitHub Actions**.

## Что умеет

- **Микроархитектуры**: однотактная (разд. 7.3), конвейерная с Hazard Unit (разд. 7.5); многотактная — заглушка (M3).
- **Программы**: готовые примеры (lw, sw, R-type, beq, jal; для конвейера — RAW + forwarding, lw-stall,
  branch flush, смешанный сценарий) и редактор своей программы
  (`lw, sw, add, sub, and, or, slt, addi, andi, ori, slti, beq, jal`, псевдо `nop`, `j`; метки; `.reg`, `.word`).
- **Схема**: подсветка активного пути, значения на шинах (hex/dec), в конвейере каждая инструкция имеет свой цвет.
  Колесо мыши — масштаб, перетаскивание — панорама, двойной клик — вписать.
- **Верхняя панель**: что происходит, почему, какая инструкция на какой стадии.
- **Клик по блоку** — окно с входами/выходами и мини-анимацией (PC + CLK, мультиплексоры, АЛУ, регистровый файл,
  таблица Main Decoder, уравнения Hazard Unit, Extend, памяти, регистры стадий).
- **Слои**: подписи сигналов, значения, управляющие сигналы, подсветка пути, пояснения, pipeline diagram,
  регистры/память. Кнопка «Презентация» скрывает все пояснения и панели.
- **Воспроизведение**: авто с регулируемой скоростью и пошагово; такт делится на фазы
  (однотактный: Fetch / Decode / Execute / Memory / Writeback; конвейер: работа стадий / Hazard Unit / фронт CLK).
- **Таймлайн** с метками тактов и фаз, перемотка в обе стороны; метки hazard-событий (forward / stall / flush).

Клавиши: `←/→` — шаг, `Shift+←/→` — такт, `Пробел` — пуск/пауза, `Home/End`, `H` — hex/dec, `P` — презентация, `Esc`.

## Архитектура

Главный принцип — **модель отдельно от отображения**. Движок ничего не знает о координатах, UI ничего не знает
о конкретном процессоре; связывают их только имена сигналов (как в книге: `PCF`, `InstrD`, `SrcAE`, `ForwardAE`, …).

```
src/
  core/
    types.ts        модель данных: MicroarchDef (схема), Trace (трасса), ArchModule
    geometry.ts     позиции портов, трассировка проводов, входы/выходы блоков
  isa/
    rv32i.ts        поля инструкции, Main/ALU Decoder, Extend, ALU, дизассемблер
    assembler.ts    мини-ассемблер поддерживаемого подмножества
  arch/
    index.ts        реестр микроархитектур (ARCHS)
    dsl.ts          помощники для декларативного описания схем
    riscv-single/     layout.ts (схема)  +  engine.ts (движок)
    riscv-pipelined/  layout.ts          +  engine.ts
    riscv-multicycle/ index.ts           (заглушка, M3)
  programs/examples.ts   каталог примеров
  ui/               schematic (SVG), narration, timeline, sidepanel, pipelineDiagram,
                    blockDetail + blockAnims, editor
  main.ts           состояние приложения и связывание компонентов
tests/              тесты движков, hazard-сценариев и согласованности «схема ↔ движок»
```

### Описание микроархитектуры (`MicroarchDef`)

Декларативные данные: сигналы, блоки с портами и координатами, провода.

```ts
signals: { ALUSrcE: { width: 1, kind: 'control', stage: 'E', fmt: 'bin', desc: '…' }, … }
blocks:  [{ id: 'ALU', type: 'alu', x, y, w, h, ports: [{ id: 'a', side: 'l', off: 40 }, …], anim: 'alu' }, …]
wires:   [{ signal: 'ImmExtE', from: [878, 440], to: 'SrcBMux.in1', via: [[878, 400]],
            when: { signal: 'ALUSrcE', value: 1 },   // активен только при таком селекторе
            requires: ['SrcBE'] }, …]                // …и если используется выход мультиплексора
phases:  [{ id: 'stages', … }, { id: 'hazard', … }, { id: 'edge', … }]
stages:  [{ id: 'F', label: 'Fetch', x0, x1 }, …]    // для конвейера
```

### Трасса (`Trace`)

Движок `simulate(program) → Trace` выполняет программу целиком и записывает массив шагов; один шаг = такт × фаза:

```ts
interface TraceStep {
  cycle: number; phase: string;
  values: Record<SignalId, number>;   // значения видимых в этой фазе сигналов
  active: SignalId[];                 // сигналы на активном пути (подсветка)
  fresh: SignalId[];                  // вычисленные именно в этой фазе
  activeBlocks: BlockId[];
  stages: Record<string, StageSlot>;  // какая инструкция на какой стадии (+ uid, пометки stall/flush/forward)
  title, what, why: string;           // пояснения
  events: TraceEvent[];               // forward / stall / flush / regwrite / memwrite
  regs: number[]; mem: Record<number, number>;   // состояние после шага
  latching?, stalled?, flushed?: BlockId[];      // что делают регистры на фронте CLK
}
```

UI только проигрывает массив `steps`, поэтому перемотка назад — это просто уменьшение индекса.

### Как добавить микроархитектуру (другую главу)

1. Описать схему `MicroarchDef` в `src/arch/<id>/layout.ts` (помощники — в `arch/dsl.ts`).
2. Написать движок `simulate(program, opts): Trace` в `src/arch/<id>/engine.ts`.
3. Зарегистрировать `ArchModule` в `src/arch/index.ts`.
4. Тест `tests/layout.test.ts` автоматически проверит согласованность схемы и трассы.

Если нужен другой набор команд (например, MIPS из основной редакции книги), добавляется свой модуль в `src/isa/`;
`Program` и `Trace` от ISA не зависят.

## Соответствие книге и что проверить (TODO)

Логика блоков взята из гл. 7; места, где я не уверен в деталях текста, помечены в коде `TODO(книга)`:

- `src/isa/rv32i.ts` — таблица **Main Decoder**: в книге часть ячеек — `x` (don't care); здесь они заменены нулями
  (ImmSrc у R-type, ResultSrc у sw/beq, ALUSrc и ALUOp у jal). На поведение не влияет, но в окне Control Unit
  показаны нули вместо `x`.
- `src/isa/rv32i.ts` — **ALU Decoder** для неподдерживаемых `funct3` возвращает `add` (в книге не определено).
- `src/arch/riscv-pipelined/engine.ts` — **lwStall** записан буквально:
  `ResultSrcE[0] & ((Rs1D == RdE) | (Rs2D == RdE))`, без проверки, что Rs1D/Rs2D реально читаются
  (возможна «ложная» задержка, пояснение на схеме об этом говорит).
- Имя сигнала на входе регистра PC в конвейере показано как `PCF'` (в коде `PCFNext`), выход памяти команд — `InstrF`.
- Запись в регистровый файл в конвейере происходит «в первой половине такта» — в трассе это отражено тем, что
  регистр меняется уже в фазе «работа стадий», а Decode читает новое значение.
- Примеры программ собственные; кодировки `lw x6, -4(x9)`, `sw x6, 8(x9)`, `or x4, x5, x6`, `beq x4, x4, L7`
  сверены с машинными кодами из разд. 7.3 (см. `tests/engine.test.ts`).

## Вехи

- **M1** ✅ движок, однотактный и конвейерный процессоры с hazard-сценариями, слои, пошаговый режим, таймлайн.
- **M2** ✅ окна блоков с мини-анимациями, ввод своей программы.
- **M3** ⏳ многотактный процессор (сейчас заглушка), задел под другие главы — реестр `ArchModule`.
