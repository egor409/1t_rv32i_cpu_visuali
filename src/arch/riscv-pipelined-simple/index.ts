/** Упрощённый конвейер («Просто»): та же модель «схема + трасса», но только главное. */
import type { ArchModule } from '../../core/types';
import { simulateSimple } from './engine';
import { buildSimpleDef } from './layout';

/** Демо-программа без конфликтов: сложение, вычитание, чтение и запись в память. */
export const SIMPLE_PROGRAM = `.reg x1, 5
.reg x2, 7
.word 32, 42

add  x3, x1, x2
sub  x4, x2, x1
lw   x5, 32(x0)
addi x6, x1, 10
sw   x3, 36(x0)
`;

export const simplePipelined: ArchModule = {
  def: buildSimpleDef(false),
  summary: 'Пять станций конвейера без подробностей: видно, как команды едут одна за другой.',
  simulate: simulateSimple,
  examples: [],
};

export { buildSimpleDef };
