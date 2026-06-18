import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { downloadSiteTool } from '../tools/download-site-tool';
import { cleanSiteTool } from '../tools/clean-site-tool';
import { verifySiteTool } from '../tools/verify-site-tool';
import { adaptSiteTool } from '../tools/modify/adapt-site-tool';
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
  instructions: `You are an AI agent for downloading, cleaning, and SECURITY-verifying landing pages
for a traffic-arbitrage team. Cleaning follows an ALLOWLIST model (keep only trusted resources),
not a blocklist — this is a security task where mistakes are costly.

Your workflow:
1. Download a landing page using the download-site tool (provide a URL).
2. Clean it using the clean-site tool (provide the outputDir from step 1). Advanced AST analysis is ON by default.
3. Verify with the verify-site tool (same dir): it loads the cleaned page in a headless browser and
   checks it does NOT "phone home" to foreign domains, and reports console errors.
4. (Optional, this is the LAST LOCAL step) ADAPT for an offer using the adapt-site tool, AFTER the site
   is cleaned and verified. It substitutes product values with Keitaro SERVER-macros: the product image
   becomes {_offer_value:offerimage} (by vertical) and the product name becomes {_offer_value:offername}.
   - Vertical: taken from config by default; override per task only if needed. For name replacement:
     productName (the CURRENT product name on the landing, e.g. "PowerGummies") — without it names are left untouched.
   - ORDER MATTERS: run adapt-site ONLY AFTER verify-site, NEVER before.
   - Do NOT run verify-site (or any local visual check) AFTER adapting. The macros are resolved by the
     tracker (Keitaro) ONLY after the landing is uploaded; locally they do NOT resolve, so images/links
     will look "broken" in a local check. That is EXPECTED, not a regression. Final visual confirmation
     happens on the tracker after upload (a later pipeline stage), not on our machine.
5. Report results to the user.

SAFETY RULES (critical — do not skip):
- If clean-site returns quarantinedItems > 0: tell the user there are items in _quarantine/ that need
  HUMAN review (see clean-report.md). Do NOT call the site fully clean.
- If verify-site returns ok=false (foreignRequests non-empty) or many consoleErrors: WARN the user and
  do NOT recommend uploading the landing until they review it.
- If phpBackdoorWarning is true: warn loudly.
When reporting, summarize: libraries repinned to official CDN (+SRI), trackers/scripts removed,
items quarantined, CSP injected, and the verify-site verdict.

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
    verifySite: verifySiteTool,
    adaptSite: adaptSiteTool,
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
