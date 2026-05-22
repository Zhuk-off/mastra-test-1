import type { HtmlPass, HtmlPassResult, PassContext } from '../../types.js';
import { parseJs } from '../js-advanced/ast/parse.js';
import { removeInlineExfil } from '../js-advanced/remove-inline-exfil.js';

const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;

export const removeInlineExfilPass: HtmlPass = (html, ctx): HtmlPassResult => {
  let result = html;
  let removed = 0;

  result = result.replace(INLINE_SCRIPT_RE, (fullMatch, scriptBody: string) => {
    if (!scriptBody.trim()) return fullMatch;

    const ast = parseJs(scriptBody, ctx.relPath);
    if (!ast) return fullMatch; // не смогли распарсить — не трогаем

    const { code, removed: r } = removeInlineExfil(
      scriptBody,
      { source: scriptBody, relPath: ctx.relPath, mainHost: ctx.mainHost },
      ast,
      ctx.log,
    );
    removed += r;

    if (r === 0) return fullMatch;
    if (!code.trim()) return ''; // весь блок стал пустым
    // Заменяем только тело скрипта, сохраняя открывающий/закрывающий тег
    const bodyStart = fullMatch.indexOf('>') + 1;
    const bodyEnd = fullMatch.lastIndexOf('</script>');
    return fullMatch.slice(0, bodyStart) + code + fullMatch.slice(bodyEnd);
  });

  return { html: result, counts: { inlineExfilRemoved: removed } };
};
