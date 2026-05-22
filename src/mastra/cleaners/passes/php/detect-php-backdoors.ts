import type { ChangelogEntry } from '../../types.js';

/** Known PHP shell / backdoor patterns */
const PHP_BACKDOOR_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /eval\s*\(\s*\$_(POST|GET|REQUEST|COOKIE)/i, label: 'eval($_POST/GET)' },
  { re: /assert\s*\(\s*\$_(POST|GET|REQUEST)/i, label: 'assert($_POST)' },
  { re: /system\s*\(\s*\$_(GET|POST|REQUEST)/i, label: 'system() с user input' },
  { re: /preg_replace\s*\([^,]+\/e[^,]*,/i, label: 'preg_replace /e modifier' },
  { re: /base64_decode\s*\([^)]+\)\s*;?\s*\)/i, label: 'base64_decode → eval chain' },
  { re: /gzinflate\s*\(\s*base64_decode/i, label: 'gzinflate(base64_decode(...))' },
  { re: /move_uploaded_file\s*\([^)]+\)/i, label: 'move_uploaded_file (file upload)' },
  { re: /passthru\s*\(\s*\$_(GET|POST)/i, label: 'passthru() с user input' },
  { re: /shell_exec\s*\(\s*\$_(GET|POST|REQUEST)/i, label: 'shell_exec() с user input' },
  { re: /exec\s*\(\s*\$_(GET|POST|REQUEST)/i, label: 'exec() с user input' },
];

/**
 * Scans PHP file content for known backdoor / shell patterns.
 * Returns ChangelogEntry[] with PHP_BACKDOOR_WARN type.
 * WARN only — never deletes.
 */
export function detectPhpBackdoors(content: string, relPath: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  for (const { re, label } of PHP_BACKDOOR_PATTERNS) {
    if (re.test(content)) {
      entries.push({
        file: relPath,
        type: 'PHP_BACKDOOR_WARN',
        description: `ВНИМАНИЕ: обнаружен паттерн бэкдора: ${label}. ТРЕБУЕТСЯ РУЧНАЯ ПРОВЕРКА.`,
      });
    }
  }

  return entries;
}
