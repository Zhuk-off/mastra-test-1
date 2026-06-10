import type { Element } from 'domhandler';
import type { DomPass } from '../../types.js';
import type { ResourceKind } from '../../utils/allowlist.js';
import { classifyResource } from '../../utils/allowlist.js';
import { parseFragment, serializeFragment } from '../../utils/html-dom.js';
import { quarantineNode } from '../../utils/quarantine.js';

/** Ресурс-несущие теги внутри <noscript> и их тип для classifyResource. */
const NOSCRIPT_RESOURCES: Array<{ selector: string; kind: ResourceKind }> = [
  { selector: 'script[src]', kind: 'script' },
  { selector: 'iframe[src]', kind: 'iframe' },
  { selector: 'img[src]', kind: 'img' },
];

/**
 * `<noscript>` через БЕЛЫЙ СПИСОК (2A-4). Внешний парсер держит содержимое noscript как
 * ТЕКСТ (scriptingEnabled, см. DOM-3), поэтому DOM-селекторы его не видят. Раньше проход
 * матчил содержимое блок-листом из 13 слов → НЕИЗВЕСТНЫЙ трекер
 * (`<noscript><img src="//evil-analytics.xyz/p">`) выживал, а при совпадении удалялся ВЕСЬ
 * noscript (терялся легит fallback).
 *
 * Теперь содержимое разбираем вложенным фрагментным cheerio и гоним те же allowlist-решения,
 * что и для обычных ресурсов: trusted/локальный → keep, известный трекер → remove, прочий
 * чужой → quarantine. Вырезаем ТОЛЬКО опасные узлы (хирургия), легитимный fallback остаётся.
 */
export const removeNoscriptTrackers: DomPass = ($, ctx) => {
  let noscriptsRemoved = 0;
  $('noscript').each((_, el) => {
    const inner = $(el).html() ?? '';
    if (!inner.trim()) return;

    const frag = parseFragment(inner);
    let changed = false;

    for (const { selector, kind } of NOSCRIPT_RESOURCES) {
      frag(selector).each((_i, node) => {
        const src = frag(node).attr('src') ?? '';
        const c = classifyResource(src, kind);
        if (c.action === 'keep') return;
        // И remove, и quarantine: узел опасен/чужой — вырезаем из noscript, сохраняем запись.
        quarantineNode(frag, node as Element, ctx, `noscript-${kind}`, `${c.reason} (в <noscript>, src=${src})`);
        changed = true;
      });
    }

    if (!changed) return;
    const cleaned = serializeFragment(frag).trim();
    if (cleaned) $(el).html(cleaned);
    else $(el).remove(); // в noscript не осталось ничего полезного
    noscriptsRemoved++;
  });
  return noscriptsRemoved ? { noscriptsRemoved } : {};
};
