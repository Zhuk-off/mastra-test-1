import type { HtmlPass } from '../../types.js';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const replaceLocalLibsWithCdn: HtmlPass = (html, ctx) => {
  const counts: Partial<Record<'localLibsReplaced', number>> = {};
  let localLibsReplaced = 0;

  const { cdnReplacements } = ctx;
  if (!cdnReplacements || cdnReplacements.size === 0) {
    return { html, counts };
  }

  for (const [originalUrl, replacement] of cdnReplacements) {
    const esc = escapeRegex(originalUrl);
    const integrity = ` integrity="${replacement.integrity}" crossorigin="anonymous"`;

    // <script ... src="..." ...>
    const scriptRe = new RegExp(
      `(<script\\b[^>]*?)(\\bsrc\\s*=\\s*['"])${esc}(['"])`,
      'gi',
    );
    const beforeScript = html;
    html = html.replace(scriptRe, `$1$2${replacement.cdnUrl}$3${integrity}`);
    if (html !== beforeScript) localLibsReplaced++;

    // <link ... href="..." ...>
    const linkRe = new RegExp(
      `(<link\\b[^>]*?)(\\bhref\\s*=\\s*['"])${esc}(['"])`,
      'gi',
    );
    const beforeLink = html;
    html = html.replace(linkRe, `$1$2${replacement.cdnUrl}$3${integrity}`);
    if (html !== beforeLink) localLibsReplaced++;
  }

  if (localLibsReplaced > 0) counts.localLibsReplaced = localLibsReplaced;
  return { html, counts };
};
