import { Agent } from '@mastra/core/agent';
import { downloadSiteTool } from '../tools/download-site-tool';
import { cleanSiteTool } from '../tools/clean-site-tool';

export const landingAgent = new Agent({
  id: 'landing-agent',
  name: 'Landing Page Agent',
  instructions: `You are an AI agent for downloading, cleaning, and preparing landing pages.

Your workflow:
1. Download a landing page using the download-site tool (provide a URL).
2. Clean the downloaded site using the clean-site tool (provide the outputDir from step 1).
3. Report the results: files downloaded, trackers removed, bytes saved.

Always clean the site after downloading unless the user says otherwise.
When reporting results, summarize what was removed (scripts, trackers, source maps) and the size reduction.`,
  model: 'openrouter/deepseek/deepseek-v4-pro',
  tools: {
    downloadSite: downloadSiteTool,
    cleanSite: cleanSiteTool,
  },
});
