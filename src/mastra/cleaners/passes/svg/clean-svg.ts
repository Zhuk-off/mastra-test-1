import { readFile, writeFile } from 'node:fs/promises';
import { isExternalUrl } from '../../utils/url.js';

export async function cleanSvgFile(filePath: string): Promise<number> {
  const original = await readFile(filePath, 'utf8');
  let content = original;
  let removed = 0;

  content = content.replace(/<script\b[\s\S]*?<\/script>/gi, () => { removed++; return ''; });
  content = content.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, () => { removed++; return ''; });
  content = content.replace(/\s+on\w+\s*=\s*(?:'[^']*'|"[^"]*")/gi, () => { removed++; return ''; });
  content = content.replace(/\bxlink:href\s*=\s*(['"])([^'"]+)\1/gi, (whole, _q, href: string) => {
    if (isExternalUrl(href)) { removed++; return ''; }
    return whole;
  });

  if (content !== original) await writeFile(filePath, content, 'utf8');
  return removed;
}
