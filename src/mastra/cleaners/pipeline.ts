import { readFile, writeFile, cp, unlink, rm } from 'node:fs/promises';
import { extname, relative, basename, dirname, resolve, join } from 'node:path';
import type { CleanStats, HtmlPass, PassContext, HtmlStatsDelta, ChangelogEntry, CleanSiteOptions } from './types.js';
import { extractMainHostFromDir } from './utils/offer-detector.js';
import { walkFiles } from './utils/walk.js';
import { writeChangelog } from './utils/changelog.js';
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

// HTML passes
import { removeTrackerScripts } from './passes/html/remove-tracker-scripts.js';
import { removeTrackerJsonLd } from './passes/html/remove-tracker-jsonld.js';
import { removeInlineTrackers } from './passes/html/remove-inline-trackers.js';
import { removeInlineExfilPass } from './passes/html/remove-inline-exfil-pass.js';
import { removeNoscriptTrackers } from './passes/html/remove-noscript-trackers.js';
import { removeTrackerLinks } from './passes/html/remove-tracker-links.js';
import { removeTrackerMetas } from './passes/html/remove-tracker-metas.js';
import { removeMetaRefresh } from './passes/html/remove-meta-refresh.js';
import { removeTrackerIframes } from './passes/html/remove-tracker-iframes.js';
import { removeImgPixels } from './passes/html/remove-img-pixels.js';
import { removeBase } from './passes/html/remove-base.js';
import { removeObjectEmbed } from './passes/html/remove-object-embed.js';
import { removeFrames } from './passes/html/remove-frames.js';
import { replaceLocalLibsWithCdn } from './passes/html/replace-local-libs-with-cdn.js';
import { replaceOfferLinks } from './passes/html/replace-offer-links.js';
import { stripEventAttrs } from './passes/html/strip-event-attrs.js';

// Порядок ОБЯЗАН совпадать с порядком блоков 1..12 из оригинального cleanHtml
// (scripts/clean-site.ts до рефакторинга). Изменение порядка = поведенческий
// регресс. См. REFACTOR-CLEAN-SITE.md, раздел 7 (регрессионный diff).
const HTML_PASSES: HtmlPass[] = [
  removeTrackerScripts,      // 1: <script src>
  removeTrackerJsonLd,       // 2a: JSON-LD ветка
  removeInlineTrackers,      // 2b: остальные inline <script>
  removeInlineExfilPass,     // 2c: хирургическое удаление exfil из inline <script>
  removeNoscriptTrackers,    // 3: <noscript> ДО iframe — иначе GTM noscript-iframe осиротеет
  removeTrackerLinks,        // 4
  removeTrackerMetas,        // 5a
  removeMetaRefresh,         // 5b
  removeTrackerIframes,      // 6: <iframe src> на трекеры
  removeImgPixels,           // 7
  removeBase,                // 8
  removeObjectEmbed,         // 9+10
  removeFrames,              // frame + frameset + noframes
  replaceLocalLibsWithCdn,   // локальные библиотеки → CDN
  replaceOfferLinks,         // 11
  stripEventAttrs,           // 12
];

