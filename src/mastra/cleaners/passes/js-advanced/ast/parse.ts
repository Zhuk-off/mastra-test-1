import * as acorn from 'acorn';
import type { Program } from 'acorn';

/** Парсит JS-строку, возвращает AST или null (с предупреждением). */
export function parseJs(source: string, filePath: string): Program | null {
  // Пробуем module, потом script — лендинги бывают разные
  for (const sourceType of ['module', 'script'] as const) {
    try {
      return acorn.parse(source, {
        ecmaVersion: 2024,
        sourceType,
        // Важно: locations нужны для вычисления номера строки
        locations: true,
        // Если синтаксис сломан — не падаем, возвращаем null
        onInsertedSemicolon: () => {},
        onTrailingComma: () => {},
      });
    } catch {
      // Пробуем следующий sourceType
    }
  }
  // Если оба упали — файл не парсится (обфусцированный / минифицированный без пробелов)
  console.warn(`[js-advanced] Не удалось распарсить: ${filePath}`);
  return null;
}

/** Извлекает 1-indexed номер строки по символьной позиции */
export function posToLine(source: string, pos: number): number {
  return source.slice(0, pos).split('\n').length;
}

/** Безопасный срез кода для лога (≤ 200 символов) */
export function snippetAt(source: string, start: number, end: number): string {
  return source.slice(start, Math.min(end, start + 200)).replace(/\s+/g, ' ').trim();
}
