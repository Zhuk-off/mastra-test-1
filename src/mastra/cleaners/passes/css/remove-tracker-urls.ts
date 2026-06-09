import type { ChangelogEntry } from '../../types.js';
import { classifyResource } from '../../utils/allowlist.js';

/**
 * CSS-1: внешние `url(...)` через БЕЛЫЙ СПИСОК, а не блок-лист. Раньше нейтрализовался
 * только известный трекер (`urlMatchesTracker`), а НЕИЗВЕСТНЫЙ внешний ресурс
 * (`url(https://evil-cdn.xyz/bg.png)` — потенциальный пиксель/утечка) оставался. Теперь
 * `classifyResource(url, 'img')` (CSS url() — обычно фон/шрифт; img-trust = lib-CDN + own-asset):
 * trusted/локальный → keep; трекер/чужой → нейтрализуем в `url('')`. Регэксп матчит только
 * абсолютные http(s) — локальные пути не трогаются.
 */
export function removeTrackerUrls(
  content: string,
  relPath: string,
  log: ChangelogEntry[],
): { content: string; removed: number } {
  let removed = 0;

  content = content.replace(
    /url\s*\(\s*['"]?(https?:\/\/[^'"\)\s]+)['"]?\s*\)/gi,
    (whole, url: string) => {
      const c = classifyResource(url, 'img');
      if (c.action !== 'keep') {
        removed++;
        const snippet = whole.replace(/\s+/g, ' ').trim();
        const matchIndex = content.indexOf(whole);
        const beforeMatch = content.slice(0, matchIndex);
        const lineNumber = beforeMatch.split('\n').length;
        log.push({ file: relPath, type: 'CSS url() удалён', description: `${c.reason}: ${url}`, codeSnippet: snippet, lineNumber });
        return "url('')";
      }
      return whole;
    },
  );

  return { content, removed };
}
