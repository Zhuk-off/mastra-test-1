/**
 * Stats returned by normalizeLandingStructure.
 * - pathsRewritten    — number of *resources* for which at least one replacement was made in HTML.
 * - cssPathsRewritten — same, but for CSS files.
 */
export interface NormalizeStats {
  mainFileFound: string;
  /** True if the main file's basename changed (e.g. landing.html → index.html). */
  mainFileRenamed: boolean;
  /** True if the main file's path on disk changed — moved to root and/or renamed. */
  mainFileMoved: boolean;
  /** Always 'html' — the output file is always saved as index.html. */
  mainFileExtension: 'html';
  /** True if PHP code blocks were found and removed from the main file. */
  phpStripped: boolean;
  filesMoved: number;
  /** Number of resources for which at least one replacement was made in HTML. */
  pathsRewritten: number;
  /** Number of resources for which at least one replacement was made in CSS. */
  cssPathsRewritten: number;
}

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
  framesRemoved: number;
  localLibsReplaced: number;
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
  normalize?: NormalizeStats;

  // --- Advanced JS cleaning ---
  /** JS-файлы удалены как мёртвый код (0% coverage, нет event-handlers) */
  deadJsFilesRemoved: number;
  /** JS-файлы частично очищены (удалены exfil/dead функции, файл оставлен) */
  partialJsCleaned: number;
  /** Inline <script> блоки в HTML, из которых удалены exfil-вызовы */
  inlineExfilRemoved: number;
  /** Библиотеки без версии (jquery.js, vendor.js) заменены на CDN */
  unversionedLibsCdn: number;
  /** Метрик-файлы удалены (по AST-сигнатуре, не только по имени) */
  metricFilesRemoved: number;
  /** Предупреждения от детекторов (obfuscation, keylogger и т.д.) */
  detectorWarnings: number;
  /** JS-файлы удалены как обфусцированные (_0x vars, eval packer, fromCharCode) */
  obfuscatedFilesRemoved: number;
  /** true если найдены PHP-бэкдоры (require manual inspection) */
  phpBackdoorWarning: boolean;
}

export interface CdnReplacement {
  cdnUrl: string;
  integrity: string;
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
  cdnReplacements?: Map<string, CdnReplacement>;
  unversionedLibReplacements?: Map<string, CdnReplacement>;
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
  | 'framesRemoved'
  | 'localLibsReplaced'
  | 'eventAttrsRemoved'
  | 'offerLinksReplaced'
  | 'inlineExfilRemoved';

export type HtmlStatsDelta = Partial<Record<HtmlStatsKey, number>>;

export interface HtmlPassResult {
  html: string;
  counts: HtmlStatsDelta;
}

export type HtmlPass = (html: string, ctx: PassContext) => HtmlPassResult;

export interface CleanSiteOptions {
  /** Включить AST-анализ JS: metric file detection, obfuscation, exfil extraction */
  runAdvanced?: boolean;
  /** Запустить Playwright coverage analysis для обнаружения мёртвого JS */
  runCoverage?: boolean;
  /** Порог покрытия ниже которого файл считается мёртвым (по умолчанию 1%) */
  deadCoverageThreshold?: number;
}
