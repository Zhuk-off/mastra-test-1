import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { readFile, writeFile } from 'node:fs/promises';

export interface VisualDiffResult {
  diffPercent: number;
  baselinePath: string;
  afterPath: string;
  diffImagePath: string;
}

export async function takeScreenshot(
  pageUrl: string,
  outputPath: string,
  viewport: { width: number; height: number } = { width: 1280, height: 800 },
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewportSize(viewport);
    // 'load' + timeout + catch: оригинал (до очистки) часто звонит трекерам, и networkidle
    // мог бы не наступить никогда. fullPage:false + фикс. вьюпорт → стабильные размеры для diff.
    await page.goto(pageUrl, { waitUntil: 'load', timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(500).catch(() => undefined);
    await page.screenshot({ path: outputPath, fullPage: false });
  } finally {
    await browser.close();
  }
}

export async function compareScreenshots(
  baselinePath: string,
  afterPath: string,
  diffPath: string,
): Promise<number> {
  const [baselineBuffer, afterBuffer] = await Promise.all([
    readFile(baselinePath),
    readFile(afterPath),
  ]);
  const img1 = PNG.sync.read(baselineBuffer);
  const img2 = PNG.sync.read(afterBuffer);

  const { width, height } = img1;
  const diff = new PNG({ width, height });

  const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, {
    threshold: 0.1,
    includeAA: false,
  });

  const diffPercent = (numDiffPixels / (width * height)) * 100;
  await writeFile(diffPath, PNG.sync.write(diff));
  return diffPercent;
}

export async function verifyVisualDiff(
  baselinePath: string,
  afterPath: string,
  diffPath: string,
): Promise<VisualDiffResult> {
  const diffPercent = await compareScreenshots(baselinePath, afterPath, diffPath);
  return { diffPercent, baselinePath, afterPath, diffImagePath: diffPath };
}
