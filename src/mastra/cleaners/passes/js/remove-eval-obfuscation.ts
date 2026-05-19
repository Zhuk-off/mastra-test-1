import type { ChangelogEntry } from '../../types.js';

export function removeEvalObfuscation(
  content: string,
  relPath: string,
  log: ChangelogEntry[],
): { content: string; removed: number } {
  let removed = 0;

  // eval(atob(...)) / eval(unescape(...)) — обфусцированный код
  content = content.replace(
    /\beval\s*\(\s*(?:atob|unescape|decodeURIComponent)\s*\([^)]*\)\s*\)\s*;?/g,
    () => {
      removed++;
      log.push({ file: relPath, type: 'JS удалён', description: 'eval(atob/unescape(...))' });
      return '';
    },
  );

  // eval() с подозрительным контентом (base64-строки)
  content = content.replace(
    /\beval\s*\(\s*["'][A-Za-z0-9+/]{40,}={0,2}["']\s*\)\s*;?/g,
    () => {
      removed++;
      log.push({ file: relPath, type: 'JS удалён', description: 'eval("<base64-string>")' });
      return '';
    },
  );

  return { content, removed };
}
