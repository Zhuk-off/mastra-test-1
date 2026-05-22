import { readFile } from 'node:fs/promises';
import { KNOWN_LIBS, type KnownLib } from '../../../registry/known-libs.js';

export interface DetectedLib {
  lib: KnownLib;
  version: string;
}

/** Проверяет JS-файл по сигнатуре содержимого */
export async function detectUnversionedLib(filePath: string): Promise<DetectedLib | null> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  // Только первые 4 КБ — сигнатура обычно в заголовке комментария
  const head = content.slice(0, 4096);

  for (const lib of KNOWN_LIBS) {
    if (!lib.contentSignature.test(head)) continue;

    const versionMatch = lib.versionExtractor.exec(head);
    const version = versionMatch?.[1] ?? versionMatch?.[2] ?? lib.fallbackVersion;
    return { lib, version };
  }
  return null;
}
