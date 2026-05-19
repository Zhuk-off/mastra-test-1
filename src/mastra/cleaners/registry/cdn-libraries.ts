export interface CdnLibraryDef {
  name: string;
  filePattern: RegExp;
  extractVersion: (match: RegExpMatchArray) => string | null;
  getCdnUrl: (version: string) => string;
}

export const CDN_LIBRARIES: CdnLibraryDef[] = [
  {
    name: 'jquery',
    filePattern: /^jquery[.-](\d+\.\d+(?:\.\d+)?)(?:\.slim)?(?:\.min)?\.js$/i,
    extractVersion: (m) => m[1]!,
    getCdnUrl: (v) => `https://code.jquery.com/jquery-${v}.min.js`,
  },
  {
    name: 'bootstrap-js',
    filePattern: /^bootstrap[.-](\d+\.\d+(?:\.\d+)?)(?:\.bundle)?(?:\.min)?\.js$/i,
    extractVersion: (m) => m[1]!,
    getCdnUrl: (v) => `https://cdn.jsdelivr.net/npm/bootstrap@${v}/dist/js/bootstrap.bundle.min.js`,
  },
  {
    name: 'bootstrap-css',
    filePattern: /^bootstrap[.-](\d+\.\d+(?:\.\d+)?)(?:\.min)?\.css$/i,
    extractVersion: (m) => m[1]!,
    getCdnUrl: (v) => `https://cdn.jsdelivr.net/npm/bootstrap@${v}/dist/css/bootstrap.min.css`,
  },
  {
    name: 'popper-js',
    filePattern: /^popper[.-](\d+\.\d+(?:\.\d+)?)(?:\.min)?\.js$/i,
    extractVersion: (m) => m[1]!,
    getCdnUrl: (v) => `https://cdn.jsdelivr.net/npm/@popperjs/core@${v}/dist/umd/popper.min.js`,
  },
];
