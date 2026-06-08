import MagicString from 'magic-string';
import * as walk from 'acorn-walk';
import type { Program } from 'acorn';
import { detectExfilCalls } from './detectors/detect-exfil-calls.js';
import type { DetectorContext } from './ast/types.js';
import type { ChangelogEntry } from '../../types.js';

export interface InlineExfilResult {
  code: string;
  removed: number;
}

export function removeInlineExfil(
  scriptContent: string,
  ctx: DetectorContext,
  ast: Program,
  log: ChangelogEntry[],
): InlineExfilResult {
  const detections = detectExfilCalls(ast, ctx);
  const toRemove = detections.filter((d) => d.shouldRemove);

  if (toRemove.length === 0) return { code: scriptContent, removed: 0 };

  // DEC-1 (T-9): detectExfilCalls отдаёт позиции САМОГО вызова, не охватывающего
  // statement. Удалить `fetch(evil)` из `var x = fetch(evil)` → `var x = ;` (битый
  // JS, рушит весь inline-скрипт). Поэтому запоминаем родителя каждого узла: если
  // вызов — самостоятельный statement, удаляем его целиком; иначе нейтрализуем
  // подстановкой `void 0` (сохраняет синтаксис: `var x = void 0`, `a && void 0`).
  const parentByStart = new Map<number, any>();
  const record = (n: any, ancestors: any[]) => {
    parentByStart.set(n.start, ancestors[ancestors.length - 2]);
  };
  const ancestorVisitors: any = {
    CallExpression: (n: any, _s: any, a: any[]) => record(n, a),
    NewExpression: (n: any, _s: any, a: any[]) => record(n, a),
    AssignmentExpression: (n: any, _s: any, a: any[]) => record(n, a),
  };
  walk.ancestor(ast, ancestorVisitors);

  const ms = new MagicString(scriptContent);

  // Удаляем от конца к началу — чтобы позиции не сдвигались
  const sorted = [...toRemove].sort((a, b) => b.start - a.start);

  for (const detection of sorted) {
    const parent = parentByStart.get(detection.start);
    if (parent && parent.type === 'ExpressionStatement') {
      // Вызов — самостоятельный statement → убираем целиком (с trailing ; и пробелами).
      let end = detection.end;
      while (end < scriptContent.length && /[;\s]/.test(scriptContent[end]!)) end++;
      ms.remove(detection.start, end);
    } else {
      // Вызов внутри выражения (var x = …, a && …, foo(…)) → нейтрализуем,
      // не ломая синтаксис окружения.
      ms.overwrite(detection.start, detection.end, 'void 0');
    }

    log.push({
      file: ctx.relPath,
      type: detection.threatType.toUpperCase(),
      description: detection.description,
      codeSnippet: detection.snippet,
      lineNumber: detection.line,
    });
  }

  const result = ms.toString();
  // Если после удаления остался только пустой/пробельный блок — вернуть пустую строку
  const isEmpty = result.trim().length === 0;
  return { code: isEmpty ? '' : result, removed: toRemove.length };
}
