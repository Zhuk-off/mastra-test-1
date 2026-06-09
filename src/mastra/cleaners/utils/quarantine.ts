/**
 * Контейнмент: вместо тихого удаления сомнительного — кладём в карантин и
 * выносим человеку в отчёт. Удаляем с живой страницы (она становится безопасной),
 * но сохраняем оригинал (можно восстановить, если ложное срабатывание).
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { PassContext, QuarantineItem } from '../types.js';

/** Пишет запись в changelog (видимые изменения). */
export function logChange(
  ctx: PassContext,
  type: string,
  description: string,
  snippet?: string,
): void {
  ctx.log.push({ file: ctx.relPath, type, description, codeSnippet: snippet });
}

/** Удаляет узел и кладёт его в карантин + лог. */
export function quarantineNode(
  $: CheerioAPI,
  el: Element,
  ctx: PassContext,
  kind: string,
  reason: string,
): void {
  const snippet = ($.html(el) || '').slice(0, 2000);
  (ctx.quarantine ??= []).push({ reason, snippet, file: ctx.relPath, kind });
  ctx.log.push({
    file: ctx.relPath,
    type: 'QUARANTINE',
    description: `[${kind}] ${reason}`,
    codeSnippet: snippet.slice(0, 300),
  });
  $(el).remove();
}

/**
 * Кладёт ВЕСЬ файл в карантин: сохраняет полное содержимое (восстановимо) как
 * QuarantineItem. Сам файл НЕ удаляет — это делает вызывающий код (карантин = убрать
 * с деплоя, но сохранить). Распространяет HTML-принцип «карантин вместо тихого
 * удаления» на JS-файлы (C5б: obfuscated/metric раньше просто unlink-ались).
 */
export async function quarantineFile(
  absPath: string,
  siteDir: string,
  quarantine: QuarantineItem[],
  kind: string,
  reason: string,
): Promise<void> {
  let snippet = '';
  try {
    snippet = await readFile(absPath, 'utf8');
  } catch {
    return; // файла нет — нечего сохранять
  }
  quarantine.push({
    kind,
    reason,
    snippet,
    file: relative(siteDir, absPath).replace(/\\/g, '/'),
  });
}

/** Сбрасывает карантин на диск: _quarantine/NNN-<kind>.txt + INDEX.md. */
export async function writeQuarantine(
  siteDir: string,
  items: QuarantineItem[],
): Promise<void> {
  if (items.length === 0) return;
  const dir = join(siteDir, '_quarantine');
  await mkdir(dir, { recursive: true });

  const indexLines: string[] = [
    `# Карантин — ${items.length} элемент(ов). Требуют ревью человеком.`,
    '',
    'Эти фрагменты ВЫРЕЗАНЫ с живой страницы (она безопасна), но сохранены здесь.',
    'Если что-то оказалось ложным срабатыванием — верните вручную.',
    '',
  ];

  let i = 0;
  for (const item of items) {
    i++;
    const fileName = `${String(i).padStart(3, '0')}-${item.kind}.txt`;
    const body =
      `Файл:    ${item.file}\n` +
      `Тип:     ${item.kind}\n` +
      `Причина: ${item.reason}\n\n` +
      `--- вырезанный фрагмент ---\n${item.snippet}\n`;
    await writeFile(join(dir, fileName), body, 'utf8');
    indexLines.push(`- [${item.kind}] ${item.file} — ${item.reason} → \`_quarantine/${fileName}\``);
  }

  await writeFile(join(dir, 'INDEX.md'), indexLines.join('\n') + '\n', 'utf8');
}
