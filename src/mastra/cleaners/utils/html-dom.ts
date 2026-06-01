/**
 * Разбор/сериализация HTML через cheerio (движок parse5 — браузерная
 * реконструкция структуры). В отличие от регулярок, корректно чинит незакрытые
 * и смещённые теги, сохраняет doctype, сырое содержимое <script>/<style> и комментарии.
 */
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

export type Dom = CheerioAPI;

/** true, если в файле есть PHP/ASP-вставки — такой файл cheerio парсить нельзя (испортит <?php ?>). */
export function hasServerTags(html: string): boolean {
  return /<\?(php|=|\s)/i.test(html) || /<%[^>]/.test(html);
}

export function parseHtml(html: string): Dom {
  return cheerio.load(html);
}

export function serializeHtml($: Dom): string {
  return $.html();
}
