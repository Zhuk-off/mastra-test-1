/** Паттерны в URL, указывающие на оффер (а не на информационную страницу). */
export const OFFER_URL_PATTERNS: RegExp[] = [
  /[?&]_lp=/i,
  /[?&]_token=/i,
  /[?&]click_id=/i,
  /[?&]subid=/i,
  /[?&]sub_id=/i,
  /[?&]affiliate=/i,
  /[?&]aff_id=/i,
  /[?&]offer=/i,
  /[?&]order=/i,
  /[?&]checkout=/i,
  /[?&]buy=/i,
  /[?&]redirect=/i,
  /[?&]goto=/i,
  /[?&]campaign=/i,
  /[?&]adset=/i,
  /[?&]pixel=/i,
  /[?&]fbclid=/i,
  /[?&]utm_/i,
  /\/click\//i,
  /\/redirect\//i,
  /\/go\//i,
  /\/offer\//i,
  /\/order\//i,
  /\/checkout\//i,
  /\/buy\//i,
];

/** Пути, которые НЕ являются офферными (информационные страницы). */
export const NON_OFFER_PATH_PATTERNS: RegExp[] = [
  /^\/(privacy|policy|privacy-policy|terms|terms-of-service|tos|contact|about|faq|help|support|blog|news)(\/|$)/i,
  /^\/wp-(content|admin|includes|json)\//i,
];
