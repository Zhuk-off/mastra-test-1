import type { DomPass } from '../../types.js';
import { classifyResource, dangerousSchemeOf } from '../../utils/allowlist.js';

/**
 * 2D-6: навигационные href с ОПАСНОЙ СХЕМОЙ (`javascript:`/`vbscript:`/`data:`/`blob:`/
 * `filesystem:`) на `<a>`/`<area>`. Эти схемы несут исполняемый код или встраивают чужой
 * контент по клику — классический interaction-gated угон трафика (политика владельца №1:
 * чужая навигация/исполнение по клику = кража, не легит → действие, а не WARN).
 *
 * Классификатор (`classifyResource(href,'anchor')`) уже умеет это решать, но до сих пор его
 * для `<a>` никто не звал: `replaceOfferLinks` зовёт только `looksLikeOfferUrl`, который
 * требует `http(s)`/`//` и `javascript:`/`data:` молча пропускает. Этот проход закрывает
 * проводку.
 *
 * Нейтрализуем ХИРУРГИЧЕСКИ — снимаем ТОЛЬКО href, сам элемент и его видимый текст (напр.
 * кнопку CTA) сохраняем, чтобы не ломать вёрстку. Оригинал кладём в карантин: это и
 * восстановимо при ложном срабатывании, и на этапе адаптации человек видит, какую кнопку
 * нужно привязать к настоящему офферу.
 *
 * Важно: трогаем ТОЛЬКО опасные схемы. Внешние http(s)-хосты остаются зоной
 * offer-detector / `replaceOfferLinks` — иначе бы здесь ломались легитимные внешние
 * ссылки (соцсети, правовые страницы; ср. OFFER-1).
 */
export const stripDangerousHrefs: DomPass = ($, ctx) => {
  let dangerousHrefsNeutralized = 0;
  $('a[href], area[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (!dangerousSchemeOf(href)) return; // только опасные схемы (scope 2D-6)

    const c = classifyResource(href, 'anchor');
    if (c.action === 'keep') return; // подстраховка; для опасной схемы не наступает

    // Карантин-запись (как при quarantineNode, но элемент НЕ удаляем — только href).
    const snippet = ($.html(el) || '').slice(0, 2000);
    (ctx.quarantine ??= []).push({
      kind: 'anchor-href',
      reason: `${c.reason} (href нейтрализован)`,
      snippet,
      file: ctx.relPath,
    });
    ctx.log.push({
      file: ctx.relPath,
      type: 'QUARANTINE',
      description: `[anchor-href] ${c.reason} (href нейтрализован)`,
      codeSnippet: snippet.slice(0, 300),
    });

    $(el).removeAttr('href');
    dangerousHrefsNeutralized++;
  });
  return dangerousHrefsNeutralized ? { dangerousHrefsNeutralized } : {};
};
