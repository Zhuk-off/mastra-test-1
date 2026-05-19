import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { resolve, join } from 'node:path';
import { cleanSite, createBackup } from '../cleaners/index.js';

export const cleanSiteTool = createTool({
  id: 'clean-site',
  description:
    'Clean a downloaded landing page directory: removes trackers (GA, GTM, FB Pixel, Yandex Metrika, Hotjar, etc.), ' +
    'inline tracker scripts, noscripts, source maps, and external tracker directories. ' +
    'Creates a backup copy by default. Returns detailed stats on what was removed.',
  inputSchema: z.object({
    siteDir: z
      .string()
      .describe('Absolute or relative path to the downloaded site directory to clean'),
    noBackup: z
      .boolean()
      .optional()
      .describe('Set to true to skip creating a backup (default: false — backup is created)'),
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
    bytesBefore: z.number(),
    bytesAfter: z.number(),
    bytesReduced: z.number(),
    changelogPath: z.string().optional(),
  }),
  execute: async ({ siteDir, noBackup }) => {
    const resolvedDir = resolve(siteDir);

    let backupDir: string | undefined;
    if (!noBackup) {
      backupDir = await createBackup(resolvedDir);
    }

    const stats = await cleanSite(resolvedDir);

    return {
      siteDir: resolvedDir,
      backupDir,
      ...stats,
      bytesReduced: stats.bytesBefore - stats.bytesAfter,
      changelogPath:
        stats.jsFilesScanned > 0 || stats.cssFilesScanned > 0
          ? join(resolvedDir, 'clean-site-changes.log')
          : undefined,
    };
  },
});
