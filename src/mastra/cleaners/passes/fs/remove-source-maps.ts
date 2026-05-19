import { readFile, writeFile, rm } from 'node:fs/promises';
import { extname } from 'node:path';
import { walkFiles } from '../../utils/walk.js';

export async function removeSourceMaps(
  siteDir: string,
): Promise<{ mapsDeleted: number; filesStripped: number }> {
  let mapsDeleted = 0;
  let filesStripped = 0;

  for await (const file of walkFiles(siteDir)) {
    const ext = extname(file).toLowerCase();

    if (ext === '.map') {
      await rm(file, { force: true });
      mapsDeleted++;
      continue;
    }

    if (ext === '.js' || ext === '.mjs' || ext === '.css') {
      const original = await readFile(file, 'utf8');
      const cleaned = original
        .replace(/\/\/[#@][ \t]*sourceMappingURL\s*=\s*\S+/g, '')
        .replace(/\/\*#[ \t]*sourceMappingURL\s*=\s*[^*]*\*\//g, '');
      if (cleaned !== original) {
        await writeFile(file, cleaned, 'utf8');
        filesStripped++;
      }
    }
  }

  return { mapsDeleted, filesStripped };
}
