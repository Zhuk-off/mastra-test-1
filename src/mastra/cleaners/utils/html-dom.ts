/**
 * Разбор/сериализация HTML через cheerio (движок parse5 — браузерная
 * реконструкция структуры). В отличие от регулярок, корректно чинит незакрытые
 * и смещённые теги, сохраняет doctype, сырое содержимое <script>/<style> и комментарии.
 */
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

export type Dom = CheerioAPI;

/**
 * true, если в файле есть PHP/ASP-вставки — такой файл cheerio парсить нельзя
 * (parse5 превратит `<?php ?>` в bogus-комментарий и испортит серверный код).
 *
 * Детектируем РЕАЛЬНЫЕ серверные блоки, а не любой `<?`/`<%` — иначе тривиальный
 * обход: положив в лендинг текст `<? ` или огрызок `<% `, атакующий молча выключал
 * ВСЮ HTML-очистку (трекеры/exfil/CSP не применялись). См. DOM-1 / PIPE-1.
 *  - `<?php` и `<?=` — однозначно PHP (литерал в тексте практически невозможен),
 *    флагаем даже без закрывающего `?>` (PHP допускает опускать его в конце файла);
 *  - короткий `<? … ?>` и ASP/JSP/EJS `<% … %>` — ТОЛЬКО при наличии закрытия,
 *    иначе обычный текст («cheap price <? maybe») и огрызок («<!-- <% -->») не
 *    считаются серверными;
 *  - `<?xml …?>` серверным тегом НЕ считается (после `<?` идёт `x`, не пробел/php/=).
 *
 * Trade-off: bare short-open `<? …` без `php`/`=` и без `?>` неотличим от текста —
 * такой (редкий, legacy, обычно выключенный short_open_tag) блок не ловим.
 */
export function hasServerTags(html: string): boolean {
  if (/<\?php\b/i.test(html) || /<\?=/.test(html)) return true;
  if (/<\?[ \t\r\n][\s\S]*?\?>/.test(html)) return true;
  if (/<%[\s\S]*?%>/.test(html)) return true;
  return false;
}

export function parseHtml(html: string): Dom {
  return cheerio.load(html);
}

export function serializeHtml($: Dom): string {
  return $.html();
}
