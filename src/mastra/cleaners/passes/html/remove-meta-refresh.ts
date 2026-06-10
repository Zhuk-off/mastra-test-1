import type { DomPass } from '../../types.js';

/**
 * `<meta http-equiv="refresh">` — автоматический редирект/перезагрузка. На одностраничном
 * лендинге арбитража авто-редирект не нужен: трафик идёт на оффер по КЛИКУ (CTA → `{offer}`),
 * а мгновенный meta-refresh — это либо клоакинг (лендинг→оффер автоматом), либо угон на чужой
 * хост (owner decision #1: чужой редирект = кража → действие, не WARN). Поэтому снимаем ЛЮБОЙ
 * refresh (с url или чистый таймер).
 *
 * 2B-2: раньше гейт был `isExternalUrl(url)`, и редирект выживал в двух случаях —
 *  - ОТНОСИТЕЛЬНЫЙ (`content="0;url=offer.html"`) → `isExternalUrl`=false → kept;
 *  - ЗАКАВЫЧЕННЫЙ (`content="0;url='https://evil'"`) → кавычка ломала шаг `^https?://` → kept,
 *    хотя браузеры к кавычкам в meta-refresh снисходительны и редирект исполняют.
 * Теперь судьба не зависит от разбора url. Оригинальный `content` (целевой URL) кладём в
 * карантин/отчёт — восстановимо и видно, какой редирект привязать к настоящему офферу.
 */
export const removeMetaRefresh: DomPass = ($, ctx) => {
  let metaRefreshRemoved = 0;
  $('meta[http-equiv]').each((_, el) => {
    const he = ($(el).attr('http-equiv') ?? '').toLowerCase().trim();
    if (he !== 'refresh') return;

    const content = ($(el).attr('content') ?? '').trim();
    const snippet = ($.html(el) || '').slice(0, 2000);
    const reason = `Авто-редирект meta-refresh снят${content ? `: ${content}` : ' (таймер)'}`;
    (ctx.quarantine ??= []).push({ kind: 'meta-refresh', reason, snippet, file: ctx.relPath });
    ctx.log.push({
      file: ctx.relPath,
      type: 'META_REFRESH_REMOVED',
      description: reason,
      codeSnippet: snippet.slice(0, 300),
    });

    $(el).remove();
    metaRefreshRemoved++;
  });
  return metaRefreshRemoved ? { metaRefreshRemoved } : {};
};
