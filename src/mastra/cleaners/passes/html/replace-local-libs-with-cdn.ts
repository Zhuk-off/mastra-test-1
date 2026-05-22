import type { HtmlPass } from '../../types.js';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyReplacements(
  html: string,
  replacements: Map<string, { cdnUrl: string; integrity: string }>,
  counter: { value: number },
): string {
  for (const [originalUrl, replacement] of replacements) {
    const esc = escapeRegex(originalUrl);
    const integrity = ` integrity="${replacement.integrity}" crossorigin="anonymous"`;

    // <script ... src="..." ...>
    const scriptRe = new RegExp(
      `(<script\\b[^>]*?)(\\bsrc\\s*=\\s*['"])${esc}(['"])`,
      'gi',
    );
    const beforeScript = html;
    html = html.replace(scriptRe, `$1$2${replacement.cdnUrl}$3${integrity}`);
    if (html !== beforeScript) counter.value++;

    // <link ... href="..." ...>
    const linkRe = new RegExp(
      `(<link\\b[^>]*?)(\\bhref\\s*=\\s*['"])${esc}(['"])`,
      'gi',
    );
    const beforeLink = html;
    html = html.replace(linkRe, `$1$2${replacement.cdnUrl}$3${integrity}`);
    if (html !== beforeLink) counter.value++;
  }
  return html;
}

export const replaceLocalLibsWithCdn: HtmlPass = (html, ctx) => {
  const counts: Partial<Record<'localLibsReplaced', number>> = {};
  const counter = { value: 0 };

  if (ctx.cdnReplacements && ctx.cdnReplacements.size > 0) {
    html = applyReplacements(html, ctx.cdnReplacements, counter);
  }

  if (ctx.unversionedLibReplacements && ctx.unversionedLibReplacements.size > 0) {
    html = applyReplacements(html, ctx.unversionedLibReplacements, counter);
  }

  if (counter.value > 0) counts.localLibsReplaced = counter.value;
  return { html, counts };
};