function applyHtmlPasses(html: string, ctx: PassContext): { html: string; counts: HtmlStatsDelta } {
  let currentHtml = html;
  const totalCounts: HtmlStatsDelta = {};

  for (const pass of HTML_PASSES) {
    const result = pass(currentHtml, ctx);
    currentHtml = result.html;
    for (const [key, value] of Object.entries(result.counts)) {
      if (value !== undefined) {
        totalCounts[key as keyof HtmlStatsDelta] = (totalCounts[key as keyof HtmlStatsDelta] ?? 0) + value;
      }
    }
  }

  // Финальная косметика — collapse тройных пустых строк
  currentHtml = currentHtml.replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n');

  return { html: currentHtml, counts: totalCounts };
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
    bytesBefore: 0,
    bytesAfter: 0,
    deadJsFilesRemoved: 0,
    partialJsCleaned: 0,
    inlineExfilRemoved: 0,
    unversionedLibsCdn: 0,
    metricFilesRemoved: 0,
    detectorWarnings: 0,
    obfuscatedFilesRemoved: 0,
    phpBackdoorWarning: false,
  };

  // Нормализуем структуру лендинга: находим главный файл, перемещаем в корень,
  // раскладываем ресурсы по папкам и переписываем пути.
  stats.normalize = await normalizeLandingStructure(siteDir);

  const changelog: ChangelogEntry[] = [];
  const mainHost = extractMainHostFromDir(siteDir);
  const metricFilesToDelete = new Set<string>();
  const obfuscatedFilesToDelete = new Set<string>();

  // Pre-scan: определяем библиотеки без версии в имени
  const unversionedLibMap = new Map<string, DetectedLib>();
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

  const unversionedLibFilesToDelete = new Set<string>();

  for await (const file of walkFiles(siteDir)) {
    const ext = extname(file).toLowerCase();
    const relPath = relative(siteDir, file);

    if (ext === '.html' || ext === '.htm' || ext === '.php') {
      const before = await readFile(file, 'utf8');
      stats.bytesBefore += before.length;

      const cdnReplacements = await buildCdnReplacements(siteDir, file, before);
      const unversionedLibReplacements = await buildUnversionedCdnReplacements(siteDir, file, before, unversionedLibMap);
      const ctx: PassContext = {
        siteDir,
        mainHost,
        filePath: file,
        relPath,
        log: changelog,
        cdnReplacements,
        unversionedLibReplacements,
      };

      const { html: after, counts } = applyHtmlPasses(before, ctx);
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

      if (ext === '.php') {
        stats.phpFilesProcessed++;
        // Stage 7: PHP backdoor scanning (WARN only)
        const phpWarnings = detectPhpBackdoors(before, relPath);
        if (phpWarnings.length > 0) {
          changelog.push(...phpWarnings);
          stats.phpBackdoorWarning = true;
          stats.detectorWarnings += phpWarnings.length;
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
      stats.inlineExfilRemoved += counts.inlineExfilRemoved ?? 0;
      continue;
    }

    if (ext === '.svg') {
      const removed = await cleanSvgFile(file);
      stats.svgFilesProcessed++;
      stats.svgItemsRemoved += removed;
      continue;
    }

    if (ext === '.js' || ext === '.mjs') {
      const result: CleanJsResult = await cleanJsFile(file, relPath, changelog, mainHost);
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
      const removed = await cleanCssFile(file, relPath, changelog);
      stats.cssFilesScanned++;
      stats.cssItemsRemoved += removed;
    }
  }

  // Удаляем метрик-файлы и чистим <script src> в HTML
  if (metricFilesToDelete.size > 0) {
    for (const absPath of metricFilesToDelete) {
      await unlink(absPath);
    }
    stats.metricFilesRemoved += metricFilesToDelete.size;

    // Удаляем <script src="..."> из HTML, ссылающиеся на удалённые файлы
    for await (const htmlFile of walkFiles(siteDir)) {
      const ext = extname(htmlFile).toLowerCase();
      if (ext !== '.html' && ext !== '.htm' && ext !== '.php') continue;
      const before = await readFile(htmlFile, 'utf8');
      let after = before;
      for (const absPath of metricFilesToDelete) {
        const rel = relative(siteDir, absPath);
        const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`<script[^>]*\\bsrc\\s*=\\s*["'](?:\\./)?/?${escaped}["'][^>]*>\\s*</script>`, 'gi');
        after = after.replace(re, '');
      }
      if (after !== before) {
        await writeFile(htmlFile, after, 'utf8');
      }
    }
  }

  // Удаляем обфусцированные JS-файлы и чистим <script src> в HTML
  if (obfuscatedFilesToDelete.size > 0) {
    for (const absPath of obfuscatedFilesToDelete) {
      await unlink(absPath);
    }
    stats.obfuscatedFilesRemoved += obfuscatedFilesToDelete.size;

    // Удаляем <script src="..."> из HTML, ссылающиеся на удалённые файлы
    for await (const htmlFile of walkFiles(siteDir)) {
      const ext = extname(htmlFile).toLowerCase();
      if (ext !== '.html' && ext !== '.htm' && ext !== '.php') continue;
      const before = await readFile(htmlFile, 'utf8');
      let after = before;
      for (const absPath of obfuscatedFilesToDelete) {
        const rel = relative(siteDir, absPath);
        const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`<script[^>]*\\bsrc\\s*=\\s*["'](?:\\./)?/?${escaped}["'][^>]*>\\s*</script>`, 'gi');
        after = after.replace(re, '');
      }
      if (after !== before) {
        await writeFile(htmlFile, after, 'utf8');
      }
    }
  }

  // Удаляем unversioned-lib файлы, заменённые на CDN, и чистим <script src> в HTML
  if (unversionedLibFilesToDelete.size > 0) {
    for (const absPath of unversionedLibFilesToDelete) {
      try {
        await unlink(absPath);
      } catch {
        // файл уже удалён или не существует — игнорируем
      }
    }
    stats.unversionedLibsCdn += unversionedLibFilesToDelete.size;

    // Удаляем <script src="..."> из HTML, ссылающиеся на удалённые файлы
    for await (const htmlFile of walkFiles(siteDir)) {
      const ext = extname(htmlFile).toLowerCase();
      if (ext !== '.html' && ext !== '.htm' && ext !== '.php') continue;
      const before = await readFile(htmlFile, 'utf8');
      let after = before;
      for (const absPath of unversionedLibFilesToDelete) {
        const rel = relative(siteDir, absPath);
        const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`<script[^>]*\\bsrc\\s*=\\s*["'](?:\\./)?/?${escaped}["'][^>]*>\\s*</script>`, 'gi');
        after = after.replace(re, '');
      }
      if (after !== before) {
        await writeFile(htmlFile, after, 'utf8');
      }
    }
  }

  // Удаляем папки _external/<tracker-host>/
  stats.externalDirsRemoved = await removeTrackerExternals(siteDir);

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

    const deadFilesToDelete = new Set<string>();
    for (const file of deadFiles) {
      if (!file.isDead) continue;
      const absPath = join(siteDir, file.relPath);
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
      deadFilesToDelete.add(absPath);
    }

    // Удаляем <script src="..."> из HTML, ссылающиеся на удалённые dead-файлы
    if (deadFilesToDelete.size > 0) {
      for await (const htmlFile of walkFiles(siteDir)) {
        const ext = extname(htmlFile).toLowerCase();
        if (ext !== '.html' && ext !== '.htm' && ext !== '.php') continue;
        const before = await readFile(htmlFile, 'utf8');
        let after = before;
        for (const absPath of deadFilesToDelete) {
          const rel = relative(siteDir, absPath);
          const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(`<script[^>]*\\bsrc\\s*=\\s*["'](?:\\./)?/?${escaped}["'][^>]*>\\s*</script>`, 'gi');
          after = after.replace(re, '');
        }
        if (after !== before) {
          await writeFile(htmlFile, after, 'utf8');
        }
      }
    }
  }

  // Пишем лог изменений
  await writeChangelog(siteDir, changelog);

  return stats;
}
