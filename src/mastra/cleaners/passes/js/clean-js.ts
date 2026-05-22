import { readFile, writeFile } from 'node:fs/promises';
import MagicString from 'magic-string';
import type { ChangelogEntry } from '../../types.js';
import { removeServiceWorker } from './remove-service-worker.js';
import { removeEvalObfuscation } from './remove-eval-obfuscation.js';
import { warnSuspiciousPatterns } from './warn-suspicious-patterns.js';
import { parseJs } from '../js-advanced/ast/parse.js';
import { detectMetricFile } from '../js-advanced/detectors/detect-metric-file.js';
import { extractUsefulFunctions } from '../js-advanced/extract-useful-functions.js';
import { detectObfuscation } from '../js-advanced/detectors/detect-obfuscation.js';
import { detectKeylogger } from '../js-advanced/detectors/detect-keylogger.js';
import { detectRedirect } from '../js-advanced/detectors/detect-redirect.js';
import { detectDocWriteScript } from '../js-advanced/detectors/detect-document-write-script.js';

export interface CleanJsResult {
  removed: number;
  partialCleaned: boolean;
  isMetricFile: boolean;
  isObfuscated: boolean;
  detectorWarnings: number;
}

export async function cleanJsFile(
  filePath: string,
  relPath: string,
  log: ChangelogEntry[],
  mainHost = '',
): Promise<CleanJsResult> {
  const original = await readFile(filePath, 'utf8');
  let content = original;
  let removed = 0;
  let detectorWarnings = 0;

  const sw = removeServiceWorker(content, relPath, log);
  content = sw.content;
  removed += sw.removed;

  const evalObf = removeEvalObfuscation(content, relPath, log);
  content = evalObf.content;
  removed += evalObf.removed;

  warnSuspiciousPatterns(content, relPath, log);

  // Stage 7: detect obfuscation — delete entire file if detected
  if (detectObfuscation(content)) {
    log.push({
      file: relPath,
      type: 'OBFUSCATED_JS',
      description: 'Файл удалён: обнаружена обфускация (_0x переменные / eval packer / fromCharCode)',
      lineNumber: 1,
    });
    return { removed: 0, partialCleaned: false, isMetricFile: false, isObfuscated: true, detectorWarnings: 0 };
  }

  const ast = parseJs(content, relPath);
  if (ast) {
    const check = detectMetricFile(ast, content);
    if (check.isMetricFile) {
      log.push({
        file: relPath,
        type: 'METRIC_FILE',
        description: check.reason,
        lineNumber: 1,
      });
      return { removed: 0, partialCleaned: false, isMetricFile: true, isObfuscated: false, detectorWarnings: 0 };
    }

    // Вырезаем функции, которые только делают exfil-вызовы (Stage 6)
    const ctx = { source: content, relPath, mainHost };
    const extracted = extractUsefulFunctions(content, ast, ctx, log);
    if (extracted.removed > 0) {
      content = extracted.code;
      removed += extracted.removed;
    }

    // Stage 7: detect keylogger — WARN only
    const keyloggerResults = detectKeylogger(ast, content);
    for (const r of keyloggerResults) {
      log.push({
        file: relPath,
        type: 'KEYLOGGER_WARN',
        description: r.description,
        codeSnippet: r.snippet,
        lineNumber: r.line,
      });
      detectorWarnings++;
    }

    // Stage 7: detect redirect — WARN only
    const redirectResults = detectRedirect(ast, { source: content, relPath, mainHost });
    for (const r of redirectResults) {
      log.push({
        file: relPath,
        type: 'REDIRECT_WARN',
        description: r.description,
        codeSnippet: r.snippet,
        lineNumber: r.line,
      });
      detectorWarnings++;
    }

    // Stage 7: detect document.write(<script src="...">) — remove
    const docWriteResults = detectDocWriteScript(ast, { source: content, relPath, mainHost });
    const toRemove = docWriteResults.filter(r => r.shouldRemove);
    if (toRemove.length > 0) {
      const ms = new MagicString(content);
      // Sort descending to avoid position shifts
      const sorted = [...toRemove].sort((a, b) => b.start - a.start);
      for (const r of sorted) {
        let end = r.end;
        while (end < content.length && /[;\s]/.test(content[end]!)) end++;
        ms.remove(r.start, end);
        log.push({
          file: relPath,
          type: r.threatType.toUpperCase(),
          description: r.description,
          codeSnippet: r.snippet,
          lineNumber: r.line,
        });
        removed++;
      }
      content = ms.toString();
    }
  }

  if (content !== original) await writeFile(filePath, content, 'utf8');
  return { removed, partialCleaned: removed > 0, isMetricFile: false, isObfuscated: false, detectorWarnings };
}
