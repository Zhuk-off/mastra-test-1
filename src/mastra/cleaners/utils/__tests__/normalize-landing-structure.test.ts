import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { rm } from 'node:fs/promises';
import { normalizeLandingStructure } from '../normalize-landing-structure.js';

async function setup(
  siteDir: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(siteDir, relPath);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function read(p: string): Promise<string> {
  return readFile(p, 'utf8');
}

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'nls-test-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Basic happy-path
// ---------------------------------------------------------------------------

describe('happy path — flat structure', () => {
  it('finds index.html and moves css/js/images to subdirs', async () => {
    await setup(tmp, {
      'index.html': `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="style.css">
  <script src="app.js"></script>
</head>
<body>
  <img src="logo.png">
</body>
</html>`,
      'style.css': 'body { background: url("bg.jpg"); }',
      'app.js': 'console.log(1)',
      'logo.png': '',
      'bg.jpg': '',
    });

    const stats = await normalizeLandingStructure(tmp);

    expect(stats.mainFileFound).toBe('index.html');
    expect(stats.mainFileRenamed).toBe(false);
    expect(stats.filesMoved).toBeGreaterThanOrEqual(3);
    expect(stats.pathsRewritten).toBeGreaterThanOrEqual(3);

    const html = await read(join(tmp, 'index.html'));
    expect(html).toContain('href="css/style.css"');
    expect(html).toContain('src="js/app.js"');
    expect(html).toContain('src="images/logo.png"');

    expect(await exists(join(tmp, 'css/style.css'))).toBe(true);
    expect(await exists(join(tmp, 'js/app.js'))).toBe(true);
    expect(await exists(join(tmp, 'images/logo.png'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG #2: main file in subdirectory — paths must resolve from original location
// ---------------------------------------------------------------------------

describe('BUG #2 — main HTML in subdirectory', () => {
  it('collects and moves resources referenced relative to original subdir location', async () => {
    await setup(tmp, {
      'subdir/index.html': `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="css/style.css">
</head>
<body><h1>Hello</h1></body>
</html>`,
      'subdir/css/style.css': 'body{}',
    });

    const stats = await normalizeLandingStructure(tmp);

    expect(stats.mainFileFound).toBe('subdir/index.html');
    expect(stats.mainFileMoved).toBe(true);
    expect(stats.mainFileRenamed).toBe(false); // basename didn't change, only directory

    // CSS must have been found and moved
    expect(stats.filesMoved).toBeGreaterThanOrEqual(1);

    const html = await read(join(tmp, 'index.html'));
    // Path in HTML must point to new location, not the old broken relative path
    expect(html).toContain('href="css/style.css"');
    expect(await exists(join(tmp, 'css/style.css'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG #1: srcset URLs — files moved but paths NOT rewritten in HTML
// ---------------------------------------------------------------------------

describe('BUG #1 — srcset attribute paths rewritten', () => {
  it('rewrites URLs inside srcset after moving images', async () => {
    await setup(tmp, {
      'index.html': `<!DOCTYPE html>
<html>
<body>
  <img src="logo.png" srcset="logo.png 1x, logo@2x.png 2x">
  <source srcset="hero.webp 800w, hero@2x.webp 1600w">
</body>
</html>`,
      'logo.png': '',
      'logo@2x.png': '',
      'hero.webp': '',
      'hero@2x.webp': '',
    });

    await normalizeLandingStructure(tmp);

    const html = await read(join(tmp, 'index.html'));

    // All image files should be moved
    expect(await exists(join(tmp, 'images/logo.png'))).toBe(true);
    expect(await exists(join(tmp, 'images/logo@2x.png'))).toBe(true);

    // srcset URLs must be rewritten — this is the bug
    expect(html).not.toContain('srcset="logo.png');
    expect(html).toContain('images/logo.png');
    expect(html).toContain('images/logo@2x.png');
  });
});

// ---------------------------------------------------------------------------
// BUG #3: moveFileUnique — silent overwrite on Linux when names collide
// ---------------------------------------------------------------------------

describe('BUG #3 — collision handling: two files with same name in different dirs', () => {
  it('does not overwrite file when two source files have the same basename', async () => {
    await setup(tmp, {
      'index.html': `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="theme1/style.css">
  <link rel="stylesheet" href="theme2/style.css">
</head>
<body></body>
</html>`,
      'theme1/style.css': '.theme1 { color: red; }',
      'theme2/style.css': '.theme2 { color: blue; }',
    });

    await normalizeLandingStructure(tmp);

    const html = await read(join(tmp, 'index.html'));

    // Both CSS files must survive — one should be renamed with a suffix
    const cssDir = join(tmp, 'css');
    const { readdir } = await import('node:fs/promises');
    const cssFiles = await readdir(cssDir);

    // Both files must be present under different names
    expect(cssFiles.length).toBe(2);

    // HTML must reference both distinct paths
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    const uniqueHrefs = new Set(hrefs);
    expect(uniqueHrefs.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// BUG #4: $ in file paths corrupts String.replace replacement
// ---------------------------------------------------------------------------

describe('BUG #4 — dollar sign in file/path names', () => {
  it('handles $ in filename without corrupting HTML', async () => {
    await setup(tmp, {
      'index.html': `<!DOCTYPE html>
<html>
<head>
  <script src="bundle$1.js"></script>
</head>
<body></body>
</html>`,
      'bundle$1.js': 'var x=1',
    });

    await normalizeLandingStructure(tmp);

    const html = await read(join(tmp, 'index.html'));
    // Must point to the new location, not be garbled
    expect(html).toContain('src="js/bundle$1.js"');
    expect(html).not.toContain('src="js/bundle"');
    expect(await exists(join(tmp, 'js/bundle$1.js'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG #5: isRelativeUrl — mailto/tel/blob should be skipped
// ---------------------------------------------------------------------------

describe('BUG #5 — non-HTTP protocol URLs skipped by isRelativeUrl', () => {
  it('does not try to resolve mailto/tel/blob URLs', async () => {
    await setup(tmp, {
      'index.html': `<!DOCTYPE html>
<html>
<body>
  <a href="mailto:info@example.com">email</a>
  <a href="tel:+1234567890">phone</a>
  <img src="logo.png">
</body>
</html>`,
      'logo.png': '',
    });

    // Should not throw and should not try to move nonexistent files
    const stats = await normalizeLandingStructure(tmp);
    expect(stats.filesMoved).toBe(1); // only logo.png

    const html = await read(join(tmp, 'index.html'));
    expect(html).toContain('href="mailto:info@example.com"');
    expect(html).toContain('href="tel:+1234567890"');
  });
});

// ---------------------------------------------------------------------------
// CSS rewriting — url() inside moved CSS files
// ---------------------------------------------------------------------------

describe('CSS url() rewriting', () => {
  it('rewrites url() in CSS after moving CSS and its referenced assets', async () => {
    await setup(tmp, {
      'index.html': `<!DOCTYPE html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body></body>
</html>`,
      'style.css': `body {
  background: url("bg.jpg");
}
@font-face {
  src: url("fonts/myfont.woff2");
}`,
      'bg.jpg': '',
      'fonts/myfont.woff2': '',
    });

    const stats = await normalizeLandingStructure(tmp);

    expect(stats.cssPathsRewritten).toBeGreaterThanOrEqual(1);

    const css = await read(join(tmp, 'css/style.css'));
    // bg.jpg was at root, CSS moved to css/ → relative path is ../images/bg.jpg
    expect(css).toContain('url("../images/bg.jpg")');
    // Font was at root/fonts/, CSS moved to css/ → relative path is ../fonts/myfont.woff2
    expect(css).toContain('url("../fonts/myfont.woff2")');
  });

  it('handles $ in filename inside CSS url() without corrupting CSS', async () => {
    await setup(tmp, {
      'index.html': `<html><head><link rel="stylesheet" href="main.css"></head></html>`,
      'main.css': `body { background: url("hero$1.png"); }`,
      'hero$1.png': '',
    });

    await normalizeLandingStructure(tmp);

    const css = await read(join(tmp, 'css/main.css'));
    expect(css).toContain('url("../images/hero$1.png")');
    expect(css).not.toContain('url("../images/hero"');
    expect(await exists(join(tmp, 'images/hero$1.png'))).toBe(true);
  });

  it('handles bare url() without quotes in CSS', async () => {
    await setup(tmp, {
      'index.html': `<html><head><link rel="stylesheet" href="main.css"></head></html>`,
      'main.css': `body { background: url(hero.png); }`,
      'hero.png': '',
    });

    await normalizeLandingStructure(tmp);

    const css = await read(join(tmp, 'css/main.css'));
    expect(css).toContain('url("../images/hero.png")');
  });
});

// ---------------------------------------------------------------------------
// Query string and hash in URLs preserved
// ---------------------------------------------------------------------------

describe('URL suffixes (query string / hash) preserved', () => {
  it('keeps ?v=123 after rewriting', async () => {
    await setup(tmp, {
      'index.html': `<html><head>
  <link rel="stylesheet" href="style.css?v=123">
</head></html>`,
      'style.css': 'body{}',
    });

    await normalizeLandingStructure(tmp);

    const html = await read(join(tmp, 'index.html'));
    expect(html).toContain('href="css/style.css?v=123"');
  });
});

// ---------------------------------------------------------------------------
// Edge: empty site directory
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('returns empty stats when no HTML file found', async () => {
    await setup(tmp, { 'readme.txt': 'nothing here' });
    const stats = await normalizeLandingStructure(tmp);
    expect(stats.mainFileFound).toBe('');
    expect(stats.filesMoved).toBe(0);
  });

  it('picks index.html over other HTML files by score', async () => {
    await setup(tmp, {
      'index.html': '<html><body><h1>Main</h1></body></html>',
      'about.html': '<html><body>About</body></html>',
    });
    const stats = await normalizeLandingStructure(tmp);
    expect(stats.mainFileFound).toBe('index.html');
  });

  it('handles font files referenced in HTML', async () => {
    await setup(tmp, {
      'index.html': `<html><head>
<style>@font-face { src: url('myfont.woff2'); }</style>
</head></html>`,
      'myfont.woff2': '',
    });

    await normalizeLandingStructure(tmp);

    expect(await exists(join(tmp, 'fonts/myfont.woff2'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG #6: PHP main file → always index.html, PHP code stripped
// ---------------------------------------------------------------------------

describe('BUG #6 — PHP main file converted to index.html with PHP stripped', () => {
  it('renames landing.php to index.html and strips PHP code', async () => {
    await setup(tmp, {
      'landing.php': `<?php /* landing */ ?><!DOCTYPE html>
<html><head>
  <link rel="stylesheet" href="style.css">
</head><body><h1>Landing</h1><form></form></body></html>`,
      'style.css': 'body{}',
    });

    const stats = await normalizeLandingStructure(tmp);

    expect(stats.mainFileExtension).toBe('html');
    expect(stats.mainFileRenamed).toBe(true);  // basename changed: landing.php → index.html
    expect(stats.phpStripped).toBe(true);
    expect(await exists(join(tmp, 'index.html'))).toBe(true);
    expect(await exists(join(tmp, 'index.php'))).toBe(false);

    const html = await read(join(tmp, 'index.html'));
    expect(html).not.toContain('<?php');
    expect(html).toContain('href="css/style.css"');
    expect(await exists(join(tmp, 'css/style.css'))).toBe(true);
  });

  it('renames index.php at root to index.html', async () => {
    await setup(tmp, {
      'index.php': `<?php /* header */ ?><!DOCTYPE html>
<html><body><h1>Main</h1><form></form></body></html>`,
    });

    const stats = await normalizeLandingStructure(tmp);

    expect(stats.mainFileExtension).toBe('html');
    expect(stats.mainFileMoved).toBe(true);    // path changed: index.php → index.html
    expect(stats.mainFileRenamed).toBe(true);  // basename changed
    expect(stats.phpStripped).toBe(true);
    expect(await exists(join(tmp, 'index.html'))).toBe(true);
    expect(await exists(join(tmp, 'index.php'))).toBe(false);

    const html = await read(join(tmp, 'index.html'));
    expect(html).not.toContain('<?php');
    expect(html).toContain('<h1>Main</h1>');
  });

  it('always returns mainFileExtension "html" even for PHP files', async () => {
    await setup(tmp, { 'index.php': '<?php echo "x"; ?><!DOCTYPE html><html><body></body></html>' });
    const stats = await normalizeLandingStructure(tmp);
    expect(stats.mainFileExtension).toBe('html');
  });
});

// ---------------------------------------------------------------------------
// PHP stripping — edge cases
// ---------------------------------------------------------------------------

describe('PHP stripping — various PHP block patterns', () => {
  it('removes single-line <?php ... ?> block', async () => {
    await setup(tmp, {
      'index.php': '<?php echo "hi"; ?><html><body><h1>OK</h1></body></html>',
    });

    await normalizeLandingStructure(tmp);

    const html = await read(join(tmp, 'index.html'));
    expect(html).not.toContain('<?php');
    expect(html).toContain('<h1>OK</h1>');
  });

  it('removes short-echo <?= ... ?> block', async () => {
    await setup(tmp, {
      'index.php': '<html><body><h1><?= $title ?></h1><form></form></body></html>',
    });

    const stats = await normalizeLandingStructure(tmp);

    const html = await read(join(tmp, 'index.html'));
    expect(html).not.toContain('<?=');
    expect(stats.phpStripped).toBe(true);
  });

  it('removes multi-line PHP block', async () => {
    await setup(tmp, {
      'index.php': `<?php
$x = 1;
$y = 2;
?>
<html><body><h1>Content</h1></body></html>`,
    });

    await normalizeLandingStructure(tmp);

    const html = await read(join(tmp, 'index.html'));
    expect(html).not.toContain('<?php');
    expect(html).not.toContain('$x');
    expect(html).toContain('<h1>Content</h1>');
  });

  it('removes multiple PHP blocks throughout the file', async () => {
    await setup(tmp, {
      'index.php': `<?php define('X', 1); ?><html><head><?php include 'head.php'; ?></head>
<body><h1><?= $title ?></h1><form></form></body></html>`,
    });

    const stats = await normalizeLandingStructure(tmp);

    const html = await read(join(tmp, 'index.html'));
    expect(html).not.toContain('<?');
    expect(stats.phpStripped).toBe(true);
  });

  it('phpStripped is false for a PHP file without any PHP blocks', async () => {
    await setup(tmp, {
      'index.php': '<html><body><h1>Pure HTML served as PHP</h1></body></html>',
    });

    const stats = await normalizeLandingStructure(tmp);

    expect(stats.phpStripped).toBe(false);
    expect(await exists(join(tmp, 'index.html'))).toBe(true);
  });

  it('phpStripped is false for regular HTML files', async () => {
    await setup(tmp, {
      'index.html': '<html><body><h1>Hello</h1></body></html>',
    });

    const stats = await normalizeLandingStructure(tmp);
    expect(stats.phpStripped).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BUG #7: <source src="..."> for video/audio collected and moved
// ---------------------------------------------------------------------------

describe('BUG #7 — <source src> in video/audio elements', () => {
  it('moves video source files and rewrites their src attributes', async () => {
    await setup(tmp, {
      'index.html': `<!DOCTYPE html>
<html><body>
  <video controls>
    <source src="hero.mp4" type="video/mp4">
    <source src="hero.webm" type="video/webm">
  </video>
</body></html>`,
      'hero.mp4': '',
      'hero.webm': '',
    });

    const stats = await normalizeLandingStructure(tmp);

    expect(stats.filesMoved).toBeGreaterThanOrEqual(2);
    expect(await exists(join(tmp, 'video/hero.mp4'))).toBe(true);
    expect(await exists(join(tmp, 'video/hero.webm'))).toBe(true);

    const html = await read(join(tmp, 'index.html'));
    expect(html).toContain('src="video/hero.mp4"');
    expect(html).toContain('src="video/hero.webm"');
  });

  it('moves audio source file and rewrites src', async () => {
    await setup(tmp, {
      'index.html': `<html><body>
  <audio><source src="track.mp3" type="audio/mpeg"></audio>
</body></html>`,
      'track.mp3': '',
    });

    await normalizeLandingStructure(tmp);

    expect(await exists(join(tmp, 'audio/track.mp3'))).toBe(true);
    const html = await read(join(tmp, 'index.html'));
    expect(html).toContain('src="audio/track.mp3"');
  });
});

// ---------------------------------------------------------------------------
// BUG #8: percent-encoded URLs decoded before resolving
// ---------------------------------------------------------------------------

describe('BUG #8 — percent-encoded file paths decoded before stat()', () => {
  it('finds and moves file when HTML uses %20 for a space in filename', async () => {
    await setup(tmp, {
      'index.html': `<html><body><img src="my%20logo.png"></body></html>`,
      'my logo.png': '',
    });

    const stats = await normalizeLandingStructure(tmp);

    expect(stats.filesMoved).toBeGreaterThanOrEqual(1);
    expect(await exists(join(tmp, 'images/my logo.png'))).toBe(true);

    const html = await read(join(tmp, 'index.html'));
    expect(html).toContain('images/my logo.png');
  });

  it('does not throw on malformed percent-encoding — resource is silently skipped', async () => {
    await setup(tmp, {
      'index.html': `<html><body>
  <img src="bad%ZZfile.png">
  <img src="logo.png">
</body></html>`,
      'logo.png': '',
    });

    const stats = await normalizeLandingStructure(tmp);
    expect(stats.filesMoved).toBe(1);
    expect(await exists(join(tmp, 'images/logo.png'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG #9: isRelativeUrl — generic URI scheme detection
// ---------------------------------------------------------------------------

describe('BUG #9 — generic URI scheme detection in isRelativeUrl', () => {
  it('does not treat mailto: as a relative URL even when captured by <link href> pattern', async () => {
    // Create a file literally named 'mailto:info@example.com' (valid on Linux).
    // With the old code, isRelativeUrl returned true for it → file would be incorrectly moved.
    await setup(tmp, {
      'index.html': `<html><head>
  <link rel="alternate" href="mailto:info@example.com">
  <link rel="stylesheet" href="style.css">
</head><body></body></html>`,
      'mailto:info@example.com': '',
      'style.css': 'body{}',
    });

    const stats = await normalizeLandingStructure(tmp);

    expect(stats.filesMoved).toBe(1); // only style.css
    expect(await exists(join(tmp, 'mailto:info@example.com'))).toBe(true); // untouched
    const html = await read(join(tmp, 'index.html'));
    expect(html).toContain('href="mailto:info@example.com"');
    expect(html).toContain('href="css/style.css"');
  });

  it('skips blob: and other custom schemes', async () => {
    await setup(tmp, {
      'index.html': `<html><head>
  <link rel="preload" href="blob:something">
  <script src="app.js"></script>
</head><body></body></html>`,
      'app.js': '',
    });

    const stats = await normalizeLandingStructure(tmp);
    expect(stats.filesMoved).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// BUG #10: getTargetDir — no substring fallback
// ---------------------------------------------------------------------------

describe('BUG #10 — getTargetDir does not classify files by substring match', () => {
  it('puts file with dot-containing name but unknown extension into assets/, not misclassified', async () => {
    // 'sprite.png-atlas.tar': last ext = '.tar' (unknown), no valid second ext
    // OLD: substring loop found '.png' in name → images/. WRONG.
    // NEW: no substring loop → assets/.
    await setup(tmp, {
      'index.html': `<html><head>
  <link rel="alternate" href="sprite.png-atlas.tar">
  <img src="logo.png">
</head><body></body></html>`,
      'sprite.png-atlas.tar': '',
      'logo.png': '',
    });

    await normalizeLandingStructure(tmp);

    expect(await exists(join(tmp, 'assets/sprite.png-atlas.tar'))).toBe(true);
    expect(await exists(join(tmp, 'images/sprite.png-atlas.tar'))).toBe(false);
    expect(await exists(join(tmp, 'images/logo.png'))).toBe(true);
  });

  it('still classifies style.css.map correctly via second-extension check', async () => {
    await setup(tmp, {
      'index.html': `<html><head>
  <link rel="stylesheet" href="style.css">
  <link rel="preload" href="style.css.map" as="fetch">
</head><body></body></html>`,
      'style.css': 'body{}',
      'style.css.map': '{}',
    });

    await normalizeLandingStructure(tmp);

    expect(await exists(join(tmp, 'css/style.css'))).toBe(true);
    expect(await exists(join(tmp, 'css/style.css.map'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG #11: same URL repeated in srcset — both occurrences rewritten
// ---------------------------------------------------------------------------

describe('BUG #11 — duplicate URL in srcset fully rewritten', () => {
  it('rewrites both occurrences when the same URL appears twice in srcset', async () => {
    await setup(tmp, {
      'index.html': `<html><body>
  <img srcset="logo.png 1x, logo.png 2x">
</body></html>`,
      'logo.png': '',
    });

    await normalizeLandingStructure(tmp);

    const html = await read(join(tmp, 'index.html'));
    expect(html).toContain('images/logo.png 1x');
    expect(html).toContain('images/logo.png 2x');
    expect(html).not.toMatch(/srcset="logo\.png/);
  });

  it('rewrites all three distinct URLs in one srcset attribute', async () => {
    await setup(tmp, {
      'index.html': `<html><body>
  <img srcset="a.png 400w, b.png 800w, c.png 1200w">
</body></html>`,
      'a.png': '',
      'b.png': '',
      'c.png': '',
    });

    await normalizeLandingStructure(tmp);

    const html = await read(join(tmp, 'index.html'));
    expect(html).toContain('images/a.png 400w');
    expect(html).toContain('images/b.png 800w');
    expect(html).toContain('images/c.png 1200w');
  });
});

// ---------------------------------------------------------------------------
// BUG #8 extra — кириллица и CSS-кейс
// ---------------------------------------------------------------------------

describe('BUG #8 extra — cyrillic and CSS percent-encoded URLs', () => {
  it('finds and moves cyrillic-named CSS file referenced with percent-encoding', async () => {
    await setup(tmp, {
      'index.html': `<html><head>
  <link rel="stylesheet" href="%D1%81%D1%82%D0%B8%D0%BB%D0%B8.css">
</head><body></body></html>`,
      'стили.css': 'body{}',
    });

    const stats = await normalizeLandingStructure(tmp);

    expect(stats.filesMoved).toBeGreaterThanOrEqual(1);
    expect(await exists(join(tmp, 'css/стили.css'))).toBe(true);

    const html = await read(join(tmp, 'index.html'));
    expect(html).toContain('href="css/стили.css"');
  });

  it('decodes percent-encoded url() in CSS and rewrites path', async () => {
    await setup(tmp, {
      'index.html': `<html><head><link rel="stylesheet" href="style.css"></head></html>`,
      'style.css': `body { background: url("bg%20img.jpg"); }`,
      'bg img.jpg': '',
    });

    await normalizeLandingStructure(tmp);

    expect(await exists(join(tmp, 'images/bg img.jpg'))).toBe(true);
    const css = await read(join(tmp, 'css/style.css'));
    expect(css).toContain('url("../images/bg img.jpg")');
  });
});

// ---------------------------------------------------------------------------
// BUG #12 — findMainFile reads only first 64KB, large files capped at 100 pts
// ---------------------------------------------------------------------------

describe('BUG #12 — findMainFile caps score of large files', () => {
  it('picks index.html with form over huge junk file without landing signals', async () => {
    await setup(tmp, {
      'index.html': '<html><body><h1>Landing</h1><form></form></body></html>',
      'big.html': 'x'.repeat(200 * 1024), // 200 KB of junk, no title/h1/form
    });

    const stats = await normalizeLandingStructure(tmp);
    expect(stats.mainFileFound).toBe('index.html');
  });

  it('root index.html beats same-named but nested index.html (depth penalty)', async () => {
    await setup(tmp, {
      'index.html': '<html><body><h1>Root</h1></body></html>',
      'nested/index.html': '<html><body><h1>Nested</h1></body></html>',
    });

    const stats = await normalizeLandingStructure(tmp);
    // Both named index.html → both get +1000; root has no depth penalty
    expect(stats.mainFileFound).toBe('index.html');
  });
});

// ---------------------------------------------------------------------------
// BUG #13 — moveFileUnique collision: three files with same basename
// ---------------------------------------------------------------------------

describe('BUG #13 — three-way collision handled atomically', () => {
  it('keeps all three files alive under unique names when basenames clash', async () => {
    await setup(tmp, {
      'index.html': `<!DOCTYPE html>
<html><head>
  <link rel="stylesheet" href="a/x.png">
  <link rel="stylesheet" href="b/x.png">
  <link rel="stylesheet" href="c/x.png">
</head><body></body></html>`,
      'a/x.png': '',
      'b/x.png': '',
      'c/x.png': '',
    });

    await normalizeLandingStructure(tmp);

    const { readdir } = await import('node:fs/promises');
    const imgFiles = await readdir(join(tmp, 'images'));
    expect(imgFiles.length).toBe(3);

    const html = await read(join(tmp, 'index.html'));
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    expect(new Set(hrefs).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// BUG #14 — empty source directories removed after normalization
// ---------------------------------------------------------------------------

describe('BUG #14 — empty source directories cleaned up', () => {
  it('removes subdir/ after main file and its CSS are moved to root', async () => {
    await setup(tmp, {
      'subdir/index.html': `<html><head>
  <link rel="stylesheet" href="css/style.css">
</head><body><h1>x</h1></body></html>`,
      'subdir/css/style.css': 'body{}',
    });

    await normalizeLandingStructure(tmp);

    expect(await exists(join(tmp, 'index.html'))).toBe(true);
    expect(await exists(join(tmp, 'css/style.css'))).toBe(true);
    expect(await exists(join(tmp, 'subdir'))).toBe(false);
  });

  it('removes deeply nested empty directories', async () => {
    await setup(tmp, {
      'nested/sub/index.html': `<html><body>
  <img src="img/logo.png">
</body></html>`,
      'nested/sub/img/logo.png': '',
    });

    await normalizeLandingStructure(tmp);

    expect(await exists(join(tmp, 'images/logo.png'))).toBe(true);
    expect(await exists(join(tmp, 'nested'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BUG #15 — mainFileMoved vs mainFileRenamed semantics
// ---------------------------------------------------------------------------

describe('BUG #15 — mainFileMoved / mainFileRenamed semantics', () => {
  it('subdir/index.html → index.html: mainFileMoved=true, mainFileRenamed=false', async () => {
    await setup(tmp, {
      'subdir/index.html': '<html><body><h1>x</h1></body></html>',
    });

    const stats = await normalizeLandingStructure(tmp);
    expect(stats.mainFileMoved).toBe(true);
    expect(stats.mainFileRenamed).toBe(false);
  });

  it('landing.htm → index.html: mainFileMoved=true, mainFileRenamed=true', async () => {
    await setup(tmp, {
      'landing.htm': '<html><body><h1>Main</h1><form></form></body></html>',
    });

    const stats = await normalizeLandingStructure(tmp);
    expect(stats.mainFileMoved).toBe(true);
    expect(stats.mainFileRenamed).toBe(true);
  });

  it('index.html already at root: both false', async () => {
    await setup(tmp, {
      'index.html': '<html><body><h1>x</h1></body></html>',
    });

    const stats = await normalizeLandingStructure(tmp);
    expect(stats.mainFileMoved).toBe(false);
    expect(stats.mainFileRenamed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BUG #16 — pathsRewritten semantics (counts resources, not occurrences)
// ---------------------------------------------------------------------------

describe('BUG #16 — pathsRewritten counts resources, not occurrences', () => {
  it('single resource in src → pathsRewritten === 1', async () => {
    await setup(tmp, {
      'index.html': `<html><body><img src="logo.png"></body></html>`,
      'logo.png': '',
    });

    const stats = await normalizeLandingStructure(tmp);
    expect(stats.pathsRewritten).toBe(1);
  });

  it('same resource in src and srcset counts as 1, not 2', async () => {
    await setup(tmp, {
      'index.html': `<html><body>
  <img src="logo.png" srcset="logo.png 1x, logo.png 2x">
</body></html>`,
      'logo.png': '',
    });

    const stats = await normalizeLandingStructure(tmp);
    expect(stats.pathsRewritten).toBe(1);
  });

  it('two distinct resources → pathsRewritten === 2', async () => {
    await setup(tmp, {
      'index.html': `<html><body>
  <img src="logo.png">
  <img src="bg.png">
</body></html>`,
      'logo.png': '',
      'bg.png': '',
    });

    const stats = await normalizeLandingStructure(tmp);
    expect(stats.pathsRewritten).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// NORM-1 — path traversal containment (Critical)
// ---------------------------------------------------------------------------

describe('NORM-1 — путь не должен выходить за siteDir', () => {
  it('НЕ удаляет/не тащит в сайт файл вне siteDir по ссылке ../ из HTML', async () => {
    const victimDir = await mkdtemp(join(tmpdir(), 'nls-victim-'));
    const secret = join(victimDir, 'secret.png');
    await writeFile(secret, 'TOP SECRET', 'utf8');
    try {
      const rel = relative(tmp, secret).replace(/\\/g, '/'); // ../nls-victim-xxxx/secret.png
      await setup(tmp, {
        'index.html': `<!DOCTYPE html><html><head><title>x</title></head><body><img src="${rel}"></body></html>`,
      });

      await normalizeLandingStructure(tmp);

      // Файл-жертва на месте (не перемещён/не удалён) и НЕ затащен в собранный сайт.
      expect(await exists(secret)).toBe(true);
      expect(await read(secret)).toBe('TOP SECRET');
      expect(await exists(join(tmp, 'images', 'secret.png'))).toBe(false);
    } finally {
      await rm(victimDir, { recursive: true, force: true });
    }
  });

  it('НЕ тащит в сайт файл вне siteDir по ссылке ../ из CSS url()', async () => {
    const victimDir = await mkdtemp(join(tmpdir(), 'nls-victim-'));
    const secret = join(victimDir, 'leak.png');
    await writeFile(secret, 'BINARY', 'utf8');
    try {
      // CSS-ссылки резолвятся от ИСХОДНОГО расположения css-файла (корень tmp).
      const rel = relative(tmp, secret).replace(/\\/g, '/');
      await setup(tmp, {
        'index.html': `<!DOCTYPE html><html><head><title>x</title><link rel="stylesheet" href="main.css"></head><body><p>hi</p></body></html>`,
        'main.css': `body{background:url("${rel}")}`,
      });

      await normalizeLandingStructure(tmp);

      expect(await exists(secret)).toBe(true);
      expect(await read(secret)).toBe('BINARY');
    } finally {
      await rm(victimDir, { recursive: true, force: true });
    }
  });

  it('РОБАСТНОСТЬ: легитимный ../ ВНУТРИ siteDir по-прежнему переезжает', async () => {
    await setup(tmp, {
      'pages/index.html': `<!DOCTYPE html><html><head><title>x</title></head><body><img src="../shared/logo.png"></body></html>`,
      'shared/logo.png': '',
    });

    const stats = await normalizeLandingStructure(tmp);

    expect(stats.filesMoved).toBeGreaterThanOrEqual(1);
    expect(await exists(join(tmp, 'images', 'logo.png'))).toBe(true);
  });
});
