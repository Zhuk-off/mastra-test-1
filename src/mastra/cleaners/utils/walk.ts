import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function* walkFiles(dir: string): AsyncGenerator<string> {
  // WALK-1: нечитаемая/несуществующая директория (права, гонка) не должна ронять
  // весь обход cleanSite — пропускаем её и продолжаем по остальным.
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkFiles(full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}
