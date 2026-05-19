import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChangelogEntry } from '../types.ts';

export async function writeChangelog(siteDir: string, entries: ChangelogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const header = 'Файл | Строка | Тип изменения | Описание | Код';
  const sep = '-'.repeat(120);
  const rows = entries
    .map((e) => `${e.file} | ${e.lineNumber ?? '-'} | ${e.type} | ${e.description} | ${e.codeSnippet || '-'}`)
    .join('\n');
  const logPath = join(siteDir, 'clean-site-changes.log');
  await writeFile(logPath, header + '\n' + sep + '\n' + rows + '\n', 'utf8');
}
