import type { ChangelogEntry } from '../../types.js';
import { urlMatchesTracker } from '../../utils/url.js';

export function removeTrackerUrls(
  content: string,
  relPath: string,
  log: ChangelogEntry[],
): { content: string; removed: number } {
  let removed = 0;

  content = content.replace(
    /url\s*\(\s*['"]?(https?:\/\/[^'"\)\s]+)['"]?\s*\)/gi,
    (whole, url: string) => {
      if (urlMatchesTracker(url)) {
        removed++;
        const snippet = whole.replace(/\s+/g, ' ').trim();
        const matchIndex = content.indexOf(whole);
        const beforeMatch = content.slice(0, matchIndex);
        const lineNumber = beforeMatch.split('\n').length;
        log.push({ file: relPath, type: 'CSS url() удалён', description: url, codeSnippet: snippet, lineNumber });
        return "url('')";
      }
      return whole;
    },
  );

  return { content, removed };
}
