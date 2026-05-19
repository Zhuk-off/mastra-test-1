/** Хосты, при совпадении с которыми <script>/<link>/<iframe> вырезается. */
export const TRACKER_HOSTS: string[] = [
  // Google
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'googleadservices.com',
  'googlesyndication.com',
  'doubleclick.net',
  'g.doubleclick.net',
  'stats.g.doubleclick.net',
  'region1.analytics.google.com',
  'analytics.google.com',
  'googleoptimize.com',
  // Yandex
  'mc.yandex.ru',
  'mc.yandex.com',
  'yandex.ru/metrika',
  'metrika.yandex.ru',
  // Facebook
  'connect.facebook.net',
  'facebook.com/tr',
  // Hotjar / CrazyEgg
  'static.hotjar.com',
  'hotjar.com',
  'crazyegg.com',
  // Mixpanel / Segment / Amplitude
  'cdn.mxpnl.com',
  'api.mixpanel.com',
  'cdn.segment.com',
  'api.segment.io',
  'api.amplitude.com',
  // Intercom / HubSpot / Drift
  'widget.intercom.io',
  'js.intercomcdn.com',
  'js.hsforms.net',
  'hubspot.com',
  'js.hs-scripts.com',
  'js.hs-banner.com',
  'js.driftt.com',
  // Tawk / Crisp
  'embed.tawk.to',
  'client.crisp.chat',
  // OptiMonk (попапы)
  'optimonk.com',
  'cdn-asset.optimonk.com',
  'cdn-account.optimonk.com',
  'cdn-limit.optimonk.com',
  'front.optimonk.com',
  'gs-cdn.optimonk.com',
  // SplitHero
  'splithero.com',
  'app.splithero.com',
  // PostAffiliatePro
  'postaffiliatepro.com',
  // Прочее
  'cloudflareinsights.com',
  'static.cloudflareinsights.com',
  'snapchat.com/p',
  'analytics.tiktok.com',
  'tiktok.com/i18n/pixel',
  'pinterest.com/ct',
  'ct.pinterest.com',
  'bat.bing.com',
  'sentry.io',
  'browser.sentry-cdn.com',
  // Microsoft Clarity
  'www.clarity.ms',
  'clarity.ms',
  // LinkedIn Insight Tag
  'snap.licdn.com',
  'px.ads.linkedin.com',
  // Twitter / X Pixel
  'static.ads-twitter.com',
  'analytics.twitter.com',
  // VK Pixel
  'mc.vk.com',
  'vk.com/rtrg',
  // Taboola / Outbrain
  'cdn.taboola.com',
  'amplify.outbrain.com',
  // Cookie consent banners
  'consent.cookiebot.com',
  'consentcdn.cookiebot.com',
  'cdn.cookielaw.org',
  'cookiehub.com',
  // Live-chat / Support widgets
  'static.zdassets.com',
  'cdn.livechatinc.com',
  // Heap Analytics
  'cdn.heapanalytics.com',
  'heapanalytics.com',
];

/** Имя <link rel="..."> для проверки на удаление. */
export const PRECONNECT_RELS = new Set(['dns-prefetch', 'preconnect', 'prefetch', 'preload']);
