import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { resolve, join } from 'node:path';
import { cleanSite, createBackup } from '../cleaners/index.js';

export const cleanSiteTool = createTool({
  id: 'clean-site',
  description:
    'Очистка скачанного лендинга по модели БЕЛОГО СПИСКА: внешние ресурсы остаются только с доверенных CDN/вашей инфраструктуры; ' +
    'библиотеки репинятся на официальный CDN + SRI; известные трекеры удаляются; ' +
    'сомнительные внешние ресурсы — в карантин (_quarantine/) для ревью человеком; внедряется CSP-страховка. ' +
    'Глубокий AST-анализ JS (обфускация/exfil) включён по умолчанию. Делает бэкап. ' +
    'ВАЖНО: если quarantinedItems > 0 или phpBackdoorWarning — покажи это пользователю и не выгружай молча.',
  inputSchema: z.object({
    siteDir: z
      .string()
      .describe('Absolute or relative path to the downloaded site directory to clean'),
    noBackup: z
      .boolean()
      .optional()
      .describe('Set to true to skip creating a backup (default: false — backup is created)'),
    advanced: z
      .boolean()
      .optional()
      .default(true)
      .describe('AST-анализ JS (metric/obfuscation/exfil). По умолчанию ВКЛЮЧЁН. Отключать только для отладки.'),
    runCoverage: z
      .boolean()
      .optional()
      .default(false)
      .describe('Run Playwright coverage analysis to detect dead JS files'),
  }),
  outputSchema: z.object({
    siteDir: z.string(),
    backupDir: z.string().optional(),
    htmlFilesProcessed: z.number(),
    phpFilesProcessed: z.number(),
    scriptsRemoved: z.number(),
    inlineScriptsRemoved: z.number(),
    noscriptsRemoved: z.number(),
    linksRemoved: z.number(),
    metasRemoved: z.number(),
    jsonLdRemoved: z.number(),
    imgPixelsRemoved: z.number(),
    metaRefreshRemoved: z.number(),
    baseHrefRemoved: z.number(),
    objectEmbedsRemoved: z.number(),
    framesRemoved: z.number(),
    eventAttrsRemoved: z.number(),
    svgFilesProcessed: z.number(),
    svgItemsRemoved: z.number(),
    jsFilesScanned: z.number(),
    jsItemsRemoved: z.number(),
    cssFilesScanned: z.number(),
    cssItemsRemoved: z.number(),
    externalDirsRemoved: z.number(),
    sourceMapsDeleted: z.number(),
    sourceMapRefsStripped: z.number(),
    offerLinksReplaced: z.number(),
    localLibsReplaced: z.number(),
    bytesBefore: z.number(),
    bytesAfter: z.number(),
    bytesReduced: z.number(),
    deadJsFilesRemoved: z.number(),
    partialJsCleaned: z.number(),
    inlineExfilRemoved: z.number(),
    unversionedLibsCdn: z.number(),
    metricFilesRemoved: z.number(),
    obfuscatedFilesRemoved: z.number(),
    quarantinedItems: z.number(),
    macrosFlagged: z.number(),
    cspInjected: z.number(),
    detectorWarnings: z.number(),
    phpBackdoorWarning: z.boolean(),
    serverTagsFilesStripped: z.number(),
    changelogPath: z.string().optional(),
    quarantineDir: z.string().optional(),
    /** CST-1: путь к человекочитаемому отчёту (safety-net) — всегда пишется. */
    reportPath: z.string(),
  }),
  execute: async ({ siteDir, noBackup, advanced, runCoverage }) => {
    const resolvedDir = resolve(siteDir);

    let backupDir: string | undefined;
    if (!noBackup) {
      backupDir = await createBackup(resolvedDir);
    }

    const stats = await cleanSite(resolvedDir, {
      runAdvanced: advanced ?? true,
      runCoverage: runCoverage ?? false,
    });

    return {
      siteDir: resolvedDir,
      backupDir,
      ...stats,
      bytesReduced: stats.bytesBefore - stats.bytesAfter,
      changelogPath:
        stats.jsFilesScanned > 0 || stats.cssFilesScanned > 0
          ? join(resolvedDir, 'clean-site-changes.log')
          : undefined,
      quarantineDir: stats.quarantinedItems > 0 ? join(resolvedDir, '_quarantine') : undefined,
      // CST-1: отчёт пишется всегда (writeCleanReport) — отдаём путь, чтобы safety-net не терялся.
      reportPath: join(resolvedDir, 'clean-report.md'),
    };
  },
});
