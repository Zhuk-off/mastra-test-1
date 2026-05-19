import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { join, dirname, resolve } from 'node:path';
import { downloadSite } from '../../../scripts/download-site';

/**
 * Mastra dev server starts the process with cwd=src/mastra/public/,
 * so relative paths resolve there instead of the project root.
 * MASTRA_PACKAGES_FILE is injected by Mastra and points to
 * <project-root>/.mastra/mastra-packages.json — go one level up from its
 * dirname to reach the actual project root.
 * Falls back to process.cwd() when running scripts manually (no Mastra env).
 */
function getProjectRoot(): string {
  if (process.env.MASTRA_PACKAGES_FILE) {
    return resolve(dirname(process.env.MASTRA_PACKAGES_FILE), '..');
  }
  return process.cwd();
}

const DOWNLOADS_BASE = join(getProjectRoot(), 'downloads');

export const downloadSiteTool = createTool({
  id: 'download-site',
  description:
    'Download a landing page as a self-contained local copy using Playwright headless Chromium. ' +
    'Captures all assets (HTML, CSS, JS, images, fonts) via network interception, ' +
    'downloads missing assets discovered in HTML/CSS, and rewrites absolute URLs to relative paths. ' +
    `Files are always saved to ${DOWNLOADS_BASE}/<hostname>/. ` +
    'The exact output directory path is returned in the response — use it for subsequent tools (e.g. clean-site).',
  inputSchema: z.object({
    url: z
      .string()
      .url()
      .describe('Full URL of the landing page to download (must start with http:// or https://)'),
  }),
  outputSchema: z.object({
    outputDir: z.string(),
    phase1: z.object({
      saved: z.number(),
      skipped: z.number(),
      failed: z.number(),
      byType: z.record(z.string(), z.number()),
    }),
    phase2: z.object({
      saved: z.number(),
      failed: z.number(),
    }),
    phase3: z.object({
      rewrittenFiles: z.number(),
    }),
    phase4: z.object({
      urlsFixed: z.number(),
      missingReport: z.array(z.object({
        file: z.string(),
        url: z.string(),
        type: z.enum(['external-no-local', 'local-missing']),
        suggestion: z.string().optional(),
      })),
      reportPath: z.string(),
    }),
    totalSaved: z.number(),
  }),
  execute: async ({ url }) => {
    const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_');
    const outputDir = join(DOWNLOADS_BASE, hostname);
    const result = await downloadSite(url, outputDir);

    return {
      outputDir: result.outputDir,
      phase1: result.phase1,
      phase2: result.phase2,
      phase3: result.phase3,
      phase4: result.phase4,
      totalSaved: result.phase1.saved + result.phase2.saved,
    };
  },
});
