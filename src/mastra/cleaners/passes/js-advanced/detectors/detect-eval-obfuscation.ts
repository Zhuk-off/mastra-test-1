import * as walk from 'acorn-walk';
import type { Program, Node } from 'acorn';
import type { DetectionResult, DetectorContext } from '../ast/types.js';
import { posToLine, snippetAt } from '../ast/parse.js';
import { isGlobalCallee, obfuscatedDecoderIn, extractStringish, referencedGlobalName } from './helpers.js';

/** Литерал ≥40 base64-символов (как старый regex `eval("<base64>")`). */
function isLongBase64Literal(node: any): boolean {
  const s = extractStringish(node);
  return !!s && /^[A-Za-z0-9+/]{40,}={0,2}$/.test(s.trim());
}

/**
 * Аргумент «обфусцирован»: содержит декодер (atob/unescape/String.fromCharCode — через
 * obfuscatedDecoderIn) или является длинным base64-литералом. Гейт по обфускации исключает
 * FP на легит `eval`/`Function('return this')`/`setTimeout(fn)`.
 */
function argObfuscated(node: any): boolean {
  if (!node) return false;
  return obfuscatedDecoderIn(node) !== null || isLongBase64Literal(node);
}

/** `(0, eval)(x)` / `(0, window.eval)(x)` — callee = SequenceExpression, последнее звено = eval. */
function isSequenceEval(callee: any): boolean {
  if (callee?.type !== 'SequenceExpression') return false;
  const exprs = callee.expressions;
  return referencedGlobalName(exprs[exprs.length - 1]) === 'eval';
}

/**
 * Узел — обфусцированный sink исполнения кода:
 *  - `eval(...)` / `window.eval` / `window['eval']` / `(0,eval)(...)`;
 *  - `Function(...)` / `new Function(...)`;
 *  - `setTimeout`/`setInterval(<code>, …)` (первый аргумент — код),
 * где соответствующий аргумент обфусцирован. Закрывает EVAL-1 (узкая старая регулярка ловила
 * только `eval(atob|unescape|decodeURIComponent(...))` / `eval("<base64>")`).
 */
function isObfuscatedEvalSink(n: any): boolean {
  if (n.type === 'NewExpression') {
    return isGlobalCallee(n.callee, 'Function') && (n.arguments ?? []).some(argObfuscated);
  }
  if (n.type === 'CallExpression') {
    const callee = n.callee;
    if (isGlobalCallee(callee, 'eval') || isSequenceEval(callee) || isGlobalCallee(callee, 'Function')) {
      return (n.arguments ?? []).some(argObfuscated);
    }
    if (isGlobalCallee(callee, 'setTimeout') || isGlobalCallee(callee, 'setInterval')) {
      return (n.arguments?.length ?? 0) > 0 && argObfuscated(n.arguments[0]);
    }
  }
  return false;
}

/**
 * Detects obfuscated dynamic code execution (EVAL-1/EVAL-2) — AST вместо regex.
 *
 * shouldRemove:true; reference-safe нейтрализация → `var x = eval(atob(...))` становится
 * `var x = void 0` (старый regex вырезал `eval(...)` и оставлял `var x = ;` — битый JS,
 * который дальше ронял parseJs и глушил весь advanced-анализ, EVAL-2/CJS-4).
 */
export function detectEvalObfuscation(ast: Program, ctx: DetectorContext): DetectionResult[] {
  const results: DetectionResult[] = [];
  const { source } = ctx;

  const handle = (n: any, ancestors: any[]): void => {
    if (!isObfuscatedEvalSink(n)) return;
    // IIFE `new Function(obf)()` / `Function(obf)()`: флагаем ВНЕШНИЙ вызов целиком, иначе
    // нейтрализация выражения оставит `void 0()`.
    let target = n;
    const parent = ancestors[ancestors.length - 2];
    if (parent?.type === 'CallExpression' && parent.callee === n) target = parent;
    results.push({
      line: posToLine(source, target.start),
      start: target.start,
      end: target.end,
      threatType: 'eval-obfuscation',
      description: 'Обфусцированное исполнение кода (eval/Function/timer с atob/base64)',
      snippet: snippetAt(source, target.start, target.end),
      shouldRemove: true,
      node: target,
    });
  };

  walk.ancestor(ast, {
    CallExpression(n: any, _s: any, a: any[]) {
      handle(n, a);
    },
    NewExpression(n: any, _s: any, a: any[]) {
      handle(n, a);
    },
  });

  return results;
}
