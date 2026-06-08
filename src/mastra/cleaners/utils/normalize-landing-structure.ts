import { resolve, dirname, join, relative, extname, basename, isAbsolute } from 'node:path';
import { readFile, writeFile, rename, mkdir, stat, open, link, unlink, readdir, rmdir, copyFile, realpath } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { walkFiles } from './walk.js';

/**
 * Stats returned by normalizeLandingStructure.
 * - pathsRewritten    — number of *resources* for which at least one replacement was made in HTML.
 *                       Not the same as the total number of replaced occurrences.
 * - cssPathsRewritten — same, but counted per CSS file.
 */
export interface NormalizeStats {
  mainFileFound: string;
  /**
   * True if the main file's basename changed (e.g. `landing.html` → `index.html`).
   * False when only the directory changed (e.g. `subdir/index.html` → `index.html`).
   */
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

const EXT_TO_DIR: Record<string, string> = {
  // CSS
  '.css': 'css',
  '.scss': 'css',
  '.sass': 'css',
  '.less': 'css',
  '.styl': 'css',
  // JS
  '.js': 'js',
  '.cjs': 'js',
  '.mjs': 'js',
  '.jsx': 'js',
  // Images
  '.jpg': 'images',
  '.jpeg': 'images',
  '.jfif': 'images',
  '.png': 'images',
  '.gif': 'images',
  '.svg': 'images',
  '.webp': 'images',
  '.avif': 'images',
  '.apng': 'images',
  '.ico': 'images',
  '.bmp': 'images',
  '.tiff': 'images',
  '.tif': 'images',
  '.heic': 'images',
  '.heif': 'images',
  // Fonts
  '.woff': 'fonts',
  '.woff2': 'fonts',
  '.ttf': 'fonts',
  '.eot': 'fonts',
  '.otf': 'fonts',
  // Video
  '.mp4': 'video',
  '.webm': 'video',
  '.ogv': 'video',
  '.mov': 'video',
  // Audio
  '.mp3': 'audio',
  '.ogg': 'audio',
  '.oga': 'audio',
  '.wav': 'audio',
  '.aac': 'audio',
  '.m4a': 'audio',
  '.flac': 'audio',
  '.opus': 'audio',
  // Documents / misc
  '.pdf': 'assets',
  '.zip': 'assets',
  '.json': 'assets',
  '.xml': 'assets',
  '.txt': 'assets',
  '.wasm': 'assets',
};

async function findMainFile(
  siteDir: string,
): Promise<{ path: string; isPhp: boolean } | null> {
  const candidates: Array<{ path: string; score: number; isPhp: boolean }> = [];

  for await (const file of walkFiles(siteDir)) {
    const ext = extname(file).toLowerCase();
    if (ext !== '.html' && ext !== '.htm' && ext !== '.php') continue;

    const relPath = relative(siteDir, file);
    const depth = relPath.split(/[\\/]/).length - 1;
    const isPhp = ext === '.php';
    const base = basename(file).toLowerCase();
    const isIndexHtml = base === 'index.html' || base === 'index.htm';
    const isIndexPhp = base === 'index.php';

    let score = 0;

    if (isIndexHtml) score += 1000;
    else if (isIndexPhp) score += 900;

    score -= depth * 50;

    const content = await readHead(file);  // Bug #12: read only first 64 KB
    const fileStat = await stat(file);
    score += Math.min(fileStat.size / 200, 100);  // Bug #12: use actual size, clamped

    if (/<title[^>]*>[^<\s][^<]*<\/title>/i.test(content)) score += 30;
    if (/<h1[\s>]/i.test(content)) score += 20;
    if (/<form[\s>]/i.test(content)) score += 40;
    if (/\{offer\}/i.test(content)) score += 50;

    const resourceCount = (
      content.match(/<(link|script|img|source|video|audio|iframe)[\s>]/gi) || []
    ).length;
    score += resourceCount * 2;

    candidates.push({ path: file, score, isPhp });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return { path: candidates[0]!.path, isPhp: candidates[0]!.isPhp };
}

// Bug #12 fix: read only the first 64 KB of a file for scoring (avoids loading entire large files)
async function readHead(file: string, bytes = 64 * 1024): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

function isRelativeUrl(url: string): boolean {
  if (!url) return false;
  // Bug #9 fix: reject any URI scheme generically (http:, mailto:, data:, blob:, tel:, etc.)
  if (/^[a-z][a-z0-9+.\-]*:/i.test(url)) return false;
  if (url.startsWith('//')) return false;
  if (url.startsWith('#')) return false;
  // Пропускаем абсолютные пути от корня домена — мы не знаем root
  if (url.startsWith('/')) return false;
  return true;
}

/** true если abs лежит ВНУТРИ root по нормализованному пути (ловит `../`). */
function isPathInside(root: string, abs: string): boolean {
  const rel = relative(root, abs);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * NORM-1: ресурс обязан лежать ВНУТРИ siteDir. `realpath` резолвит и `..`, и
 * симлинки, и заодно подтверждает существование файла. Закрывает path traversal
 * (`<img src="../../../.aws/credentials">` → перенос+удаление файла вне siteDir)
 * и симлинк-побег из распакованного архива лендинга. `realRoot` — заранее
 * посчитанный `realpath(siteDir)` (сравниваем real-путь с real-путём).
 */
async function existingPathInsideSite(realRoot: string, abs: string): Promise<boolean> {
  try {
    return isPathInside(realRoot, await realpath(abs));
  } catch {
    return false; // файла нет / битый симлинк
  }
}

function getTargetDir(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (EXT_TO_DIR[ext]) return EXT_TO_DIR[ext];

  // Если последнее расширение неизвестно (например .下载), пробуем предпоследнее
  const name = basename(filePath);
  const withoutLastExt = name.slice(0, -ext.length) || name;
  const secondExt = extname(withoutLastExt).toLowerCase();
  if (secondExt && EXT_TO_DIR[secondExt]) {
    return EXT_TO_DIR[secondExt];
  }

  // Fallback: всё неизвестное — в assets/
  return 'assets';
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

// Bug #13 fix: suffix helper for collision naming
function suffix(name: string, counter: number): string {
  const ext = extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  return `${base}_${counter}${ext}`;
}

// Bug #13 fix: atomic move via link+unlink to eliminate TOCTOU race between stat and rename
async function moveFileUnique(src: string, destDir: string): Promise<string> {
  const name = basename(src);
  let counter = 0;
  while (true) {
    const candidate = counter === 0 ? join(destDir, name) : join(destDir, suffix(name, counter));
    if (src === candidate) return candidate;
    try {
      await link(src, candidate);
      await unlink(src);
      return candidate;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        counter++;
        if (counter > 100) throw new Error(`Too many collisions moving ${src}`);
        continue;
      }
      if (err.code === 'EXDEV') {
        // Cross-device — use copyFile with COPYFILE_EXCL (fails if dest exists) then unlink src
        try {
          await copyFile(src, candidate, fsConstants.COPYFILE_EXCL);
          await unlink(src).catch(() => {});
          return candidate;
        } catch (copyErr: any) {
          if (copyErr.code === 'EEXIST') {
            counter++;
            if (counter > 100) throw new Error(`Too many collisions moving ${src}`);
            continue;
          }
          throw copyErr;
        }
      }
      throw err;
    }
  }
}

interface ResourceRef {
  rawUrl: string;
  absolutePath: string;
  targetDir: string;
  newRelativePath: string;
  urlSuffix: string;
}

async function collectResources(
  indexHtmlPath: string,
  realSite: string,
): Promise<Map<string, ResourceRef>> {
  const html = await readFile(indexHtmlPath, 'utf8');
  const resources = new Map<string, ResourceRef>();
  const baseDir = dirname(indexHtmlPath);

  const patterns: Array<{ regex: RegExp; isSrcset?: boolean }> = [
    { regex: /<link\b[^>]*?\bhref\s*=\s*['"]([^'"]+)['"]/gi },
    { regex: /<script\b[^>]*?\bsrc\s*=\s*['"]([^'"]+)['"]/gi },
    { regex: /<img\b[^>]*?\bsrc\s*=\s*['"]([^'"]+)['"]/gi },
    { regex: /<source\b[^>]*?\bsrcset\s*=\s*['"]([^'"]+)['"]/gi, isSrcset: true },
    { regex: /<img\b[^>]*?\bsrcset\s*=\s*['"]([^'"]+)['"]/gi, isSrcset: true },
    // Bug #7 fix: collect <source src="..."> for <video>/<audio> elements
    { regex: /<source\b[^>]*?\bsrc\s*=\s*['"]([^'"]+)['"]/gi },
    { regex: /<video\b[^>]*?\bsrc\s*=\s*['"]([^'"]+)['"]/gi },
    { regex: /<audio\b[^>]*?\bsrc\s*=\s*['"]([^'"]+)['"]/gi },
    { regex: /<track\b[^>]*?\bsrc\s*=\s*['"]([^'"]+)['"]/gi },
    { regex: /<iframe\b[^>]*?\bsrc\s*=\s*['"]([^'"]+)['"]/gi },
    { regex: /url\(['"]?([^'")\s]+)['"]?\)/gi },
  ];

  for (const { regex, isSrcset } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null) {
      const matched = m[1]!.trim();
      const rawUrls: string[] = isSrcset
        ? matched.split(',').map(e => e.trim().split(/\s+/)[0]!).filter(Boolean)
        : [matched];

      for (const rawUrl of rawUrls) {
        if (!isRelativeUrl(rawUrl)) continue;

        const fsUrl = rawUrl.split('?')[0]!.split('#')[0]!;
        const urlSuffix = rawUrl.slice(fsUrl.length);
        const absolutePath = resolve(baseDir, decodePathSafe(fsUrl));
        // NORM-1: не выходить за siteDir (ни через ../, ни через симлинк). Заодно
        // подтверждает существование файла (раньше тут был stat).
        if (!(await existingPathInsideSite(realSite, absolutePath))) continue;

        const targetDir = getTargetDir(absolutePath);
        if (!targetDir) continue;

        const name = basename(absolutePath);
        const newRelativePath = join(targetDir, name);

        resources.set(rawUrl, {
          rawUrl,
          absolutePath,
          targetDir,
          newRelativePath,
          urlSuffix,
        });
      }
    }
  }

  return resources;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Bug #8 fix: decode percent-encoded URLs before resolving against filesystem
function decodePathSafe(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

// PHP-stripping: remove all PHP code blocks from the content
function stripPhpCode(content: string): string {
  // Handles: <?php ... ?>, <?= ... ?>, <? ... ?> (including multi-line blocks)
  return content.replace(/<\?(?:php|=)?[\s\S]*?\?>/gi, '');
}

// Bug #14 fix: recursively remove empty directories left behind after moving files
async function removeEmptyDirs(root: string, dir: string): Promise<void> {
  let entries: string[];
  try { entries = await readdir(dir); } catch { return; }
  for (const name of entries) {
    const full = join(dir, name);
    const st = await stat(full).catch(() => null);
    if (st?.isDirectory()) await removeEmptyDirs(root, full);
  }
  if (dir === root) return; // never remove the root itself
  const remaining = await readdir(dir).catch(() => null);
  if (remaining && remaining.length === 0) {
    await rmdir(dir).catch(() => {});
  }
}

export async function normalizeLandingStructure(
  siteDir: string,
): Promise<NormalizeStats> {
  const stats: NormalizeStats = {
    mainFileFound: '',
    mainFileRenamed: false,
    mainFileMoved: false,
    mainFileExtension: 'html',
    phpStripped: false,
    filesMoved: 0,
    pathsRewritten: 0,
    cssPathsRewritten: 0,
  };

  const main = await findMainFile(siteDir);
  if (!main) return stats;

  stats.mainFileFound = relative(siteDir, main.path);

  // NORM-1: реальный путь siteDir — эталон для проверки, что ресурс внутри сайта.
  const realSite = await realpath(siteDir).catch(() => siteDir);

  // Collect resources BEFORE renaming — paths in HTML are relative to the original location
  const resources = await collectResources(main.path, realSite);

  // Always output index.html regardless of original extension (PHP code will be stripped below)
  stats.mainFileExtension = 'html';
  const targetName = 'index.html';
  const targetIndexPath = join(siteDir, targetName);
  if (main.path !== targetIndexPath) {
    await rename(main.path, targetIndexPath);
    stats.mainFileMoved = true;
    // Bug #15 fix: mainFileRenamed is true only when the basename itself changed
    stats.mainFileRenamed = basename(main.path) !== targetName;
  }
  const movedFiles = new Map<string, string>();

  const dirs = new Set<string>();
  for (const res of resources.values()) {
    dirs.add(join(siteDir, res.targetDir));
  }
  for (const dir of dirs) {
    await ensureDir(dir);
  }

  for (const res of resources.values()) {
    const destDir = join(siteDir, res.targetDir);
    try {
      const newPath = await moveFileUnique(res.absolutePath, destDir);
      movedFiles.set(res.absolutePath, newPath);
      // Пересчитываем newRelativePath относительно корня, чтобы учесть суффикс коллизии
      res.newRelativePath = relative(siteDir, newPath).replace(/\\/g, '/') + res.urlSuffix;
      stats.filesMoved++;
    } catch {
      // already moved or missing
    }
  }

  let html = await readFile(targetIndexPath, 'utf8');

  // Strip PHP code blocks if the original file was a PHP file
  if (main.isPhp) {
    const stripped = stripPhpCode(html);
    if (stripped !== html) {
      stats.phpStripped = true;
      html = stripped;
    }
  }

  // Bug #11 fix: rewrite all srcset attributes in one pass — handles duplicate URLs and multiple entries
  const srcsetChangedUrls = new Set<string>();
  html = html.replace(
    /(\bsrcset\s*=\s*)(['"])([^'"]*)\2/gi,
    (_full, prefix: string, quote: string, value: string) => {
      let changed = false;
      const rewritten = value
        .split(',')
        .map((entry) => {
          const trimmed = entry.trim();
          if (!trimmed) return entry;
          const spaceIdx = trimmed.search(/\s/);
          const url = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
          const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx);
          const ref = resources.get(url);
          if (!ref) return trimmed;
          changed = true;
          srcsetChangedUrls.add(url);
          return ref.newRelativePath + rest;
        })
        .join(', ');
      if (!changed) return _full;
      return `${prefix}${quote}${rewritten}${quote}`;
    },
  );

  for (const res of resources.values()) {
    const escaped = escapeRegex(res.rawUrl);
    // Bug #4 fix: escape $ so String.replace doesn't treat $1/$2/$' as special patterns
    const safeNewPath = res.newRelativePath.replace(/\$/g, '$$$$');
    const before = html;
    html = html.replace(new RegExp(`([=\\(]\\s*['"])${escaped}(['"])`, 'g'), `$1${safeNewPath}$2`);
    html = html.replace(new RegExp(`(url\\()${escaped}(\\))`, 'gi'), `$1${safeNewPath}$2`);
    if (html !== before || srcsetChangedUrls.has(res.rawUrl)) stats.pathsRewritten++;
  }
  await writeFile(targetIndexPath, html, 'utf8');

  // Обрабатываем CSS файлы
  for (const [oldPath, newPath] of movedFiles) {
    if (extname(newPath).toLowerCase() !== '.css') continue;

    let css = await readFile(newPath, 'utf8');
    let cssChanged = false;
    const urlRegex = /url\(['"]?([^'")\s]+)['"]?\)/gi;
    let cssMatch: RegExpExecArray | null;
    const cssRefs: Array<{ rawUrl: string; newRel: string }> = [];

    while ((cssMatch = urlRegex.exec(css)) !== null) {
      const rawUrl = cssMatch[1]!.trim();
      if (!isRelativeUrl(rawUrl)) continue;

      const fsUrl = rawUrl.split('?')[0]!.split('#')[0]!;
      const urlSuffix = rawUrl.slice(fsUrl.length);
      const absPath = resolve(dirname(oldPath), decodePathSafe(fsUrl));

      let newFilePath: string;

      if (movedFiles.has(absPath)) {
        newFilePath = movedFiles.get(absPath)!;
      } else {
        // NORM-1: новый файл — только если он внутри siteDir (../ или симлинк наружу → пропуск);
        // existingPathInsideSite заодно подтверждает существование (раньше — stat).
        if (!(await existingPathInsideSite(realSite, absPath))) continue;

        const targetDir = getTargetDir(absPath);
        if (!targetDir) continue;

        const destDir = join(siteDir, targetDir);
        await ensureDir(destDir);

        try {
          newFilePath = await moveFileUnique(absPath, destDir);
          movedFiles.set(absPath, newFilePath);
          stats.filesMoved++;
        } catch {
          // уже перемещён или не существует — вычисляем путь предположительно
          newFilePath = join(destDir, basename(absPath));
        }
      }

      const newRel = relative(dirname(newPath), newFilePath).replace(/\\/g, '/') + urlSuffix;
      cssRefs.push({ rawUrl, newRel });
    }

    for (const ref of cssRefs) {
      const escaped = escapeRegex(ref.rawUrl);
      const safeNewRel = ref.newRel.replace(/\$/g, '$$$$');
      const before = css;
      css = css.replace(
        new RegExp(`url\\(['"]?${escaped}['"]?\\)`, 'g'),
        `url("${safeNewRel}")`,
      );
      if (css !== before) {
        cssChanged = true;
        stats.cssPathsRewritten++;
      }
    }

    if (cssChanged) {
      await writeFile(newPath, css, 'utf8');
    }
  }

  // Bug #14 fix: clean up empty directories left after moving files
  await removeEmptyDirs(siteDir, siteDir);

  return stats;
}
