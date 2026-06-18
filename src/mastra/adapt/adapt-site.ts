import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { walkFiles } from '../cleaners/utils/walk.js';
import { parseHtml, serializeHtml, hasServerTags } from '../cleaners/utils/html-dom.js';
import { replaceProductImage } from './passes/replace-product-image.js';
import { replaceProductName } from './passes/replace-product-name.js';
import { resolveImageTarget, resolveNameReplacement, resolveVertical } from './targets.js';
import { loadAdaptConfig } from './config.js';
import { writeAdaptReport } from './report.js';
import type { AdaptBrief, AdaptChange, AdaptContext, AdaptPass, AdaptStats } from './types.js';

/** Порядок проходов адаптации: картинка → имя. */
const ADAPT_PASSES: AdaptPass[] = [replaceProductImage, replaceProductName];

export interface AdaptSiteOptions {
  /** Путь к adapt.config.json. По умолчанию — `<cwd>/adapt.config.json` (нет файла → встроенные дефолты). */
  configPath?: string;
}

/**
 * Оркестратор этапа 5. Прогоняет проходы адаптации по всем HTML-страницам УЖЕ очищенного
 * лендинга, подставляя продуктовые значения под оффер (бриф поверх adapt.config.json), и пишет
 * adapt-report.md.
 *
 * Запускать ПОСЛЕ cleanSite()+verify. ВАЖНО: после адаптации НЕ запускать локальный verify —
 * макросы раскрываются только на трекере (Keitaro) при отдаче; локально картинки «битые», это норма.
 * Серверные файлы (PHP/ASP) пропускаются.
 */
export async function adaptSite(siteDir: string, brief: AdaptBrief, options?: AdaptSiteOptions): Promise<AdaptStats> {
  const loaded = await loadAdaptConfig({ configPath: options?.configPath });
  const config = loaded.config;
  const vertical = resolveVertical(brief, config);

  const changes: AdaptChange[] = [];
  const stats: AdaptStats = {
    htmlFilesProcessed: 0,
    imagesReplaced: 0,
    namesReplaced: 0,
    vertical,
    configSource: loaded.source,
    warnings: [...loaded.warnings],
    changes,
    reportPath: join(siteDir, 'adapt-report.md'),
  };

  // Предполётные предупреждения.
  const imageMode = brief.image?.mode ?? 'macro';
  const nameMode = brief.name?.mode ?? 'macro';
  if (imageMode === 'macro' && !config.verticals[vertical]) {
    stats.warnings.push(
      `Картинка: вертикаль «${vertical}» не описана в конфиге (нет imageBase) — картинки не тронуты. ` +
        `Известные вертикали: ${Object.keys(config.verticals).join(', ') || '(нет)'}.`,
    );
  } else if (imageMode !== 'skip' && resolveImageTarget(brief, config) === null) {
    stats.warnings.push('Картинка: режим «file», но не задан `image.file` — картинки не тронуты.');
  }
  const nameRepl = resolveNameReplacement(brief, config);
  if (nameMode !== 'skip' && nameRepl === null) {
    stats.warnings.push('Имя: не задан `name.productName` (и нечего re-point\'ить) — названия не тронуты.');
  }
  // literal-режим неидемпотентен, если строка-замена содержит искомое название (повторный прогон раздул бы текст).
  if (nameMode === 'literal' && nameRepl && nameRepl.names.some((n) => nameRepl.target.toLowerCase().includes(n.toLowerCase()))) {
    stats.warnings.push(
      'Имя: режим «literal», и строка-замена содержит искомое название — повторный прогон adaptSite раздул бы текст. ' +
        'Прогоняйте один раз или выберите literal без вхождения productName.',
    );
  }

  for await (const file of walkFiles(siteDir)) {
    const ext = extname(file).toLowerCase();
    if (ext !== '.html' && ext !== '.htm') continue;
    const before = await readFile(file, 'utf8');
    if (hasServerTags(before)) continue; // защитно: серверный код cheerio не парсит

    const ctx: AdaptContext = { siteDir, relPath: relative(siteDir, file), brief, config, changes };
    const $ = parseHtml(before);

    let imagesReplaced = 0;
    let namesReplaced = 0;
    for (const pass of ADAPT_PASSES) {
      const delta = pass($, ctx);
      imagesReplaced += delta.imagesReplaced ?? 0;
      namesReplaced += delta.namesReplaced ?? 0;
    }

    const after = serializeHtml($);
    if (after !== before) await writeFile(file, after, 'utf8');

    stats.htmlFilesProcessed++;
    stats.imagesReplaced += imagesReplaced;
    stats.namesReplaced += namesReplaced;
  }

  // Пост-предупреждения: подстановка запрошена, но ничего не нашли.
  if (imageMode !== 'skip' && resolveImageTarget(brief, config) !== null && stats.imagesReplaced === 0) {
    stats.warnings.push(
      'Картинки не подставлены: не найдено ни offer-якоря `<a href="{offer}">` с `<img>`, ни чужого макроса в `src`, ' +
        'ни нашего прежнего URL для re-point. Если продуктовая картинка есть, но без якоря — нужна эвристика (шаг 5.5).',
    );
  }
  if (nameMode !== 'skip' && nameRepl !== null && stats.namesReplaced === 0) {
    stats.warnings.push('Название не встретилось в тексте лендинга — проверьте `productName` (точное написание/алиасы).');
  }

  await writeAdaptReport(siteDir, brief, stats);
  return stats;
}
