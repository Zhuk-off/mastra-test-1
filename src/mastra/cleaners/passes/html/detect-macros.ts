import type { DomPass } from '../../types.js';
import type { Element } from 'domhandler';
import * as walk from 'acorn-walk';
import { isOwnMacro } from '../../registry/policy.js';
import { parseJs } from '../js-advanced/ast/parse.js';

/** Токен макроса вида {something} (буквы/цифры/_/:/.-). */
const MACRO_RE = /\{[a-zA-Z0-9_:.\-]+\}/g;
const SCAN_ATTRS = new Set(['href', 'src', 'srcset', 'poster', 'content', 'action', 'formaction']);
const IMG_ATTRS = new Set(['src', 'srcset', 'poster', 'data-src']);
const SKIP_TEXT_PARENTS = new Set(['script', 'style', 'template', 'textarea', 'pre']);

/** Извлекает макросы, встречающиеся ВНУТРИ url(...) в CSS (фон/изображения). */
function cssUrlMacros(css: string): string[] {
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
function jsStringLiterals(code: string, relPath: string): string[] | null {
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
 * Этап ОЧИСТКИ для макросов:
 *  - наш макрос ({offer}, {_offer_value:...}) — оставляем, фиксируем в карте;
 *  - чужой макрос в href, где href ЦЕЛИКОМ макрос → {offer} (редирект трекера);
 *  - чужой макрос в src/srcset/poster и в CSS url() → ПРОДУКТОВОЕ/фоновое изображение → флаг адаптации;
 *  - чужой макрос в тексте страницы (напр. {_fbclid} внизу body) → УДАЛЯЕМ (артефакт трекера);
 *  - чужой макрос в <script> (подмена ссылок) → ФЛАГ (JS не редактируем автоматически — рискованно);
 *  - чужой макрос в прочих атрибутах → флаг «проверить вручную».
 * Подстановку продуктового изображения/названия НЕ делаем — это этап адаптации.
 */
export const detectMacros: DomPass = ($, ctx) => {
  let offerLinksReplaced = 0;
  const add = (f: { kind: 'own' | 'link' | 'image' | 'text' | 'script' | 'other'; token: string; element: string; attr: string; action: string }) =>
    (ctx.macros ??= []).push({ ...f, file: ctx.relPath });

  // 1) Атрибуты
  $('*').each((_, node) => {
    const el = node as Element;
    const attribs = el.attribs;
    if (!attribs) return;
    const tag = (el.tagName ?? '').toLowerCase();

    for (const name of Object.keys(attribs)) {
      const lname = name.toLowerCase();
      const val = attribs[name] ?? '';

      // style="...url({macro})..." — отдельно, только внутри url()
      if (lname === 'style') {
        const toks = cssUrlMacros(val);
        for (const t of toks.filter(isOwnMacro)) add({ kind: 'own', token: t, element: tag, attr: 'style', action: 'оставлено (наш макрос)' });
        const fimg = [...new Set(toks.filter((t) => !isOwnMacro(t)))];
        if (fimg.length) add({ kind: 'image', token: fimg.join(' '), element: tag, attr: 'style', action: 'фон/изображение — подставить на этапе адаптации' });
        continue;
      }

      if (!SCAN_ATTRS.has(lname) && !lname.startsWith('data-')) continue;

      const tokens = val.match(MACRO_RE);
      if (!tokens) continue;
      for (const t of tokens.filter(isOwnMacro)) add({ kind: 'own', token: t, element: tag, attr: lname, action: 'оставлено (наш макрос)' });
      const foreign = tokens.filter((t) => !isOwnMacro(t));
      if (foreign.length === 0) continue;

      const hrefIsPureMacro = lname === 'href' && /^\s*\{[^}]+\}\s*$/.test(val);
      if (hrefIsPureMacro && (tag === 'a' || tag === 'area')) {
        $(el).attr('href', '{offer}');
        offerLinksReplaced++;
        add({ kind: 'link', token: foreign.join(' '), element: tag, attr: 'href', action: 'заменено на {offer}' });
      } else if (IMG_ATTRS.has(lname)) {
        add({ kind: 'image', token: foreign.join(' '), element: tag, attr: lname, action: 'продуктовое изображение — подставить на этапе адаптации (Adult/WeightLoss)' });
      } else {
        add({ kind: 'other', token: foreign.join(' '), element: tag, attr: lname, action: 'чужой макрос — проверить/удалить вручную' });
      }
    }
  });

  // 2) Текстовые узлы (не внутри script/style/template/textarea/pre)
  $('*').contents().each((_, node) => {
    if (node.type !== 'text') return;
    const parent = node.parent as Element | null;
    const ptag = (parent?.tagName ?? '').toLowerCase();
    if (SKIP_TEXT_PARENTS.has(ptag)) return;

    const data: string = (node as unknown as { data: string }).data ?? '';
    const tokens = data.match(MACRO_RE);
    if (!tokens) return;

    for (const t of tokens.filter(isOwnMacro)) add({ kind: 'own', token: t, element: `text<${ptag}>`, attr: '(text)', action: 'оставлено (наш макрос)' });
    const foreign = tokens.filter((t) => !isOwnMacro(t));
    if (foreign.length === 0) return;

    let newData = data;
    for (const t of foreign) newData = newData.split(t).join('');
    newData = newData.replace(/[ \t]{2,}/g, ' ');
    (node as unknown as { data: string }).data = newData;
    add({ kind: 'text', token: foreign.join(' '), element: `text<${ptag}>`, attr: '(text)', action: 'удалён текстовый макрос трекера' });
  });

  // 3) <script> (inline): макросы в строковых литералах JS (часто — подмена ссылок)
  $('script:not([src])').each((_, el) => {
    const type = ($(el).attr('type') ?? '').toLowerCase();
    if (type.includes('json')) return; // ld+json обрабатывается отдельно
    const code = $(el).text();
    if (!code || !code.includes('{')) return;

    const strings = jsStringLiterals(code, ctx.relPath);
    if (!strings) return; // не распарсилось — не рискуем (отработают JS-детекторы)

    const found = new Set<string>();
    for (const s of strings) {
      const toks = s.match(MACRO_RE);
      if (toks) for (const t of toks) found.add(t);
    }
    if (found.size === 0) return;
    for (const t of [...found].filter(isOwnMacro)) add({ kind: 'own', token: t, element: 'script', attr: '(js-string)', action: 'оставлено (наш макрос в JS)' });
    const foreign = [...found].filter((t) => !isOwnMacro(t));
    if (foreign.length) add({ kind: 'script', token: foreign.join(' '), element: 'script', attr: '(js-string)', action: 'макрос в JS (возможна подмена ссылок) — проверить вручную' });
  });

  // 4) <style>: макросы внутри url() (фоновые/продуктовые изображения)
  $('style').each((_, el) => {
    const toks = cssUrlMacros($(el).text());
    if (!toks.length) return;
    for (const t of toks.filter(isOwnMacro)) add({ kind: 'own', token: t, element: 'style', attr: '(css-url)', action: 'оставлено (наш макрос)' });
    const fimg = [...new Set(toks.filter((t) => !isOwnMacro(t)))];
    if (fimg.length) add({ kind: 'image', token: fimg.join(' '), element: 'style', attr: '(css-url)', action: 'фон/изображение — подставить на этапе адаптации' });
  });

  return offerLinksReplaced ? { offerLinksReplaced } : {};
};
