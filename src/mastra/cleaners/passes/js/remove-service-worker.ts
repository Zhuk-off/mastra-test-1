import type { ChangelogEntry } from '../../types.js';

export function removeServiceWorker(
  content: string,
  relPath: string,
  log: ChangelogEntry[],
): { content: string; removed: number } {
  let removed = 0;
  content = content.replace(
    /navigator\.serviceWorker\.register\s*\([^)]*\)(?:\s*\.then\s*\([^)]*\))?\s*;?/g,
    () => {
      removed++;
      log.push({ file: relPath, type: 'JS удалён', description: 'navigator.serviceWorker.register(...)' });
      return '';
    },
  );
  return { content, removed };
}
