import MagicString from 'magic-string';
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

  const ms = new MagicString(scriptContent);

  // Удаляем от конца к началу — чтобы позиции не сдвигались
  const sorted = [...toRemove].sort((a, b) => b.start - a.start);

  for (const detection of sorted) {
    // Удаляем весь statement (включая ; и перенос строки)
    let end = detection.end;
    // Захватываем trailing ; и пробелы
    while (end < scriptContent.length && /[;\s]/.test(scriptContent[end]!)) end++;
    ms.remove(detection.start, end);

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
