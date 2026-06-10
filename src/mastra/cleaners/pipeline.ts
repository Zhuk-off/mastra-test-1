import { readFile, writeFile, cp, unlink, rm } from 'node:fs/promises';
import { extname, relative, basename, dirname, resolve, join } from 'node:path';
import type { CleanStats, DomPass, PassContext, HtmlStatsDelta, ChangelogEntry, CleanSiteOptions, QuarantineItem, MacroFinding } from './types.js';
import { extractMainHostFromDir } from './utils/offer-detector.js';
import { walkFiles } from './utils/walk.js';
import { writeChangelog } from './utils/changelog.js';
import { parseHtml, serializeHtml, hasServerTags, stripServerTags } from './utils/html-dom.js';
import { isAbsoluteUrl } from './utils/allowlist.js';
import { writeQuarantine, quarantineFile } from './utils/quarantine.js';
import { writeCleanReport } from './utils/report.js';
import { cleanSvgFile } from './passes/svg/clean-svg.js';
import { cleanJsFile, type CleanJsResult } from './passes/js/clean-js.js';
import { cleanCssFile } from './passes/css/clean-css.js';
import { removeTrackerExternals } from './passes/fs/remove-tracker-externals.js';
import { buildCdnReplacements } from './utils/cdn-detector.js';
import { removeSourceMaps } from './passes/fs/remove-source-maps.js';
import { normalizeLandingStructure } from './utils/normalize-landing-structure.js';
import { detectUnversionedLib, type DetectedLib } from './passes/js-advanced/detectors/detect-unversioned-lib.js';
import { buildUnversionedCdnReplacements } from './utils/unversioned-cdn-detector.js';
import { collectCoverage } from './passes/js-advanced/coverage/collect-coverage.js';
import { analyzeDeadFiles } from './passes/js-advanced/coverage/analyze-coverage.js';
import { detectPhpBackdoors } from './passes/php/detect-php-backdoors.js';

// HTML passes (DOM/cheerio)
import { removeBase } from './passes/html/remove-base.js';
import { replaceLocalLibsWithCdn } from './passes/html/replace-local-libs-with-cdn.js';
import { removeTrackerScripts } from './passes/html/remove-tracker-scripts.js';
import { removeTrackerJsonLd } from './passes/html/remove-tracker-jsonld.js';
import { removeInlineTrackers } from './passes/html/remove-inline-trackers.js';
import { removeNoscriptTrackers } from './passes/html/remove-noscript-trackers.js';
import { cleanInlineCss } from './passes/html/clean-inline-css.js';
import { removeTrackerLinks } from './passes/html/remove-tracker-links.js';
import { removeTrackerMetas } from './passes/html/remove-tracker-metas.js';
import { removeMetaRefresh } from './passes/html/remove-meta-refresh.js';
import { removeTrackerIframes } from './passes/html/remove-tracker-iframes.js';
import { removeImgPixels } from './passes/html/remove-img-pixels.js';
import { removeObjectEmbed } from './passes/html/remove-object-embed.js';
import { removeFrames } from './passes/html/remove-frames.js';
import { stripDangerousHrefs } from './passes/html/strip-dangerous-hrefs.js';
import { replaceOfferLinks } from './passes/html/replace-offer-links.js';
import { detectMacros } from './passes/html/detect-macros.js';
import { stripEventAttrs } from './passes/html/strip-event-attrs.js';
import { injectCsp } from './passes/html/inject-csp.js';
import { removeInlineExfilPass } from './passes/html/remove-inline-exfil-pass.js';

/**
 * Порядок DOM-проходов. Ключевой момент: репин библиотек (replaceLocalLibsWithCdn)
 * идёт ДО allowlist-проходов — чтобы фиксируемая библиотека (даже с фейкового CDN)
 * превратилась в trusted-CDN URL и прошла белый список, а не ушла в карантин.
 */
const BASE_DOM_PASSES: DomPass[] = [
  removeBase,
  replaceLocalLibsWithCdn,   // репин → trusted CDN + SRI
  removeTrackerScripts,      // allowlist <script src>
  removeTrackerJsonLd,
  removeInlineTrackers,
  removeNoscriptTrackers,
  cleanInlineCss,            // трекер-url()/@import в inline <style>/style= (CSS-2)
  removeTrackerLinks,        // allowlist <link>
  removeTrackerMetas,
  removeMetaRefresh,
  removeTrackerIframes,      // allowlist <iframe src>
  removeImgPixels,           // allowlist <img src>
  removeObjectEmbed,
  removeFrames,
  stripDangerousHrefs,       // <a>/<area> href с опасной схемой (javascript:/data:) → нейтрализация (2D-6)
  replaceOfferLinks,
  detectMacros,              // макросы: наши — оставить, чужие — нормализовать/в отчёт
  stripEventAttrs,
  injectCsp,                 // CSP-страховка — последним проходом
];

