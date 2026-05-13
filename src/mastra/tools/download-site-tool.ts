import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { downloadSite } from '../../../scripts/download-site';

export const downloadSiteTool = createTool({
  id: 'download-site',
  description:
    'Download a landing page as a self-contained local copy using Playwright headless Chromium. ' +
    'Captures all assets (HTML, CSS, JS, images, fonts) via network interception, ' +
    'downloads missing assets discovered in HTML/CSS, and rewrites absolute URLs to relative paths. ' +
    'Returns the output directory path and download statistics.',
  inputSchema: z.object({
    url: z
      .string()
      .url()
      .describe('Full URL of the landing page to download (must start with http:// or https://)'),
    outputDir: z
      .string()
      .optional()
      .describe(
        'Directory to save the downloaded site. Defaults to ./downloads/<hostname> if not provided',
      ),
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
  execute: async ({ url, outputDir }) => {
    const result = await downloadSite(url, outputDir);

    return {
      ...result,
      totalSaved: result.phase1.saved + result.phase2.saved,
    };
  },
});
