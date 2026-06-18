import type { Element } from 'domhandler';
import type { Dom } from '../../cleaners/utils/html-dom.js';
import { isOwnMacro } from '../../cleaners/registry/policy.js';
import { MACRO_RE } from '../../cleaners/utils/macro-scan.js';
import { BUILTIN_ADAPT_CONFIG } from '../config.js';
import { knownOwnImageBases, resolveImageTarget } from '../targets.js';
import type { AdaptContext, AdaptPass } from '../types.js';

/**
 * Этап АДАПТАЦИИ: подстановка продуктового изображения.
 *
 * Вписывает в `<img src>` базу из конфига для вертикали (макрос {_offer_value:offerimage}; трекер
 * раскроет в имя_товара.webp) или реальный URL в режиме 'file'. Триггеры (детерминированные):
 *
 *  - **T2 — offer-якорь:** `<img>` внутри `<a href="{offer}">` = продуктовый пакшот. Лого/иконки/оплата/
 *    .svg/≤48px пропускаются (NON_PRODUCT_RE + isTiny).
 *  - **T1 — чужой макрос в src:** оригинал содержал чужой макрос картинки в src/srcset/poster/data-src
 *    или в `url()` инлайн-стиля → меняем на наш target.
 *  - **re-point — наш старый URL:** src/srcset/url() = база ДРУГОЙ вертикали (или старая база) из конфига
 *    → перенаправляем на текущий target. Это «поменять настройки и заменить заново» без лишних файлов.
 *
 * Идемпотентность: значение, уже равное target, не трогаем.
 * srcset/sizes/lazy (вкл. data-srcset) убираем; `<source>` в `<picture>` схлопываем в `<img>`.
 *
 * ОБЛАСТЬ ДЕЙСТВИЯ v1 — только inline-HTML (<img>/<source>/inline style url()). НЕ обрабатываются
 * (отдельная веха): чужой макрос картинки во внешних .css/.js, SVG `<image href>`, содержимое `<noscript>`.
 * Эвристика пакшота БЕЗ offer-якоря (hero) — шаг 5.5.
 */

const OFFER_ANCHOR_SEL = 'a[href="{offer}"] img';

/** Атрибуты, где у `<img>`/`<source>` может жить URL/макрос картинки. */
const IMG_URL_ATTRS = ['src', 'srcset', 'poster', 'data-src', 'data-srcset', 'data-lazy-src', 'data-original'];

/** Адаптивные/lazy-атрибуты, которые перебили бы единственный src — снимаем при подстановке. */
const STRIP_RESPONSIVE_ATTRS = ['srcset', 'sizes', 'data-src', 'data-srcset', 'data-lazy-src', 'data-lazy', 'data-original'];

/** Лого/иконки/способы оплаты — не продуктовая картинка (по имени файла/классу/id/alt). */
const NON_PRODUCT_RE = /logo|sprite|favicon|payment|paypal|visa|master(?:card)?|amex|discover|\bicon\b|icon[-_]|[-_]icon|arrow|chevron|badge|spinner|loader/i;

/** Явно крошечная картинка (иконка) — по атрибутам width/height. */
function isTiny($img: ReturnType<Dom>): boolean {
  const w = parseInt($img.attr('width') ?? '', 10);
  const h = parseInt($img.attr('height') ?? '', 10);
  return (Number.isFinite(w) && w > 0 && w <= 48) || (Number.isFinite(h) && h > 0 && h <= 48);
}

