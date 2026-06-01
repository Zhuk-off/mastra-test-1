/**
 * Человекочитаемый отчёт об очистке: что удалено, что репиннуто, что в карантине
 * (требует ревью), какие предупреждения. Это и есть «ассистент выносит решения
 * человеку» — главное для гибрид-политики.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CleanStats, ChangelogEntry, QuarantineItem } from '../types.js';

function countByType(log: ChangelogEntry[], type: string): ChangelogEntry[] {
  return log.filter((e) => e.type === type);
}

export function renderReport(
  stats: CleanStats,
  log: ChangelogEntry[],
  quarantine: QuarantineItem[],
): string {
  const L: string[] = [];
  L.push('# Отчёт очистки лендинга', '');

  // Итог
  L.push('## Итог', '');
  L.push(`- Библиотек репиннуто на офиц. CDN (+SRI): **${stats.localLibsReplaced}**`);
  L.push(`- <script src> удалено/в карантин: **${stats.scriptsRemoved}**`);
  L.push(`- inline-скриптов удалено (трекеры): **${stats.inlineScriptsRemoved}**`);
  L.push(`- inline exfil-вызовов вырезано: **${stats.inlineExfilRemoved}**`);
  L.push(`- картинок-пикселей удалено/в карантин: **${stats.imgPixelsRemoved}**`);
  L.push(`- <object>/<embed>/<frame> удалено: **${stats.objectEmbedsRemoved + stats.framesRemoved}**`);
  L.push(`- оффер-ссылок → {offer}: **${stats.offerLinksReplaced}**`);
  L.push(`- CSP внедрён (файлов): **${stats.cspInjected}**`);
  L.push(`- JS-файлов: obfuscated удалено ${stats.obfuscatedFilesRemoved}, metric удалено ${stats.metricFilesRemoved}`);
  L.push('');

  // Карантин — самое важное
  if (quarantine.length > 0) {
    L.push(`## ⚠️ Карантин — ${quarantine.length} шт. (НУЖНО РЕВЬЮ)`, '');
    L.push('Вырезано со страницы (она безопасна), сохранено в `_quarantine/`. Проверьте — если ложное срабатывание, верните вручную.', '');
    for (const q of quarantine) {
      L.push(`- **[${q.kind}]** \`${q.file}\` — ${q.reason}`);
    }
    L.push('');
  } else {
    L.push('## Карантин', '', '_Пусто — всё классифицировано однозначно._', '');
  }

  // Репин
  const repins = countByType(log, 'LIB_REPINNED');
  if (repins.length > 0) {
    L.push('## Репин библиотек', '');
    for (const r of repins) L.push(`- ${r.description}${r.codeSnippet ? ` \`${r.codeSnippet}\`` : ''}`);
    L.push('');
  }

  // Предупреждения детекторов (advanced): redirect/keylogger/php
  const warnTypes = ['REDIRECT_WARN', 'KEYLOGGER_WARN', 'PHP_BACKDOOR', 'JS предупреждение', 'SKIP_DOM'];
  const warnings = log.filter((e) => warnTypes.includes(e.type));
  if (warnings.length > 0) {
    L.push(`## ⚠️ Предупреждения — ${warnings.length} шт. (проверьте)`, '');
    for (const w of warnings.slice(0, 100)) {
      L.push(`- **${w.type}** \`${w.file}\`${w.lineNumber ? `:${w.lineNumber}` : ''} — ${w.description}`);
    }
    L.push('');
  }

  if (stats.phpBackdoorWarning) {
    L.push('## 🚨 PHP-бэкдоры', '', 'Обнаружены подозрительные PHP-конструкции. Требуется ручная проверка.', '');
  }

  return L.join('\n') + '\n';
}

export async function writeCleanReport(
  siteDir: string,
  stats: CleanStats,
  log: ChangelogEntry[],
  quarantine: QuarantineItem[],
): Promise<string> {
  const path = join(siteDir, 'clean-report.md');
  await writeFile(path, renderReport(stats, log, quarantine), 'utf8');
  return path;
}
