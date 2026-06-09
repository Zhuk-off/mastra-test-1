import { readFile, writeFile } from 'node:fs/promises';
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
import { detectExfilCalls } from '../js-advanced/detectors/detect-exfil-calls.js';
import { neutralizeDetections } from '../js-advanced/neutralize-detections.js';

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
  runAdvanced = false,
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

  if (runAdvanced) {
    // Stage 7: detect obfuscation — delete entire file if detected (only --advanced)
    if (detectObfuscation(content)) {
      log.push({
        file: relPath,
        type: 'OBFUSCATED_JS',
        description: 'Файл изолирован в карантин: обфускация (_0x переменные / eval packer / fromCharCode)',
        lineNumber: 1,
      });
      return { removed: 0, partialCleaned: false, isMetricFile: false, isObfuscated: true, detectorWarnings: 0 };
    }

    let ast = parseJs(content, relPath);
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
        // CJS-1: content мутировал → позиции старого AST невалидны. Перепарсим,
        // иначе detectDocWriteScript режет MagicString по смещённым позициям
        // (порча файла или "Character is out of bounds").
        ast = parseJs(content, relPath);
      }
    }

    // exfil/redirect/keylogger/document.write — на АКТУАЛЬНОМ ast (после extractUsefulFunctions).
    // Редирект на чужой хост и keylogger у владельца не легит → нейтрализуем (не WARN).
    // Удаление reference-safe (DEC-1): statement убирается целиком, вызов в выражении → void 0.
    if (ast) {
      const detCtx = { source: content, relPath, mainHost };
      const detections = [
        ...detectExfilCalls(ast, detCtx),
        ...detectRedirect(ast, detCtx),
        ...detectKeylogger(ast, content),
        ...detectDocWriteScript(ast, detCtx),
      ];
      const neutralized = neutralizeDetections(content, ast, detections, log, relPath);
      if (neutralized.removed > 0) {
        content = neutralized.code;
        removed += neutralized.removed;
      }
    }
  }

  if (content !== original) await writeFile(filePath, content, 'utf8');
  return { removed, partialCleaned: removed > 0, isMetricFile: false, isObfuscated: false, detectorWarnings };
}
