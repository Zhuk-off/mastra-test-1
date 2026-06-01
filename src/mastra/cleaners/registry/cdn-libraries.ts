/**
 * Известные библиотеки для репина на официальный CDN.
 *
 * identify(url) распознаёт ИМЕННО ядро библиотеки (не плагины) по имени файла
 * и достаёт версию из URL любого вида:
 *   code.jquery.com/jquery-3.6.1.min.js   (версия в имени)
 *   /ajax/libs/jquery/3.6.1/jquery.js     (версия в пути — cdnjs и фейки вроде jsdeliveris.com)
 *   /npm/jquery@3.6.1/dist/jquery.js       (версия после @)
 */
export interface CdnLibraryDef {
  name: string;
  /** Версия, если URL ссылается на ядро этой библиотеки; иначе null. */
  identify: (url: string) => string | null;
  /** Официальный CDN-URL по версии. */
  getCdnUrl: (version: string) => string;
}

function lastSegment(url: string): string {
  const noQuery = url.split(/[?#]/)[0] ?? '';
  return (noQuery.split('/').pop() ?? '').toLowerCase();
}

/** Достаёт версию вида major.minor[.patch] из URL: @1.2.3 | /1.2.3/ | -1.2.3. */
function extractVersion(url: string): string | null {
  const m = /[@/-](\d+\.\d+(?:\.\d+)?)(?=[/.\-]|$)/.exec(url);
  return m ? m[1]! : null;
}

/** Хелпер: распознавание по regex имени файла (ядро) + извлечение версии из всего URL. */
function byFile(fileRe: RegExp): (url: string) => string | null {
  return (url: string) => (fileRe.test(lastSegment(url)) ? extractVersion(url) : null);
}

export const CDN_LIBRARIES: CdnLibraryDef[] = [
  {
    name: 'jquery',
    identify: byFile(/^jquery(?:-[\d.]+)?(?:\.slim)?(?:\.min)?\.js$/),
    getCdnUrl: (v) => `https://code.jquery.com/jquery-${v}.min.js`,
  },
  {
    name: 'bootstrap-js',
    identify: byFile(/^bootstrap(?:-[\d.]+)?(?:\.bundle)?(?:\.min)?\.js$/),
    getCdnUrl: (v) => `https://cdn.jsdelivr.net/npm/bootstrap@${v}/dist/js/bootstrap.bundle.min.js`,
  },
  {
    name: 'bootstrap-css',
    identify: byFile(/^bootstrap(?:-[\d.]+)?(?:\.min)?\.css$/),
    getCdnUrl: (v) => `https://cdn.jsdelivr.net/npm/bootstrap@${v}/dist/css/bootstrap.min.css`,
  },
  {
    name: 'popper',
    identify: byFile(/^popper(?:-[\d.]+)?(?:\.min)?\.js$/),
    getCdnUrl: (v) => `https://cdn.jsdelivr.net/npm/@popperjs/core@${v}/dist/umd/popper.min.js`,
  },
  {
    name: 'swiper-js',
    identify: byFile(/^swiper(?:-bundle)?(?:-[\d.]+)?(?:\.min)?\.js$/),
    getCdnUrl: (v) => `https://cdn.jsdelivr.net/npm/swiper@${v}/swiper-bundle.min.js`,
  },
  {
    name: 'swiper-css',
    identify: byFile(/^swiper(?:-bundle)?(?:-[\d.]+)?(?:\.min)?\.css$/),
    getCdnUrl: (v) => `https://cdn.jsdelivr.net/npm/swiper@${v}/swiper-bundle.min.css`,
  },
  {
    name: 'slick',
    identify: byFile(/^slick(?:-[\d.]+)?(?:\.min)?\.js$/),
    getCdnUrl: (v) => `https://cdn.jsdelivr.net/npm/slick-carousel@${v}/slick/slick.min.js`,
  },
  {
    name: 'owl-carousel',
    identify: byFile(/^owl\.carousel(?:-[\d.]+)?(?:\.min)?\.js$/),
    getCdnUrl: (v) => `https://cdn.jsdelivr.net/npm/owl.carousel@${v}/dist/owl.carousel.min.js`,
  },
  {
    name: 'aos',
    identify: byFile(/^aos(?:-[\d.]+)?(?:\.min)?\.js$/),
    getCdnUrl: (v) => `https://cdn.jsdelivr.net/npm/aos@${v}/dist/aos.js`,
  },
  {
    name: 'gsap',
    identify: byFile(/^gsap(?:-[\d.]+)?(?:\.min)?\.js$/),
    getCdnUrl: (v) => `https://cdn.jsdelivr.net/npm/gsap@${v}/dist/gsap.min.js`,
  },
];