/**
 * PHP-1: серверные страницы помимо `.php`. Их серверный код/бэкдоры тоже надо вырезать
 * (owner decision #2: чужой серверный код не используется → вырезать первым делом), иначе
 * `.phtml`/`.inc` уезжают в прод нетронутыми и даже не сканируются на бэкдоры. Обрабатываем
 * как HTML-страницу (→ stripServerTags + полная очистка + backdoor-скан), НО (кроме `.php`)
 * только если в файле реально есть серверные теги — иначе `.inc` может быть не-HTML фрагментом
 * (CSS/JS-партиал), и cheerio-обёртка его испортит.
 */
const PHP_PAGE_EXTRA_EXT = new Set(['.phtml', '.php5', '.php7', '.phps', '.inc']);

function getDomPasses(runAdvanced: boolean): DomPass[] {
  if (!runAdvanced) return BASE_DOM_PASSES;
  // Advanced: AST-хирургия inline exfil сразу после удаления inline-трекеров.
  const passes = [...BASE_DOM_PASSES];
  const idx = passes.indexOf(removeInlineTrackers);
  passes.splice(idx >= 0 ? idx + 1 : passes.length, 0, removeInlineExfilPass);
  return passes;
}

function applyHtmlPasses(
  html: string,
  ctx: PassContext,
  runAdvanced: boolean,
): { html: string; counts: HtmlStatsDelta; serverTagsStripped: boolean } {
  // Серверный код (PHP/ASP) НЕ останавливает очистку (политика владельца C2): чужой
  // серверный код мы не используем и он несёт риск — вырезаем его ПЕРВЫМ делом и чистим
  // файл полностью. Свой PHP (spysecure / форма) добавляется на этапе адаптации.
  let serverTagsStripped = false;
  if (hasServerTags(html)) {
    html = stripServerTags(html);
    serverTagsStripped = true;
    ctx.log.push({
      file: ctx.relPath,
      type: 'SERVER_TAGS_STRIPPED',
      description:
        'Серверные теги (<?php ?> / <% %>) удалены, файл очищен. Свой серверный код (spysecure / отправка формы) добавляется на этапе адаптации.',
    });
  }

  const $ = parseHtml(html);
  const totalCounts: HtmlStatsDelta = {};

  for (const pass of getDomPasses(runAdvanced)) {
    const counts = pass($, ctx);
    for (const [key, value] of Object.entries(counts)) {
      if (value !== undefined) {
        totalCounts[key as keyof HtmlStatsDelta] = (totalCounts[key as keyof HtmlStatsDelta] ?? 0) + value;
      }
    }
  }

  let currentHtml = serializeHtml($);
  // Финальная косметика — collapse тройных пустых строк
  currentHtml = currentHtml.replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n');

  return { html: currentHtml, counts: totalCounts, serverTagsStripped };
}

/**
 * PIPE-2: убирает из HTML ссылки на УДАЛЁННЫЕ файлы — одним DOM-проходом (cheerio),
 * а не 4 копиями regex. Regex промахивался на query-string (`x.js?v=3`), self-closing,
 * путях из подпапок (`../x.js`), нестандартных кавычках. Резолвит src/href относительно
 * расположения HTML и сверяет с множеством удалённых абсолютных путей. Серверные файлы
 * (hasServerTags) пропускает — их cheerio парсить нельзя (PIPE-4).
 */
