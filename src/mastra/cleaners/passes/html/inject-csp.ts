import type { DomPass } from '../../types.js';
import { CSP_META } from '../../registry/policy.js';

/**
 * Внедряет CSP-страховку в <head> (после charset). Идемпотентно: существующий
 * CSP-meta заменяется, не дублируется. Это последний рубеж — даже если что-то
 * просочилось мимо чистки, браузер заблокирует чужие запросы/скрипты.
 */
export const injectCsp: DomPass = ($) => {
  // Убираем уже существующие CSP-meta (любой регистр http-equiv).
  $('meta[http-equiv]')
    .filter((_, el) => ($(el).attr('http-equiv') ?? '').toLowerCase() === 'content-security-policy')
    .remove();

  if ($('head').length === 0) {
    if ($('html').length) $('html').prepend('<head></head>');
    else $.root().prepend('<head></head>');
  }

  const charset = $('head meta[charset]').first();
  if (charset.length) {
    charset.after('\n    ' + CSP_META);
  } else {
    $('head').prepend(CSP_META + '\n    ');
  }

  return { cspInjected: 1 };
};
