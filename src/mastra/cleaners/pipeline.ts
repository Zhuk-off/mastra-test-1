import { readFile, writeFile, cp } from 'node:fs/promises';
import { extname, relative } from 'node:path';
import type { CleanStats, HtmlPass, PassContext, HtmlStatsDelta, ChangelogEntry } from './types.js';
import { extractMainHostFromDir } from './utils/offer-detector.js';
import { walkFiles } from './utils/walk.js';
import { writeChangelog } from './utils/changelog.js';
import { cleanSvgFile } from './passes/svg/clean-svg.js';
import { cleanJsFile } from './passes/js/clean-js.js';
import { cleanCssFile } from './passes/css/clean-css.js';
import { removeTrackerExternals } from './passes/fs/remove-tracker-externals.js';
import { buildCdnReplacements } from './utils/cdn-detector.js';
import { removeSourceMaps } from './passes/fs/remove-source-maps.js';
import { normalizeLandingStructure } from './utils/normalize-landing-structure.js';

// HTML passes
import { removeTrackerScripts } from './passes/html/remove-tracker-scripts.js';
import { removeTrackerJsonLd } from './passes/html/remove-tracker-jsonld.js';
import { removeInlineTrackers } from './passes/html/remove-inline-trackers.js';
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

export async function cleanSite(siteDir: string): Promise<CleanStats> {
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
  };

  // Нормализуем структуру лендинга: находим главный файл, перемещаем в корень,
  // раскладываем ресурсы по папкам и переписываем пути.
  stats.normalize = await normalizeLandingStructure(siteDir);

  const changelog: ChangelogEntry[] = [];
  const mainHost = extractMainHostFromDir(siteDir);

  for await (const file of walkFiles(siteDir)) {
    const ext = extname(file).toLowerCase();
    const relPath = relative(siteDir, file);

    if (ext === '.html' || ext === '.htm' || ext === '.php') {
      const before = await readFile(file, 'utf8');
      stats.bytesBefore += before.length;

      const cdnReplacements = await buildCdnReplacements(siteDir, file, before);
      const ctx: PassContext = {
        siteDir,
        mainHost,
        filePath: file,
        relPath,
        log: changelog,
        cdnReplacements,
      };

      const { html: after, counts } = applyHtmlPasses(before, ctx);
      if (after !== before) {
        await writeFile(file, after, 'utf8');
      }
      stats.bytesAfter += after.length;

      if (ext === '.php') {
        stats.phpFilesProcessed++;
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
      continue;
    }

    if (ext === '.svg') {
      const removed = await cleanSvgFile(file);
      stats.svgFilesProcessed++;
      stats.svgItemsRemoved += removed;
      continue;
    }

    if (ext === '.js' || ext === '.mjs') {
      const removed = await cleanJsFile(file, relPath, changelog);
      stats.jsFilesScanned++;
      stats.jsItemsRemoved += removed;
      continue;
    }

    if (ext === '.css') {
      const removed = await cleanCssFile(file, relPath, changelog);
      stats.cssFilesScanned++;
      stats.cssItemsRemoved += removed;
    }
  }

  // Удаляем папки _external/<tracker-host>/
  stats.externalDirsRemoved = await removeTrackerExternals(siteDir);

  // Удаляем source maps
  const { mapsDeleted, filesStripped } = await removeSourceMaps(siteDir);
  stats.sourceMapsDeleted = mapsDeleted;
  stats.sourceMapRefsStripped = filesStripped;

  // Пишем лог изменений
  await writeChangelog(siteDir, changelog);

  return stats;
}
