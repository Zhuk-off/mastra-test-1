export interface KnownLib {
  name: string;
  /** Regex по содержимому JS-файла для опознания библиотеки */
  contentSignature: RegExp;
  /** Regex по содержимому для извлечения версии */
  versionExtractor: RegExp;
  /** Версия по умолчанию если не нашли в файле */
  fallbackVersion: string;
  /** Функция генерации CDN URL по версии */
  cdnUrl: (version: string) => string;
  /** Функция генерации CDN URL для CSS (если применимо) */
  cdnCssUrl?: (version: string) => string;
}

export const KNOWN_LIBS: KnownLib[] = [
  {
    name: 'jquery',
    contentSignature: /jQuery\.fn\.jquery\s*=|jQuery JavaScript Library/i,
    versionExtractor: /jQuery(?:\.fn\.jquery)?\s*=\s*["']([\d.]+)["']|jQuery\s+(?:JavaScript\s+Library\s+)?v([\d.]+)/,
    fallbackVersion: '3.7.1',
    cdnUrl: (v) => `https://code.jquery.com/jquery-${v}.min.js`,
  },
  {
    name: 'bootstrap-js',
    contentSignature: /Bootstrap v[\d.]+ \(https:\/\/getbootstrap\.com\/?\)/,
    versionExtractor: /Bootstrap v([\d.]+)/,
    fallbackVersion: '5.3.3',
    cdnUrl: (v) => `https://cdn.jsdelivr.net/npm/bootstrap@${v}/dist/js/bootstrap.bundle.min.js`,
  },
  {
    name: 'popper',
    contentSignature: /\* Popper\.js v[\d.]+|@popperjs\/core/,
    versionExtractor: /Popper\.js v([\d.]+)|@popperjs\/core@([\d.]+)/,
    fallbackVersion: '2.11.8',
    cdnUrl: (v) => `https://cdn.jsdelivr.net/npm/@popperjs/core@${v}/dist/umd/popper.min.js`,
  },
  {
    name: 'swiper',
    contentSignature: /Swiper\s+[\d.]+|Swiper JavaScript Library/i,
    versionExtractor: /Swiper\s+([\d.]+)/,
    fallbackVersion: '11.1.4',
    cdnUrl: (v) => `https://cdn.jsdelivr.net/npm/swiper@${v}/swiper-bundle.min.js`,
    cdnCssUrl: (v) => `https://cdn.jsdelivr.net/npm/swiper@${v}/swiper-bundle.min.css`,
  },
  {
    name: 'lodash',
    contentSignature: /Lodash [\d.]+ \(Custom Build\)|lodash\.com\/docs/,
    versionExtractor: /Lodash ([\d.]+)/,
    fallbackVersion: '4.17.21',
    cdnUrl: (v) => `https://cdn.jsdelivr.net/npm/lodash@${v}/lodash.min.js`,
  },
];