export async function stripRefsToDeletedFiles(siteDir: string, deleted: Set<string>): Promise<void> {
  if (deleted.size === 0) return;
  for await (const htmlFile of walkFiles(siteDir)) {
    const ext = extname(htmlFile).toLowerCase();
    if (ext !== '.html' && ext !== '.htm' && ext !== '.php') continue;
    const before = await readFile(htmlFile, 'utf8');
    if (hasServerTags(before)) continue; // серверные файлы не трогаем (PIPE-4)

    const $ = parseHtml(before);
    const fileDir = dirname(htmlFile);
    let changed = false;
    const pointsToDeleted = (raw: string | undefined): boolean => {
      if (!raw || isAbsoluteUrl(raw)) return false;
      const fsUrl = raw.split('?')[0]!.split('#')[0]!;
      if (!fsUrl) return false;
      return deleted.has(resolve(fileDir, fsUrl));
    };

    $('script[src]').each((_i, el) => {
      if (pointsToDeleted($(el).attr('src'))) { $(el).remove(); changed = true; }
    });
    $('link[href]').each((_i, el) => {
      if (pointsToDeleted($(el).attr('href'))) { $(el).remove(); changed = true; }
    });
    $('img[src]').each((_i, el) => {
      if (pointsToDeleted($(el).attr('src'))) { $(el).remove(); changed = true; }
    });

    if (changed) await writeFile(htmlFile, serializeHtml($), 'utf8');
  }
}

export async function createBackup(siteDir: string): Promise<string> {
  const backupDir = siteDir.replace(/\/+$/, '') + '_backup';
  await cp(siteDir, backupDir, { recursive: true });
  return backupDir;
}

