/** Глобальные функции трекеров — их вызовы в inline <script> удалять */
export const SUSPICIOUS_CALL_GLOBALS = new Set([
  'fbq', 'gtag', '_gaq', 'ga', 'ym', '_paq', 'twq',
  'mixpanel', 'amplitude', 'clarity', '_hsq', 'heap',
  'Intercom', 'zE', 'hj', 'PostAffTracker', 'SplitHero',
  'lintrk', 'ttq', 'snaptr', 'pintrk',
]);
