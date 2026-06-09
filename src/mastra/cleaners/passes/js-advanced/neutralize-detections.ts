import MagicString from 'magic-string';
import * as walk from 'acorn-walk';
import type { Program } from 'acorn';
import type { ChangelogEntry } from '../../types.js';
import type { DetectionResult } from './ast/types.js';

export interface NeutralizeResult {
  code: string;
  removed: number;
}

/**
 * Удаляет/нейтрализует узлы детекторов (exfil / redirect / keylogger / document.write)
 * из кода, НЕ ломая синтаксис:
 *  - самостоятельный statement (`fetch(evil);`, `location.href=...;`) — удаляется целиком;
 *  - вызов внутри выражения (`var x = fetch(evil)`, `a && fetch(evil)`) — заменяется на
 *    `void 0` (DEC-1), чтобы не оставить `var x = ;`.
 *
 * Перекрывающиеся/вложенные диапазоны схлопываются (например `fetch(evil)` внутри
 * keylogger-обработчика, который удаляем целиком; или `document.write`, который флагнули
 * сразу два детектора) — иначе MagicString упадёт на пересечении.
 */
export function neutralizeDetections(
  content: string,
  ast: Program,
  detections: DetectionResult[],
  log: ChangelogEntry[],
  relPath: string,
): NeutralizeResult {
  const toRemove = detections.filter((d) => d.shouldRemove);
  if (toRemove.length === 0) return { code: content, removed: 0 };

  // Дедуп вложенных/перекрывающихся: оставляем самые внешние непересекающиеся диапазоны.
  const ordered = [...toRemove].sort((a, b) => a.start - b.start || b.end - a.end);
  const ranges: DetectionResult[] = [];
  let lastEnd = -1;
  for (const d of ordered) {
    if (d.start >= lastEnd) {
      ranges.push(d);
      lastEnd = d.end;
    }
  }

  // Родитель каждого узла — чтобы понять, это statement (удалить целиком) или выражение (void 0).
  const parentByStart = new Map<number, any>();
  const record = (n: any, ancestors: any[]) => {
    parentByStart.set(n.start, ancestors[ancestors.length - 2]);
  };
  const visitors: any = {
    CallExpression: (n: any, _s: any, a: any[]) => record(n, a),
    NewExpression: (n: any, _s: any, a: any[]) => record(n, a),
    AssignmentExpression: (n: any, _s: any, a: any[]) => record(n, a),
  };
  walk.ancestor(ast, visitors);

  const ms = new MagicString(content);
  // От конца к началу (на исходных индексах MagicString порядок не критичен, но так нагляднее).
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  for (const d of sorted) {
    const parent = parentByStart.get(d.start);
    if (parent && parent.type === 'ExpressionStatement') {
      let end = d.end;
      while (end < content.length && /[;\s]/.test(content[end]!)) end++;
      ms.remove(d.start, end);
    } else {
      ms.overwrite(d.start, d.end, 'void 0');
    }
    log.push({
      file: relPath,
      type: d.threatType.toUpperCase(),
      description: d.description,
      codeSnippet: d.snippet,
      lineNumber: d.line,
    });
  }

  const result = ms.toString();
  return { code: result.trim().length === 0 ? '' : result, removed: ranges.length };
}
