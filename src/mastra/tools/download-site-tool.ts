import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { downloadSite } from '../../../scripts/download-site';

const DOWNLOADS_BASE = './downloads';

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
    totalSaved: z.number(),
  }),
  execute: async ({ url }) => {
    const result = await downloadSite(url);

    return {
      ...result,
      totalSaved: result.phase1.saved + result.phase2.saved,
    };
  },
});
