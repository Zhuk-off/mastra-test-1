import { readFile, writeFile } from 'node:fs/promises';
import { isExternalUrl } from '../../utils/url.js';
import { dangerousSchemeOf } from '../../utils/allowlist.js';
import { removeTrackerUrls } from '../css/remove-tracker-urls.js';

/**
 * Чистит SVG как вектор сокрытия JS (чек-лист владельца: «там прячут JS»). Закрывает SVG-1/SVG-2:
 *  - `<script>` в ЛЮБОЙ форме: закрытый `…</script>` И self-closing `<script xlink:href=…/>`;
 *  - `<foreignObject>` (может тащить HTML/JS);
 *  - `on*`-обработчики — и в кавычках, и БЕЗ (`<svg onload=alert(1)>`);
 *  - `href` И `xlink:href` (SVG2 plain href, `<use>`/`<image>`) на внешний хост ИЛИ с опасной схемой
 *    (`javascript:`/`data:`…) → снимаем атрибут;
 *  - трекер-`url()` в `<style>` внутри SVG (через тот же allowlist, что и CSS).
 *
 * Чистая функция (тестируется без FS). Остаётся на regex — полноценный XML-парсер для SVG это
 * отдельное усиление (C7); здесь закрыты конкретные перечисленные обходы.
 */
export function cleanSvgContent(content: string): { content: string; removed: number } {
  let removed = 0;

  // <script>…</script> (закрытый) и <script …/> (self-closing, в т.ч. href-only внешний)
  content = content.replace(/<script\b[\s\S]*?<\/script>/gi, () => { removed++; return ''; });
  content = content.replace(/<script\b[^>]*\/>/gi, () => { removed++; return ''; });

  // <foreignObject>…</foreignObject>
  content = content.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, () => { removed++; return ''; });

  // on*-обработчики: 'q' | "q" | unquoted
  content = content.replace(/\s+on\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, () => { removed++; return ''; });

  // href / xlink:href: внешний хост ИЛИ опасная схема → снять атрибут (элемент сохраняем).
  // Ведущий \s + полное имя атрибута, чтобы не задеть подстроку `href` внутри `xlink:href`.
  content = content.replace(/\s(?:xlink:)?href\s*=\s*(['"])([^'"]+)\1/gi, (whole, _q, url: string) => {
    if (dangerousSchemeOf(url) || isExternalUrl(url)) { removed++; return ''; }
    return whole;
  });

  // <style> внутри SVG: трекер-url() через тот же allowlist, что и для CSS-файлов.
  content = content.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (whole, open: string, css: string, close: string) => {
    const r = removeTrackerUrls(css, 'svg-style', []);
    if (r.removed > 0) { removed += r.removed; return `${open}${r.content}${close}`; }
    return whole;
  });

  return { content, removed };
}

export async function cleanSvgFile(filePath: string): Promise<number> {
  const original = await readFile(filePath, 'utf8');
  const { content, removed } = cleanSvgContent(original);
  if (content !== original) await writeFile(filePath, content, 'utf8');
  return removed;
}
