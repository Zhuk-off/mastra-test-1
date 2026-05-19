import { readFile, writeFile } from 'node:fs/promises';
import type { ChangelogEntry } from '../../types.js';
import { removeServiceWorker } from './remove-service-worker.js';
import { removeEvalObfuscation } from './remove-eval-obfuscation.js';
import { warnSuspiciousPatterns } from './warn-suspicious-patterns.js';

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

  if (content !== original) await writeFile(filePath, content, 'utf8');
  return removed;
}
