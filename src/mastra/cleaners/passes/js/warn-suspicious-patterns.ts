import type { ChangelogEntry } from '../../types.js';
import { JS_WARNING_PATTERNS } from '../../registry/js-warning-patterns.js';

export function warnSuspiciousPatterns(
  content: string,
  relPath: string,
  log: ChangelogEntry[],
): void {
  for (const { re, label } of JS_WARNING_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content)) !== null) {
      const matchStart = Math.max(0, match.index - 150);
      const matchEnd = Math.min(content.length, match.index + match[0]!.length + 150);
      const snippet = content.slice(matchStart, matchEnd).replace(/\s+/g, ' ').trim();

      // Вычисляем номер строки
      const beforeMatch = content.slice(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      log.push({
        file: relPath,
        type: 'JS предупреждение',
        description: `Найдено: ${label}`,
        codeSnippet: snippet,
        lineNumber,
      });
    }
  }
}
