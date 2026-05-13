import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { downloadSiteTool } from '../tools/download-site-tool';
import { cleanSiteTool } from '../tools/clean-site-tool';
import { createAgentMemory } from '../memory';

/**
 * Working-memory schema for the Landing Agent.
 *
 * The agent fills these fields via the auto-injected `updateWorkingMemory`
 * tool as the user works through download -> clean -> report. This way it
 * can answer follow-up questions like "clean the previous site" or
 * "what was the URL we downloaded?" without re-asking.
 *
 * Schema uses MERGE semantics: the agent only provides fields it wants to
 * update; existing fields are preserved. Set a field to `null` to clear it.
 */
const landingWorkingMemorySchema = z.object({
  lastUrl: z.string().url().optional().describe('Most recent landing-page URL the user asked to download.'),
  lastOutputDir: z.string().optional().describe('Absolute path returned by the download tool for the most recent site.'),
  lastDownload: z
    .object({
      filesDownloaded: z.number().int().nonnegative().optional(),
      bytesDownloaded: z.number().int().nonnegative().optional(),
      finishedAt: z.string().datetime().optional(),
    })
    .optional()
    .describe('Stats from the last successful download.'),
  lastClean: z
    .object({
      trackersRemoved: z.number().int().nonnegative().optional(),
      bytesSaved: z.number().int().nonnegative().optional(),
      finishedAt: z.string().datetime().optional(),
    })
    .optional()
    .describe('Stats from the last successful clean operation.'),
  userPreferences: z
    .object({
      autoClean: z.boolean().optional().describe('Whether the user wants sites auto-cleaned after download.'),
      reportStyle: z.enum(['short', 'detailed']).optional(),
    })
    .optional()
    .describe('Persistent user preferences across sessions.'),
});

export const landingAgent = new Agent({
  id: 'landing-agent',
  name: 'Landing Page Agent',
  instructions: `You are an AI agent for downloading, cleaning, and preparing landing pages.

Your workflow:
1. Download a landing page using the download-site tool (provide a URL).
2. Clean the downloaded site using the clean-site tool (provide the outputDir from step 1).
3. Report the results: files downloaded, trackers removed, bytes saved.

Always clean the site after downloading unless the user says otherwise.
When reporting results, summarize what was removed (scripts, trackers, source maps) and the size reduction.

Memory rules:
- After every successful tool call, call \`updateWorkingMemory\` to persist:
  - the URL just processed (\`lastUrl\`),
  - the absolute \`outputDir\` returned by the download tool (\`lastOutputDir\`),
  - download stats in \`lastDownload\` and clean stats in \`lastClean\`.
- When the user says "the previous site" or "again", use \`lastOutputDir\`/\`lastUrl\` from working memory instead of re-asking.
- Persist user preferences (\`autoClean\`, \`reportStyle\`) when the user expresses them; respect them on follow-up turns.
- Use ISO-8601 timestamps for \`finishedAt\` fields.`,
  model: 'openrouter/deepseek/deepseek-v4-pro',
  tools: {
    downloadSite: downloadSiteTool,
    cleanSite: cleanSiteTool,
  },
  memory: createAgentMemory({
    // Raw history: keep recent turns so multi-step tool flows have context.
    lastMessages: 20,
    // Persistent task state + user preferences across threads (resource scope).
    workingMemory: {
      enabled: true,
      schema: landingWorkingMemorySchema,
      scope: 'resource',
    },
    // Nicer thread titles in Studio (e.g. "Download example.com").
    generateTitle: true,
    // semanticRecall: opt-in. Enable when you add a vector store + embedder.
    // observationalMemory: opt-in. Useful here long-term because download/clean
    // tools can return very large file lists; enable once you set a model.
  }),
});
