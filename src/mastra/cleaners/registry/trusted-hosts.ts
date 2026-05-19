/** Доверенные CDN-хосты — их внешние URL не считаются угрозой. */
export const TRUSTED_HOSTS = new Set<string>([
  'code.jquery.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'ajax.googleapis.com',
  'stackpath.bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com',
]);
