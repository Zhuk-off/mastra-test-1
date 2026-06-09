import * as walk from 'acorn-walk';
import MagicString from 'magic-string';
import type { Program, Node } from 'acorn';
import { detectExfilCalls } from './detectors/detect-exfil-calls.js';
import type { DetectorContext } from './ast/types.js';
import type { ChangelogEntry } from '../../types.js';
import { posToLine, snippetAt } from './ast/parse.js';

/** Признаки DOM-операций — функции с ними не удаляем */
const DOM_PATTERNS = [
  'querySelector',
  'getElementById',
  'getElementsBy',
  'innerHTML',
  'outerHTML',
  'textContent',
  'createElement',
  'appendChild',
  'insertBefore',
  'removeChild',
];

function hasDomOperations(bodySource: string): boolean {
  return DOM_PATTERNS.some((p) => bodySource.includes(p));
}

/** Собирает все CallExpression-узлы внутри заданного узла */
function collectCallsInNode(node: Node): Node[] {
  const calls: Node[] = [];
  walk.simple(node, {
    CallExpression(callNode: Node) {
      calls.push(callNode);
    },
  });
  return calls;
}

export interface ExtractResult {
  code: string;
  removed: number;
}

/**
 * Вырезает из JS-кода функции, которые **только** делают exfil-вызовы
 * (трекерные глобалы, fetch/beacon на внешние хосты) и не содержат
 * ничего полезного (DOM-операции, обработчики, бизнес-логика).
 *
 * Консервативная стратегия: при малейших сомнениях — оставляем.
 */
export function extractUsefulFunctions(
  source: string,
  ast: Program,
  ctx: DetectorContext,
  log: ChangelogEntry[],
): ExtractResult {
  // 1. Запускаем detectExfilCalls один раз на весь файл
  const exfilResults = detectExfilCalls(ast, ctx);
  if (exfilResults.length === 0) return { code: source, removed: 0 };

  // Множество начальных позиций exfil-вызовов для быстрого поиска
  const exfilStartSet = new Set(exfilResults.map((r) => r.start));

  // EUF-1: ссылки на функцию по имени. Если на pure-exfil функцию где-то ссылаются
  // (вызов, обработчик, setInterval), удалять ОБЪЯВЛЕНИЕ нельзя — `track is not defined`
  // оборвёт скрипт и весь код после. Тогда обнуляем ТЕЛО (символ жив, exfil исчезает).
  // Если ссылок нет — удаляем целиком (как раньше).
  const identOccurrences: Array<{ name: string; start: number }> = [];
  walk.simple(ast, {
    Identifier(n: Node) {
      const id = n as any;
      identOccurrences.push({ name: id.name, start: id.start });
    },
  });
  const isReferencedElsewhere = (name: string, declIdStart: number): boolean =>
    identOccurrences.some((o) => o.name === name && o.start !== declIdStart);

  const toRemove: Array<{
    outerStart: number;
    outerEnd: number;
    bodyStart: number;
    bodyEnd: number;
    name: string;
    referenced: boolean;
  }> = [];

  /**
   * Проверяет, является ли функция «чисто-exfil» — все её call-выражения
   * являются exfil-вызовами, нет DOM-операций.
   *
   * @param outerNode  — весь узел (FunctionDeclaration / VariableDeclaration)
   *                     используется для получения исходного кода + позиций
   * @param bodyNode   — тело функции (BlockStatement)
   * @param name       — имя функции для лога
   */
  function checkFunctionNode(outerNode: any, bodyNode: any, name: string, declIdStart: number): void {
    if (!bodyNode?.body || !Array.isArray(bodyNode.body)) return;
    if (bodyNode.body.length === 0) return;

    // 2. Все вызовы внутри функции — exfil-вызовы?
    const allCalls = collectCallsInNode(bodyNode as Node);
    if (allCalls.length === 0) return; // нет вызовов → тривиальная функция, skip

    const allCallsAreExfil = allCalls.every((callNode) => {
      const c = callNode as any;
      return exfilStartSet.has(c.start);
    });

    if (!allCallsAreExfil) return; // смешанная логика → оставляем

    // 3. Нет DOM-операций
    const bodySource = source.slice(outerNode.start, outerNode.end);
    if (hasDomOperations(bodySource)) return;

    // 4. Все условия выполнены → к удалению (или обнулению тела, если есть ссылки — EUF-1)
    toRemove.push({
      outerStart: outerNode.start,
      outerEnd: outerNode.end,
      bodyStart: bodyNode.start,
      bodyEnd: bodyNode.end,
      name,
      referenced: isReferencedElsewhere(name, declIdStart),
    });
  }

  walk.simple(ast, {
    FunctionDeclaration(node: Node) {
      const fn = node as any;
      const name = fn.id?.name ?? '<anonymous>';
      checkFunctionNode(fn, fn.body, name, fn.id?.start ?? -1);
    },

    VariableDeclaration(node: Node) {
      const decl = node as any;
      // Обрабатываем только одиночные декларации: var foo = function() { ... }
      if (!decl.declarations || decl.declarations.length !== 1) return;
      const declarator = decl.declarations[0] as any;
      const init = declarator?.init as any;
      if (!init) return;
      if (init.type !== 'FunctionExpression' && init.type !== 'ArrowFunctionExpression') return;
      // Arrow с expression body (e.g. `() => fbq(...)`) — пропускаем,
      // так как bodyNode не BlockStatement и не содержит .body
      if (init.expression === true || !init.body?.body) return;

      const name = declarator.id?.name ?? '<anonymous>';
      checkFunctionNode(decl, init.body, name, declarator.id?.start ?? -1);
    },
  });

  if (toRemove.length === 0) return { code: source, removed: 0 };

  const ms = new MagicString(source);

  // Удаляем от конца к началу — чтобы позиции не сдвигались
  const sorted = [...toRemove].sort((a, b) => b.outerStart - a.outerStart);

  for (const item of sorted) {
    if (item.referenced) {
      // EUF-1: на функцию ссылаются → сохраняем символ, обнуляем тело (нет ReferenceError).
      ms.overwrite(item.bodyStart, item.bodyEnd, '{}');
      log.push({
        file: ctx.relPath,
        type: 'PARTIAL_JS_CLEAN',
        description: `Тело обнулено (только трекер-вызовы, символ сохранён): ${item.name}`,
        codeSnippet: snippetAt(source, item.outerStart, item.outerEnd),
        lineNumber: posToLine(source, item.outerStart),
      });
    } else {
      // Захватываем trailing ; и пробелы/переносы строк
      let end = item.outerEnd;
      while (end < source.length && /[;\s]/.test(source[end]!)) end++;
      ms.remove(item.outerStart, end);
      log.push({
        file: ctx.relPath,
        type: 'PARTIAL_JS_CLEAN',
        description: `Удалена функция с только трекерными вызовами: ${item.name}`,
        codeSnippet: snippetAt(source, item.outerStart, item.outerEnd),
        lineNumber: posToLine(source, item.outerStart),
      });
    }
  }

  const result = ms.toString();
  const isEmpty = result.trim().length === 0;
  return { code: isEmpty ? '' : result, removed: toRemove.length };
}
