/**
 * Каталог готовых программ. Каждая — обычный asm-текст (см. isa/assembler.ts),
 * начальное состояние задаётся директивами .reg / .word.
 */
export interface Example {
  id: string;
  title: string;
  /** Для каких микроархитектур пример показателен. */
  archs: string[];
  /** Что демонстрирует. */
  note: string;
  source: string;
}

const ALL = ['riscv-single', 'riscv-pipelined', 'riscv-multicycle'];
const PIPE = ['riscv-pipelined'];

export const EXAMPLES: Example[] = [
  {
    id: 'lw',
    title: 'lw — загрузка слова',
    archs: ALL,
    note: 'Пример из разд. 7.3.1: lw x6, -4(x9). Путь: PC → память команд → регистры → АЛУ (адрес) → память данных → запись в регистр.',
    source: `# x9 = 0x2004, в памяти по адресу 0x2000 лежит 10
.reg  x9, 0x2004
.word 0x2000, 10

lw x6, -4(x9)      # x6 = Mem[x9 - 4] = Mem[0x2000]
`,
  },
  {
    id: 'sw',
    title: 'sw — сохранение слова',
    archs: ALL,
    note: 'sw x6, 8(x9): адрес считает АЛУ, данные (rs2) идут в память в обход АЛУ. RegWrite=0.',
    source: `.reg x9, 0x2004
.reg x6, 10

sw x6, 8(x9)       # Mem[x9 + 8] = x6
`,
  },
  {
    id: 'add',
    title: 'R-type — or / add / sub',
    archs: ALL,
    note: 'Инструкции типа R: оба операнда из регистров (ALUSrc=0), результат АЛУ пишется в rd (ResultSrc=00).',
    source: `.reg x5, 6
.reg x6, 10

or  x4, x5, x6     # x4 = 6 | 10 = 14
add x7, x5, x6     # x7 = 16
sub x8, x6, x5     # x8 = 4
`,
  },
  {
    id: 'beq',
    title: 'beq — условный переход',
    archs: ALL,
    note: 'beq вычитает операнды в АЛУ: Zero=1 → PCSrc=1 → PC ← PCTarget. Первая beq не выполняется, вторая — выполняется.',
    source: `.reg x4, 14
.reg x5, 6

beq  x4, x5, skip   # 14 != 6 — не выполняется
addi x5, x5, 8      # x5 = 14
beq  x4, x5, skip   # 14 == 14 — выполняется
addi x6, x0, 1      # пропускается
skip:
addi x7, x0, 7      # x7 = 7
`,
  },
  {
    id: 'jal',
    title: 'jal — переход с сохранением адреса',
    archs: ALL,
    note: 'jal: PC ← PC + ImmExt, в rd записывается PC+4 (ResultSrc=10).',
    source: `jal  x1, func       # x1 = 4, переход на func
addi x5, x0, 1      # пропускается
func:
addi x6, x0, 2      # x6 = 2
`,
  },
  {
    id: 'book',
    title: 'Мини-программа (все типы)',
    archs: ALL,
    note: 'Небольшая программа со всеми поддерживаемыми типами инструкций — удобно для сквозной проверки.',
    source: `addi x2, x0, 5      # x2 = 5
addi x3, x0, 12     # x3 = 12
or   x4, x3, x2     # x4 = 13
and  x5, x3, x4     # x5 = 12
sw   x5, 96(x0)     # Mem[96] = 12
lw   x6, 96(x0)     # x6 = 12
beq  x6, x3, done   # выполняется
addi x7, x0, 99     # пропускается
done:
slt  x8, x2, x3     # x8 = 1
`,
  },
  {
    id: 'raw-forward',
    title: 'Конвейер: RAW + forwarding',
    archs: PIPE,
    note: 'Конфликт по данным (read-after-write): sub и or читают x8 сразу после add. Решается пересылкой из Memory (ForwardAE=10) и Writeback (ForwardBE=01).',
    source: `.reg x5, 3
.reg x6, 4
.reg x1, 10
.reg x3, 1

add x8, x5, x6     # x8 = 7
sub x2, x8, x3     # нужен x8: forward из Memory
or  x9, x1, x8     # нужен x8: forward из Writeback
and x10, x8, x1    # x8 уже записан (запись в 1-й половине такта)
`,
  },
  {
    id: 'lw-stall',
    title: 'Конвейер: lw-stall',
    archs: PIPE,
    note: 'Значение lw появляется только в конце Memory. Следующая инструкция, читающая этот регистр, задерживается на такт (StallF, StallD, FlushE), затем получает значение пересылкой из Writeback.',
    source: `.word 40, 21
.reg  x1, 1
.reg  x4, 3

lw  x7, 40(x0)     # x7 = Mem[40] = 21
and x8, x7, x1     # зависит от lw → задержка на 1 такт
or  x9, x4, x7     # forward из Writeback
sub x10, x7, x4
`,
  },
  {
    id: 'branch-flush',
    title: 'Конвейер: branch flush',
    archs: PIPE,
    note: 'Переход определяется в Execute. Две инструкции, выбранные за beq, отменяются (FlushD, FlushE) — штраф 2 такта.',
    source: `.reg x1, 5
.reg x2, 5

beq  x1, x2, target  # выполняется
addi x5, x0, 1       # отменяется (flush)
addi x6, x0, 2       # отменяется (flush)
addi x7, x0, 3       # не выбирается
target:
add  x8, x1, x2      # x8 = 10
addi x9, x8, 1       # forward из Memory
`,
  },
  {
    id: 'hazard-mix',
    title: 'Конвейер: всё вместе',
    archs: PIPE,
    note: 'Комбинация: forwarding, lw-stall и flush при переходе в одной программе (цикл из двух итераций).',
    source: `.word 0x40, 2
lw   x5, 0x40(x0)    # x5 = 2 (счётчик)
addi x6, x0, 0       # x6 = 0 (сумма)
loop:
beq  x5, x0, done    # lw-stall + forward, затем flush на выходе
add  x6, x6, x5
addi x5, x5, -1
jal  x0, loop        # flush двух инструкций
done:
sw   x6, 0x44(x0)    # Mem[0x44] = 3
`,
  },
];

export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}
