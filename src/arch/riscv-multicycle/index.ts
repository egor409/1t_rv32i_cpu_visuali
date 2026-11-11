/** Многотактный процессор (разд. 7.4): схема + движок по состояниям управляющего автомата. */
import type { ArchModule } from '../../core/types';
import { simulateMulticycle } from './engine';
import { multicycleDef } from './layout';

export const multicycle: ArchModule = {
  def: multicycleDef,
  summary: 'Инструкция за 3–5 коротких тактов; управляет конечный автомат, АЛУ и память используются повторно.',
  simulate: simulateMulticycle,
  examples: ['lw', 'sw', 'add', 'beq', 'jal', 'book'],
};
