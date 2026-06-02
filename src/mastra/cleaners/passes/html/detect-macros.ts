import type { DomPass } from '../../types.js';
import type { Element } from 'domhandler';
import { isOwnMacro } from '../../registry/policy.js';

/** Токен макроса вида {something} (буквы/цифры/_/:/.-). */
const MACRO_RE = /\{[a-zA-Z0-9_:.\-]+\}/g;
const SCAN_ATTRS = new Set(['href', 'src', 'srcset', 'poster', 'content', 'action', 'formaction']);
const IMG_ATTRS = new Set(['src', 'srcset', 'poster', 'data-src']);
const SKIP_TEXT_PARENTS = new Set(['script', 'style', 'template', 'textarea', 'pre']);

/**
 * Этап ОЧИСТКИ для макросов:
 *  - наш макрос ({offer}, {_offer_value:...}) — оставляем, фиксируем в карте;
 *  - чужой макрос в href, где href ЦЕЛИКОМ макрос → {offer} (редирект трекера);
 *  - чужой макрос в src/srcset/poster → ПРОДУКТОВОЕ изображение → флаг на этап адаптации;
 *  - чужой макрос в тексте страницы (напр. {_fbclid} внизу body) → УДАЛЯЕМ (артефакт трекера);
 *  - чужой макрос в прочих атрибутах → флаг «проверить вручную».
 * Подстановку продуктового изображения/названия НЕ делаем — это этап адаптации.
 */
export const detectMacros: DomPass = ($, ctx) => {
  let offerLinksReplaced = 0;

  // 1) Атрибуты
  $('*').each((_, node) => {
    const el = node as Element;
    const attribs = el.attribs;
    if (!attribs) return;
    const tag = (el.tagName ?? '').toLowerCase();

    for (const name of Object.keys(attribs)) {
      const lname = name.toLowerCase();
      if (!SCAN_ATTRS.has(lname) && !lname.startsWith('data-')) continue;

      const val = attribs[name] ?? '';
      const tokens = val.match(MACRO_RE);
      if (!tokens) continue;

      const foreign = tokens.filter((t) => !isOwnMacro(t));
      for (const t of tokens.filter((t) => isOwnMacro(t))) {
        (ctx.macros ??= []).push({ kind: 'own', token: t, file: ctx.relPath, element: tag, attr: lname, action: 'оставлено (наш макрос)' });
      }
      if (foreign.length === 0) continue;

      const hrefIsPureMacro = lname === 'href' && /^\s*\{[^}]+\}\s*$/.test(val);
      if (hrefIsPureMacro && (tag === 'a' || tag === 'area')) {
        $(el).attr('href', '{offer}');
        offerLinksReplaced++;
        (ctx.macros ??= []).push({ kind: 'link', token: foreign.join(' '), file: ctx.relPath, element: tag, attr: 'href', action: 'заменено на {offer}' });
      } else if (IMG_ATTRS.has(lname)) {
        (ctx.macros ??= []).push({ kind: 'image', token: foreign.join(' '), file: ctx.relPath, element: tag, attr: lname, action: 'продуктовое изображение — подставить на этапе адаптации (Adult/WeightLoss)' });
      } else {
        (ctx.macros ??= []).push({ kind: 'other', token: foreign.join(' '), file: ctx.relPath, element: tag, attr: lname, action: 'чужой макрос — проверить/удалить вручную' });
      }
    }
  });

  // 2) Текстовые узлы (не внутри script/style/template/textarea)
  $('*').contents().each((_, node) => {
    if (node.type !== 'text') return;
    const parent = node.parent as Element | null;
    const ptag = (parent?.tagName ?? '').toLowerCase();
    if (SKIP_TEXT_PARENTS.has(ptag)) return;

    const data: string = (node as unknown as { data: string }).data ?? '';
    const tokens = data.match(MACRO_RE);
    if (!tokens) return;

    for (const t of tokens.filter((t) => isOwnMacro(t))) {
      (ctx.macros ??= []).push({ kind: 'own', token: t, file: ctx.relPath, element: `text<${ptag}>`, attr: '(text)', action: 'оставлено (наш макрос)' });
    }
    const foreign = tokens.filter((t) => !isOwnMacro(t));
    if (foreign.length === 0) return;

    let newData = data;
    for (const t of foreign) newData = newData.split(t).join('');
    newData = newData.replace(/[ \t]{2,}/g, ' ');
    (node as unknown as { data: string }).data = newData;
    (ctx.macros ??= []).push({ kind: 'text', token: foreign.join(' '), file: ctx.relPath, element: `text<${ptag}>`, attr: '(text)', action: 'удалён текстовый макрос трекера' });
  });

  return offerLinksReplaced ? { offerLinksReplaced } : {};
};
