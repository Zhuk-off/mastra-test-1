import type { ChangelogEntry } from '../../types.js';
import { isExternalUrl } from '../../utils/url.js';

export function removeTrackerImports(
  content: string,
  relPath: string,
  log: ChangelogEntry[],
): { content: string; removed: number } {
  let removed = 0;

  content = content.replace(
    /@import\s+(?:url\s*\(\s*['"]?|['"])(https?:\/\/[^'"\)\s;]+)['"]?\s*\)?\s*[^;]*;/gi,
    (whole, url: string) => {
      if (isExternalUrl(url)) {
        removed++;
        const snippet = whole.replace(/\s+/g, ' ').trim();
        const matchIndex = content.indexOf(whole);
        const beforeMatch = content.slice(0, matchIndex);
        const lineNumber = beforeMatch.split('\n').length;
        log.push({ file: relPath, type: 'CSS @import удалён', description: url, codeSnippet: snippet, lineNumber });
        return '';
      }
      return whole;
    },
  );

  return { content, removed };
}
