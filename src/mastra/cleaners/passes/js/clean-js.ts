import { readFile, writeFile } from 'node:fs/promises';
import type { ChangelogEntry } from '../../types.js';
import { removeServiceWorker } from './remove-service-worker.js';
import { removeEvalObfuscation } from './remove-eval-obfuscation.js';
import { warnSuspiciousPatterns } from './warn-suspicious-patterns.js';
import { parseJs } from '../js-advanced/ast/parse.js';
import { detectMetricFile } from '../js-advanced/detectors/detect-metric-file.js';

export async function cleanJsFile(
  filePath: string,
  relPath: string,
  log: ChangelogEntry[],
): Promise<number> {
  const original = await readFile(filePath, 'utf8');
  let content = original;
  let removed = 0;

  const sw = removeServiceWorker(content, relPath, log);
  content = sw.content;
  removed += sw.removed;

  const evalObf = removeEvalObfuscation(content, relPath, log);
  content = evalObf.content;
  removed += evalObf.removed;

  warnSuspiciousPatterns(content, relPath, log);

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
      // Маркер для pipeline: файл — метрик-файл, нужно удалить
      return 9999;
    }
  }

  if (content !== original) await writeFile(filePath, content, 'utf8');
  return removed;
}
