import { readFile, writeFile } from 'node:fs/promises';
import type { ChangelogEntry, MacroFinding } from '../../types.js';
import { removeTrackerImports } from './remove-tracker-imports.js';
import { removeTrackerUrls } from './remove-tracker-urls.js';
import { scanCssFileMacros } from '../../utils/macro-scan.js';

export async function cleanCssFile(
  filePath: string,
  relPath: string,
  log: ChangelogEntry[],
  macros?: MacroFinding[],
): Promise<number> {
  const original = await readFile(filePath, 'utf8');
  let content = original;
  let removed = 0;

  // CSS-3/MAC-1: макросы во ВНЕШНЕМ .css (внутри url()) — в общую карту макросов.
  if (macros) macros.push(...scanCssFileMacros(original, relPath));

  const imports = removeTrackerImports(content, relPath, log);
  content = imports.content;
  removed += imports.removed;

  const urls = removeTrackerUrls(content, relPath, log);
  content = urls.content;
  removed += urls.removed;

  if (content !== original) await writeFile(filePath, content, 'utf8');
  return removed;
}
