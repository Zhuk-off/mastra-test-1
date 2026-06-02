/**
 * Человекочитаемый отчёт об очистке: что удалено, что репиннуто, что в карантине
 * (требует ревью), какие предупреждения. Это и есть «ассистент выносит решения
 * человеку» — главное для гибрид-политики.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CleanStats, ChangelogEntry, QuarantineItem, MacroFinding } from '../types.js';

function countByType(log: ChangelogEntry[], type: string): ChangelogEntry[] {
  return log.filter((e) => e.type === type);
}

export function renderReport(
  stats: CleanStats,
  log: ChangelogEntry[],
  quarantine: QuarantineItem[],
  macros: MacroFinding[] = [],
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
  L.push(`- чужих макросов на ревью: **${stats.macrosFlagged}**`);
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

  // Карта макросов
  if (macros.length > 0) {
    const links = macros.filter((m) => m.kind === 'link');
    const images = macros.filter((m) => m.kind === 'image');
    const texts = macros.filter((m) => m.kind === 'text');
    const scripts = macros.filter((m) => m.kind === 'script');
    const other = macros.filter((m) => m.kind === 'other');
    const own = macros.filter((m) => m.kind === 'own');
    L.push(`## Макросы — карта (${macros.length})`, '');
    L.push('Этап очистки: наши макросы оставлены, чужие в ссылках → `{offer}`. Подстановку продуктового изображения/названия делает этап адаптации (Adult/WeightLoss).', '');
    if (links.length) {
      L.push('**Ссылки → `{offer}`:**');
      for (const m of links) L.push(`- \`${m.file}\` <${m.element}> — было: ${m.token}`);
      L.push('');
    }
    if (images.length) {
      L.push('**Изображения — подставить продуктовый макрос на этапе адаптации:**');
      for (const m of images) L.push(`- \`${m.file}\` <${m.element} ${m.attr}> — ${m.token}`);
      L.push('');
    }
    if (texts.length) {
      L.push('**Текстовые макросы трекера (удалены):**');
      for (const m of texts) L.push(`- \`${m.file}\` — ${m.token}`);
      L.push('');
    }
    if (scripts.length) {
      L.push('**Макросы в JS (проверить — возможна подмена ссылок):**');
      for (const m of scripts) L.push(`- \`${m.file}\` <script> — ${m.token}`);
      L.push('');
    }
    if (other.length) {
      L.push('**Прочие чужие макросы — проверить вручную:**');
      for (const m of other) L.push(`- \`${m.file}\` <${m.element} ${m.attr}> — ${m.token}`);
      L.push('');
    }
    if (own.length) L.push(`**Наши макросы (оставлены без изменений): ${own.length}**`, '');
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
  macros: MacroFinding[] = [],
): Promise<string> {
  const path = join(siteDir, 'clean-report.md');
  await writeFile(path, renderReport(stats, log, quarantine, macros), 'utf8');
  return path;
}
