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

export async function takeScreenshot(pageUrl: string, outputPath: string): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(pageUrl, { waitUntil: 'networkidle' });
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
