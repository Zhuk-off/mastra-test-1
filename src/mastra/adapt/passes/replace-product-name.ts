import type { Element } from 'domhandler';
import type { Dom } from '../../cleaners/utils/html-dom.js';
import { BUILTIN_ADAPT_CONFIG } from '../config.js';
import { resolveNameReplacement } from '../targets.js';
import type { AdaptContext, AdaptPass } from '../types.js';

/**
 * Этап АДАПТАЦИИ: подстановка названия товара.
 *
 * Заменяет ВСЕ вхождения текущего названия продукта (`brief.name.productName` + `aliases`) на наш
 * макрос {_offer_value:offername} (или на строку `literal`). Решение владельца: «все имена продукта
 * в лендинге → {_offer_value:offername}».
 *
 * Где заменяем (только ОТОБРАЖАЕМЫЙ текст — НИКОГДА href/src/value/код/макросы):
 *  - текстовые узлы (вне script/style/template/textarea/pre/code/noscript), включая <title>;
 *  - безопасные отображаемые атрибуты: alt, title, aria-label, placeholder
 *    (НЕ value — это данные формы у hidden/option/radio, см. ревью этапа 5);
 *  - <meta content> для description/keywords и og/twitter title-description.
 *
 * <noscript> исключён намеренно: cheerio (scriptingEnabled) держит его содержимое как ОДИН сырой
 * текстовый узел (сериализованную разметку) — замена по нему вписала бы макрос в src/href внутри noscript.
 *
 * Совпадение — по границам не-букв/цифр (юникод), чтобы не рвать слова ("Vital" не тронет "Vitality").
 * Пробелы в названии матчатся гибко (\\s+: обычный пробел, несколько пробелов, &nbsp;).
 * Ограничение: имя, РАЗОРВАННОЕ инлайн-тегом (`Vital <span>Boost</span> XL`), лежит в разных
 * текстовых узлах и не матчится — задавайте такие слова отдельными `aliases`.
 * Идемпотентность гарантирована для mode:'macro' (макрос не содержит названия). В mode:'literal'
 * оркестратор предупреждает, если literal содержит искомое название (иначе повторный прогон раздул бы текст).
 */

const SKIP_TEXT_PARENTS = new Set(['script', 'style', 'template', 'textarea', 'pre', 'code', 'noscript']);
const TEXT_ATTRS = ['alt', 'title', 'aria-label', 'placeholder'];
const META_NAME_RE = /^(description|keywords|og:title|og:description|twitter:title|twitter:description)$/i;

/**
 * Строит регэксп «любое из названий по границам слова». Длинные — первыми (алиас-подстроки не мешают);
 * пробелы внутри названия → `\\s+` (ловит обычный пробел, серию пробелов и &nbsp;).
 */
function buildMatcher(names: string[]): RegExp {
  const alts = [...names]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

export const replaceProductName: AdaptPass = ($, ctx) => {
  const config = ctx.config ?? BUILTIN_ADAPT_CONFIG;
  const r = resolveNameReplacement(ctx.brief, config);
  if (!r) return {};
  const { target, names } = r;
  const re = buildMatcher(names);
  let replaced = 0;

  const apply = (str: string): { out: string; n: number } => {
    let n = 0;
    const out = str.replace(re, () => {
      n++;
      return target;
    });
    return { out, n };
  };

  // 1) Текстовые узлы (включая <title>)
  $('*')
    .contents()
    .each((_, node) => {
      if (node.type !== 'text') return;
      const parent = node.parent as Element | null;
      const ptag = (parent?.tagName ?? '').toLowerCase();
      if (SKIP_TEXT_PARENTS.has(ptag)) return;
      const data: string = (node as unknown as { data: string }).data ?? '';
      if (!data) return;
      const { out, n } = apply(data);
      if (n === 0) return;
      (node as unknown as { data: string }).data = out;
      replaced += n;
      ctx.changes.push({
        file: ctx.relPath,
        pass: 'name',
        element: `text<${ptag}>`,
        attr: '(text)',
        before: data.trim().slice(0, 80),
        after: target,
        trigger: 'text',
      });
    });

  // 2) Безопасные отображаемые атрибуты (value намеренно НЕ трогаем — данные формы)
  $('[alt],[title],[aria-label],[placeholder]').each((_, node) => {
    const el = node as Element;
    const $el = $(el);
    for (const attr of TEXT_ATTRS) {
      const val = $el.attr(attr);
      if (!val) continue;
      const { out, n } = apply(val);
      if (n === 0) continue;
      $el.attr(attr, out);
      replaced += n;
      ctx.changes.push({
        file: ctx.relPath,
        pass: 'name',
        element: (el.tagName ?? '').toLowerCase(),
        attr,
        before: val.slice(0, 80),
        after: target,
        trigger: 'attr',
      });
    }
  });

  // 3) <meta content> для description/og:*/twitter:*
  $('meta[content]').each((_, node) => {
    const el = node as Element;
    const $el = $(el);
    const metaName = $el.attr('name') ?? $el.attr('property') ?? '';
    if (!META_NAME_RE.test(metaName)) return;
    const val = $el.attr('content') ?? '';
    const { out, n } = apply(val);
    if (n === 0) return;
    $el.attr('content', out);
    replaced += n;
    ctx.changes.push({
      file: ctx.relPath,
      pass: 'name',
      element: 'meta',
      attr: 'content',
      before: val.slice(0, 80),
      after: target,
      trigger: 'meta',
    });
  });

  return replaced ? { namesReplaced: replaced } : {};
};
