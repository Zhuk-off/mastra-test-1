/**
 * Сканирование макросов вида `{token}` — общие помощники для inline (detect-macros)
 * и для ВНЕШНИХ `.js`/`.css` файлов (MAC-1/CSS-3/CJS-5). Карта макросов в отчёте важна
 * (владелец активно использует макросы): «удалю/перенесу и потом не найду, куда вставлять».
 */
import * as walk from 'acorn-walk';
import { isOwnMacro } from '../registry/policy.js';
import { parseJs } from '../passes/js-advanced/ast/parse.js';
import type { MacroFinding } from '../types.js';

/** Токен макроса вида {something} (буквы/цифры/_/:/.-). */
export const MACRO_RE = /\{[a-zA-Z0-9_:.\-]+\}/g;

/** Извлекает макросы, встречающиеся ВНУТРИ url(...) в CSS (фон/изображения). */
export function cssUrlMacros(css: string): string[] {
  const out: string[] = [];
  const urlRe = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(css)) !== null) {
    const toks = (m[2] ?? '').match(MACRO_RE);
    if (toks) out.push(...toks);
  }
  return out;
}

/** Извлекает строковые литералы из JS (через AST), чтобы искать макросы только в строках. */
export function jsStringLiterals(code: string, relPath: string): string[] | null {
  const ast = parseJs(code, relPath);
  if (!ast) return null;
  const strings: string[] = [];
  walk.simple(ast as never, {
    Literal(node: { value?: unknown }) {
      if (typeof node.value === 'string') strings.push(node.value);
    },
    TemplateLiteral(node: { quasis?: { value?: { cooked?: string | null; raw?: string } }[] }) {
      for (const q of node.quasis ?? []) strings.push(q.value?.cooked ?? q.value?.raw ?? '');
    },
  });
  return strings;
}

/**
 * Макросы во внешнем `.js`-файле (CJS-5): только в строковых литералах (AST), чтобы не ловить
 * объектные литералы `{a:1}`. Непарсимый файл → пусто (консервативно, без сырого regex-FP).
 */
export function scanJsFileMacros(code: string, relPath: string): MacroFinding[] {
  if (!code.includes('{')) return [];
  const strings = jsStringLiterals(code, relPath);
  if (!strings) return [];

  const found = new Set<string>();
  for (const s of strings) {
    const toks = s.match(MACRO_RE);
    if (toks) for (const t of toks) found.add(t);
  }
  if (found.size === 0) return [];

  const out: MacroFinding[] = [];
  for (const t of [...found].filter(isOwnMacro)) {
    out.push({ kind: 'own', token: t, file: relPath, element: 'script(external)', attr: '(js-string)', action: 'оставлено (наш макрос в JS)' });
  }
  const foreign = [...found].filter((t) => !isOwnMacro(t));
  if (foreign.length) {
    out.push({
      kind: 'script',
      token: foreign.join(' '),
      file: relPath,
      element: 'script(external)',
      attr: '(js-string)',
      action: 'макрос во внешнем JS (возможна подмена ссылок) — проверить вручную',
    });
  }
  return out;
}

/** Макросы во внешнем `.css`-файле (CSS-3): только внутри `url(...)` (фон/продуктовые изображения). */
export function scanCssFileMacros(css: string, relPath: string): MacroFinding[] {
  const toks = cssUrlMacros(css);
  if (!toks.length) return [];

  const out: MacroFinding[] = [];
  for (const t of toks.filter(isOwnMacro)) {
    out.push({ kind: 'own', token: t, file: relPath, element: 'style(external)', attr: '(css-url)', action: 'оставлено (наш макрос)' });
  }
  const fimg = [...new Set(toks.filter((t) => !isOwnMacro(t)))];
  if (fimg.length) {
    out.push({
      kind: 'image',
      token: fimg.join(' '),
      file: relPath,
      element: 'style(external)',
      attr: '(css-url)',
      action: 'фон/изображение во внешнем CSS — подставить на этапе адаптации',
    });
  }
  return out;
}
