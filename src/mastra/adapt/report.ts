import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AdaptBrief, AdaptStats } from './types.js';

/** Экранирует значение для вставки в ячейку Markdown-таблицы. */
function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 100);
}

/**
 * Человекочитаемый отчёт адаптации (safety-net, пишется всегда). Показывает бриф, счётчики,
 * предупреждения и список внесённых изменений (файл → элемент → было/стало).
 */
export async function writeAdaptReport(siteDir: string, brief: AdaptBrief, stats: AdaptStats): Promise<string> {
  const lines: string[] = [];
  lines.push('# Отчёт адаптации (этап 5)', '');
  lines.push('## Бриф', '');
  lines.push(`- Вертикаль (эффективная): \`${stats.vertical}\`${brief.vertical ? '' : ' (из дефолта конфига)'}`);
  lines.push(`- Конфиг: \`${stats.configSource === 'file' ? 'adapt.config.json' : 'встроенные дефолты'}\``);
  lines.push(`- Картинка: режим \`${brief.image?.mode ?? 'macro'}\`${brief.image?.file ? ` (file: \`${brief.image.file}\`)` : ''}`);
  lines.push(
    `- Имя: режим \`${brief.name?.mode ?? 'macro'}\`` +
      (brief.name?.productName ? `, productName: \`${brief.name.productName}\`` : '') +
      (brief.name?.aliases?.length ? `, aliases: \`${brief.name.aliases.join('`, `')}\`` : ''),
  );
  lines.push('');

  lines.push('## Итог', '');
  lines.push(`- HTML-файлов обработано: **${stats.htmlFilesProcessed}**`);
  lines.push(`- Картинок подставлено: **${stats.imagesReplaced}**`);
  lines.push(`- Имён заменено: **${stats.namesReplaced}**`);
  lines.push('');

  if (stats.warnings.length) {
    lines.push('## ⚠️ Предупреждения', '');
    for (const w of stats.warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  lines.push('## Изменения', '');
  if (stats.changes.length === 0) {
    lines.push('_Ничего не подставлено — проверьте бриф (вертикаль/productName) и наличие offer-якорей/макросов на лендинге._', '');
  } else {
    lines.push('| Файл | Проход | Элемент | Атрибут | Было | Стало | Триггер |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const c of stats.changes) {
      lines.push(
        `| ${cell(c.file)} | ${c.pass} | ${cell(c.element)} | ${cell(c.attr)} | ${cell(c.before)} | ${cell(c.after)} | ${c.trigger} |`,
      );
    }
    lines.push('');
  }

  const reportPath = join(siteDir, 'adapt-report.md');
  await writeFile(reportPath, lines.join('\n'), 'utf8');
  return reportPath;
}