function isNonProduct($: Dom, el: Element): boolean {
  const $el = $(el);
  const src = $el.attr('src') ?? $el.attr('data-src') ?? '';
  // .svg внутри offer-якоря почти всегда иконка/лого/галочка, а не продуктовый пакшот (пакшоты растровые).
  if (/\.svg(?:[?#]|$)/i.test(src)) return true;
  const hay = [src, $el.attr('class'), $el.attr('id'), $el.attr('alt')].filter(Boolean).join(' ');
  return NON_PRODUCT_RE.test(hay) || isTiny($el);
}

function hasForeignMacro(val: string | undefined): boolean {
  if (!val) return false;
  const toks = val.match(MACRO_RE);
  return !!toks && toks.some((t) => !isOwnMacro(t));
}

/** Подставляет target в `<img>` + зачищает адаптивные атрибуты + `<source>` в `<picture>`. */
function replaceImg($: Dom, el: Element, target: string, trigger: string, ctx: AdaptContext, done: Set<Element>): boolean {
  if (done.has(el)) return false;
  const $img = $(el);
  const current = $img.attr('src') ?? '';
  if (current === target) {
    done.add(el);
    return false; // уже подставлено — идемпотентность
  }
  const before = current || $img.attr('data-src') || $img.attr('srcset') || '';
  for (const a of STRIP_RESPONSIVE_ATTRS) $img.removeAttr(a);
  $img.attr('src', target);

  const parent = el.parent as Element | null;
  if (parent && (parent.tagName ?? '').toLowerCase() === 'picture') {
    $(parent).children('source').remove();
  }

  ctx.changes.push({ file: ctx.relPath, pass: 'image', element: 'img', attr: 'src', before, after: target, trigger });
  done.add(el);
  return true;
}

/** Подставляет target в `<source srcset>` (одиночный, без `<img>` в picture). */
function replaceSource($: Dom, el: Element, target: string, trigger: string, ctx: AdaptContext, done: Set<Element>): boolean {
  if (done.has(el)) return false;
  const $s = $(el);
  if (($s.attr('srcset') ?? '') === target) {
    done.add(el);
    return false;
  }
  const before = $s.attr('srcset') ?? $s.attr('data-srcset') ?? $s.attr('src') ?? '';
  $s.removeAttr('src');
  for (const a of STRIP_RESPONSIVE_ATTRS) $s.removeAttr(a);
  $s.attr('srcset', target);
  ctx.changes.push({ file: ctx.relPath, pass: 'image', element: 'source', attr: 'srcset', before, after: target, trigger });
  done.add(el);
  return true;
}

export const replaceProductImage: AdaptPass = ($, ctx) => {
  const config = ctx.config ?? BUILTIN_ADAPT_CONFIG;
  const target = resolveImageTarget(ctx.brief, config);
  if (!target) return {};

  const knownOwn = new Set(knownOwnImageBases(config));
  /** Значение атрибута надо заменить? Чужой макрос (первый прогон) ИЛИ наш старый base (re-point); не target. */
  const needsReplace = (v: string | undefined): boolean => !!v && v !== target && (hasForeignMacro(v) || knownOwn.has(v));
  const triggerFor = (v: string): string => (hasForeignMacro(v) ? 'foreign-macro' : 're-point');

  let replaced = 0;
  const done = new Set<Element>();

  // ── T2: продуктовый <img> внутри offer-ссылки ──
  $(OFFER_ANCHOR_SEL).each((_, node) => {
    const el = node as Element;
    if (isNonProduct($, el)) return;
    if (replaceImg($, el, target, 'offer-anchor', ctx, done)) replaced++;
  });

  // ── T1 + re-point: чужой макрос ИЛИ наш старый base в src/srcset/... у <img>/<source> ──
  $('img, source').each((_, node) => {
    const el = node as Element;
    if (done.has(el)) return;
    if (el.parent == null) return; // отсоединён при схлопывании <picture> — пропускаем (не двоим счётчик)
    const $el = $(el);
    const hit = IMG_URL_ATTRS.map((a) => $el.attr(a)).find(needsReplace);
    if (hit === undefined) return;
    const trigger = triggerFor(hit);
    const tag = (el.tagName ?? '').toLowerCase();
    if (tag === 'source') {
      // <source> в <picture> рядом с <img> → схлопываем picture через <img> (data-srcset источника уходит).
      const parent = el.parent as Element | null;
      const sibImg =
        parent && (parent.tagName ?? '').toLowerCase() === 'picture'
          ? ($(parent).children('img').get(0) as Element | undefined)
          : undefined;
      if (sibImg) {
        if (replaceImg($, sibImg, target, trigger, ctx, done)) replaced++;
      } else if (replaceSource($, el, target, trigger, ctx, done)) {
        replaced++;
      }
    } else if (replaceImg($, el, target, trigger, ctx, done)) {
      replaced++;
    }
  });

  // ── чужой макрос ИЛИ наш старый base в url() инлайн-стиля (фоновое/продуктовое изображение) ──
  $('[style]').each((_, node) => {
    const el = node as Element;
    const $el = $(el);
    const style = $el.attr('style') ?? '';
    if (!style.includes('url(')) return;
    let changed = false;
    const newStyle = style.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (whole, _quote: string, inner: string) => {
      if (!needsReplace(inner)) return whole;
      changed = true;
      replaced++;
      ctx.changes.push({
        file: ctx.relPath,
        pass: 'image',
        element: (el.tagName ?? '').toLowerCase(),
        attr: 'style',
        before: inner,
        after: target,
        trigger: hasForeignMacro(inner) ? 'foreign-macro-bg' : 're-point-bg',
      });
      // всегда оборачиваем в кавычки: целевой URL (особенно в режиме 'file') может содержать пробел/скобку
      return `url('${target}')`;
    });
    if (changed) $el.attr('style', newStyle);
  });

  return replaced ? { imagesReplaced: replaced } : {};
};