export async function cleanSite(siteDir: string, options?: CleanSiteOptions): Promise<CleanStats> {
  const stats: CleanStats = {
    htmlFilesProcessed: 0,
    phpFilesProcessed: 0,
    scriptsRemoved: 0,
    inlineScriptsRemoved: 0,
    noscriptsRemoved: 0,
    linksRemoved: 0,
    metasRemoved: 0,
    jsonLdRemoved: 0,
    imgPixelsRemoved: 0,
    metaRefreshRemoved: 0,
    baseHrefRemoved: 0,
    objectEmbedsRemoved: 0,
    framesRemoved: 0,
    localLibsReplaced: 0,
    eventAttrsRemoved: 0,
    svgFilesProcessed: 0,
    svgItemsRemoved: 0,
    jsFilesScanned: 0,
    jsItemsRemoved: 0,
    cssFilesScanned: 0,
    cssItemsRemoved: 0,
    externalDirsRemoved: 0,
    sourceMapsDeleted: 0,
    sourceMapRefsStripped: 0,
    offerLinksReplaced: 0,
    dangerousHrefsNeutralized: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    deadJsFilesRemoved: 0,
    partialJsCleaned: 0,
    inlineExfilRemoved: 0,
    unversionedLibsCdn: 0,
    metricFilesRemoved: 0,
    detectorWarnings: 0,
    obfuscatedFilesRemoved: 0,
    quarantinedItems: 0,
    macrosFlagged: 0,
    cspInjected: 0,
    phpBackdoorWarning: false,
    serverTagsFilesStripped: 0,
  };

  // Нормализуем структуру лендинга: находим главный файл, перемещаем в корень,
  // раскладываем ресурсы по папкам и переписываем пути.
  stats.normalize = await normalizeLandingStructure(siteDir);

  const changelog: ChangelogEntry[] = [];
  const quarantine: QuarantineItem[] = [];
  const macros: MacroFinding[] = [];
  const mainHost = extractMainHostFromDir(siteDir);
  const metricFilesToDelete = new Set<string>();
  const obfuscatedFilesToDelete = new Set<string>();
  // PIPE-2: абсолютные пути всех удалённых файлов — ссылки на них уберём одним DOM-проходом.
  const refStripTargets = new Set<string>();

  const runAdvanced = options?.runAdvanced ?? false;

  // Pre-scan: определяем библиотеки без версии в имени (только --advanced)
  const unversionedLibMap = new Map<string, DetectedLib>();
  if (runAdvanced) {
    for await (const file of walkFiles(siteDir)) {
      const ext = extname(file).toLowerCase();
      if (ext !== '.js' && ext !== '.mjs') continue;
      const base = basename(file);
      if (/[\d]+\.[\d]+\.[\d]+/.test(base)) continue; // версия в имени — обрабатывает cdn-detector
      const detected = await detectUnversionedLib(file);
      if (detected) {
        unversionedLibMap.set(relative(siteDir, file), detected);
      }
    }
  }

  const unversionedLibFilesToDelete = new Set<string>();

  for await (const file of walkFiles(siteDir)) {
    const ext = extname(file).toLowerCase();
    const relPath = relative(siteDir, file);

    // PIPE-3: изолируем обработку каждого файла — один кривой файл (битый JS/HTML, гонка по ФС)
    // не должен ронять весь прогон очистки. Ошибка фиксируется в логе, идём дальше.
    try {
    const isPhpPage = ext === '.php' || PHP_PAGE_EXTRA_EXT.has(ext); // PHP-1
    if (ext === '.html' || ext === '.htm' || isPhpPage) {
      const before = await readFile(file, 'utf8');
      // PHP-1: .phtml/.inc/... обрабатываем как страницу только при наличии серверных тегов —
      // иначе не-HTML .inc (CSS/JS-партиал) испортится cheerio-обёрткой. .php/.html — как раньше.
      if (PHP_PAGE_EXTRA_EXT.has(ext) && !hasServerTags(before)) continue;
      stats.bytesBefore += before.length;

      const cdnReplacements = await buildCdnReplacements(siteDir, file, before);
      const unversionedLibReplacements = await buildUnversionedCdnReplacements(siteDir, file, before, unversionedLibMap);
      const ctx: PassContext = {
        siteDir,
        mainHost,
        filePath: file,
        relPath,
        log: changelog,
        quarantine,
        macros,
        cdnReplacements,
        unversionedLibReplacements,
      };

      const { html: after, counts, serverTagsStripped } = applyHtmlPasses(before, ctx, runAdvanced);
      if (serverTagsStripped) stats.serverTagsFilesStripped++;
      if (after !== before) {
        await writeFile(file, after, 'utf8');
      }
      stats.bytesAfter += after.length;

      // Собираем unversioned-lib файлы, заменённые в этом HTML, для последующего удаления
      if (unversionedLibReplacements.size > 0) {
        const fileDir = dirname(file);
        for (const url of unversionedLibReplacements.keys()) {
          const absPath = resolve(fileDir, url);
          unversionedLibFilesToDelete.add(absPath);
        }
      }

      if (isPhpPage) {
        stats.phpFilesProcessed++;
        if (runAdvanced) {
          // Stage 7: PHP backdoor scanning (WARN only, requires --advanced). PHP-1: и для .phtml/.inc.
          const phpWarnings = detectPhpBackdoors(before, relPath);
          if (phpWarnings.length > 0) {
            changelog.push(...phpWarnings);
            stats.phpBackdoorWarning = true;
            stats.detectorWarnings += phpWarnings.length;
          }
        }
      } else {
        stats.htmlFilesProcessed++;
      }
      stats.scriptsRemoved += counts.scriptsRemoved ?? 0;
      stats.inlineScriptsRemoved += counts.inlineScriptsRemoved ?? 0;
      stats.noscriptsRemoved += counts.noscriptsRemoved ?? 0;
      stats.linksRemoved += counts.linksRemoved ?? 0;
      stats.metasRemoved += counts.metasRemoved ?? 0;
      stats.jsonLdRemoved += counts.jsonLdRemoved ?? 0;
      stats.imgPixelsRemoved += counts.imgPixelsRemoved ?? 0;
      stats.metaRefreshRemoved += counts.metaRefreshRemoved ?? 0;
      stats.baseHrefRemoved += counts.baseHrefRemoved ?? 0;
      stats.objectEmbedsRemoved += counts.objectEmbedsRemoved ?? 0;
      stats.framesRemoved += counts.framesRemoved ?? 0;
      stats.localLibsReplaced += counts.localLibsReplaced ?? 0;
      stats.eventAttrsRemoved += counts.eventAttrsRemoved ?? 0;
      stats.offerLinksReplaced += counts.offerLinksReplaced ?? 0;
      stats.dangerousHrefsNeutralized += counts.dangerousHrefsNeutralized ?? 0;
      stats.inlineExfilRemoved += counts.inlineExfilRemoved ?? 0;
      stats.cspInjected += counts.cspInjected ?? 0;
      continue;
    }

    if (ext === '.svg') {
      const removed = await cleanSvgFile(file);
      stats.svgFilesProcessed++;
      stats.svgItemsRemoved += removed;
      continue;
    }

    if (ext === '.js' || ext === '.mjs') {
      const result: CleanJsResult = await cleanJsFile(file, relPath, changelog, mainHost, runAdvanced, macros);
      stats.jsFilesScanned++;
      if (result.isObfuscated) {
        obfuscatedFilesToDelete.add(file);
        continue;
      }
      if (result.isMetricFile) {
        metricFilesToDelete.add(file);
        continue;
      }
      stats.jsItemsRemoved += result.removed;
      if (result.partialCleaned) stats.partialJsCleaned++;
      stats.detectorWarnings += result.detectorWarnings;
      continue;
    }

    if (ext === '.css') {
      const removed = await cleanCssFile(file, relPath, changelog, macros);
      stats.cssFilesScanned++;
      stats.cssItemsRemoved += removed;
    }
    } catch (err) {
      // PIPE-3: файл пропущен из-за ошибки — фиксируем в логе и продолжаем со следующим.
      changelog.push({
        file: relPath,
        type: 'FILE_SKIPPED_ERROR',
        description: `Файл пропущен из-за ошибки обработки: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Удаляем метрик-файлы (содержимое — в карантин). Ссылки уберём ниже одним DOM-проходом.
  if (metricFilesToDelete.size > 0) {
    for (const absPath of metricFilesToDelete) {
      // C5б: карантин (полное содержимое восстановимо) перед удалением с деплоя.
      await quarantineFile(absPath, siteDir, quarantine, 'js-metric', 'metric-файл (AST-сигнатура)');
      await unlink(absPath);
      refStripTargets.add(resolve(absPath));
    }
    stats.metricFilesRemoved += metricFilesToDelete.size;
  }

  // Удаляем обфусцированные JS-файлы (содержимое — в карантин). Ссылки уберём ниже.
  if (obfuscatedFilesToDelete.size > 0) {
    for (const absPath of obfuscatedFilesToDelete) {
      // C5б: карантин (полное содержимое восстановимо) перед удалением с деплоя.
      await quarantineFile(absPath, siteDir, quarantine, 'js-obfuscated', 'обфускация (_0x / packer / fromCharCode)');
      await unlink(absPath);
      refStripTargets.add(resolve(absPath));
    }
    stats.obfuscatedFilesRemoved += obfuscatedFilesToDelete.size;
  }

  // unversioned-lib файлы заменены на CDN в HTML; локальные оригиналы удаляем, остаточные ссылки уберём ниже.
  if (unversionedLibFilesToDelete.size > 0) {
    for (const absPath of unversionedLibFilesToDelete) {
      try {
        await unlink(absPath);
        refStripTargets.add(resolve(absPath));
      } catch {
        // файл уже удалён или не существует — игнорируем
      }
    }
    stats.unversionedLibsCdn += unversionedLibFilesToDelete.size;
  }

  // Папки _external/<host>/ — через белый список (трекер→удалить, чужой→карантин). EXT-1.
  stats.externalDirsRemoved = await removeTrackerExternals(siteDir, quarantine);

  // Удаляем source maps
  const { mapsDeleted, filesStripped } = await removeSourceMaps(siteDir);
  stats.sourceMapsDeleted = mapsDeleted;
  stats.sourceMapRefsStripped = filesStripped;

  // Coverage-based dead file detection (опционально)
  if (options?.runCoverage) {
    const coverages = await collectCoverage(siteDir);
    const deadFiles = analyzeDeadFiles(
      coverages,
      siteDir,
      options.deadCoverageThreshold ?? 1,
    );

    for (const file of deadFiles) {
      if (!file.isDead) continue;
      const absPath = join(siteDir, file.relPath);
      // COV-1/C5: coverage-эвристика FP-склонна (интерактивный/утилитный код лендинга
      // часто 0% за быстрый авто-прогон). Карантин (восстановимо) вместо тихого rm —
      // как для obfuscated/metric. Файл всё равно убираем с деплоя, но не теряем.
      await quarantineFile(absPath, siteDir, quarantine, 'js-dead-coverage', file.reason);
      try {
        await rm(absPath, { force: true });
      } catch {
        // ignore
      }
      stats.deadJsFilesRemoved++;
      changelog.push({
        file: file.relPath,
        type: 'DEAD_JS_FILE',
        description: file.reason,
      });
      refStripTargets.add(resolve(absPath));
    }
  }

  // PIPE-2: одним DOM-проходом убираем ссылки на ВСЕ удалённые файлы (metric/obfuscated/
  // unversioned/dead) — вместо 4 копий regex (промахи на query-string/self-close/../).
  await stripRefsToDeletedFiles(siteDir, refStripTargets);

  // Сбрасываем карантин на диск (после всех обходов файлов)
  await writeQuarantine(siteDir, quarantine);
  stats.quarantinedItems = quarantine.length;
  stats.macrosFlagged = macros.filter((m) => m.kind === 'image' || m.kind === 'other' || m.kind === 'script').length;

  // Пишем лог изменений + человекочитаемый отчёт
  await writeChangelog(siteDir, changelog);
  await writeCleanReport(siteDir, stats, changelog, quarantine, macros);

  return stats;
}
