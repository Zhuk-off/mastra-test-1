/** Ключевые слова в inline <script> — если есть, скрипт удаляется. */
export const TRACKER_INLINE_KEYWORDS: string[] = [
  // Google
  'gtag(',
  'gtag.js',
  'GoogleAnalyticsObject',
  '_gaq.push',
  'window.dataLayer',
  'dataLayer.push',
  // Facebook
  'fbq(',
  '!function(f,b,e,v,n,t,s)',
  'connect.facebook.net',
  // Yandex
  'ym(',
  '(function(m,e,t,r,i,k,a)',
  'yandex_metrika',
  // Hotjar / Mixpanel / Segment / Amplitude / Intercom
  'hjid',
  'hotjar',
  'mixpanel',
  'analytics.load',
  'amplitude.getInstance',
  'Intercom(',
  'window.Intercom',
  // Прочее
  'PostAffTracker',
  'PAPCookie',
  'OptiMonk',
  'window.OptiMonk',
  'SplitHero',
  'splithero',
  'crazyegg',
  '_paq.push',
  '_hsq.push',
  // CloudFlare insights
  'beacon.min.js',
  'cf-beacon',
  // Microsoft Clarity
  'clarity(',
  'window.clarity',
  // LinkedIn
  '_linkedin_data_partner_id',
  'lintrk(',
  // Twitter / X pixel
  'twq(',
  // Cookie consent
  'CookieConsent',
  'Cookiebot',
  'OneTrust',
  'OptanonWrapper',
  // Heap Analytics
  'heap.load(',
  'window.heap',
  // VK Pixel
  'VK.Retargeting',
  // Zendesk / LiveChat widgets
  'zE(',
  'zEmbed',
  'LiveChatWidget',
];

/** Ключевые слова для удаления <noscript>. */
export const TRACKER_NOSCRIPT_KEYWORDS: string[] = [
  'google-analytics',
  'googletagmanager',
  'doubleclick',
  'facebook.com/tr',
  'mc.yandex',
  'tiktok.com',
  'bat.bing',
  'clarity.ms',
  'linkedin.com',
  'ads-twitter.com',
  'cookiebot',
  'onetrust',
  'vk.com/rtrg',
];
