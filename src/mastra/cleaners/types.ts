export interface CleanStats {
  htmlFilesProcessed: number;
  phpFilesProcessed: number;
  scriptsRemoved: number;
  inlineScriptsRemoved: number;
  noscriptsRemoved: number;
  linksRemoved: number;
  metasRemoved: number;
  jsonLdRemoved: number;
  imgPixelsRemoved: number;
  metaRefreshRemoved: number;
  baseHrefRemoved: number;
  objectEmbedsRemoved: number;
  eventAttrsRemoved: number;
  svgFilesProcessed: number;
  svgItemsRemoved: number;
  jsFilesScanned: number;
  jsItemsRemoved: number;
  cssFilesScanned: number;
  cssItemsRemoved: number;
  externalDirsRemoved: number;
  sourceMapsDeleted: number;
  sourceMapRefsStripped: number;
  offerLinksReplaced: number;
  bytesBefore: number;
  bytesAfter: number;
}

export interface ChangelogEntry {
  file: string;
  type: string;
  description: string;
  codeSnippet?: string;
  lineNumber?: number;
}

export interface PassContext {
  siteDir: string;
  mainHost: string;
  filePath: string;
  relPath: string;
  log: ChangelogEntry[];
}

// Поля CleanStats, относящиеся к HTML-проходам.
export type HtmlStatsKey =
  | 'scriptsRemoved'
  | 'inlineScriptsRemoved'
  | 'noscriptsRemoved'
  | 'linksRemoved'
  | 'metasRemoved'
  | 'jsonLdRemoved'
  | 'imgPixelsRemoved'
  | 'metaRefreshRemoved'
  | 'baseHrefRemoved'
  | 'objectEmbedsRemoved'
  | 'eventAttrsRemoved'
  | 'offerLinksReplaced';

export type HtmlStatsDelta = Partial<Record<HtmlStatsKey, number>>;

export interface HtmlPassResult {
  html: string;
  counts: HtmlStatsDelta;
}

export type HtmlPass = (html: string, ctx: PassContext) => HtmlPassResult;

export interface CleanSiteOptions {
  // Зарезервировано на будущее. В этом рефакторинге не использовать.
  readonly _reserved?: never;
}
