import * as walk from 'acorn-walk';
import type { Program, Node } from 'acorn';
import type { DetectionResult, DetectorContext } from '../ast/types.js';
import { posToLine, snippetAt } from '../ast/parse.js';
import { isExternalUrl, extractStringish, obfuscatedDecoderIn, isLocationRef, memberPropName } from './helpers.js';

/**
 * Detects JS redirects to external URLs.
 * Patterns:
 *  - window.location = 'https://external...'
 *  - window.location.href = 'https://external...'
 *  - location.href = 'https://external...'
 *  - location.replace('https://external...')
 *  - window.location.replace('https://external...')
 *
 * shouldRemove: true — внешний JS-редирект у владельца НИКОГДА не легит (чужой редирект =
 * кража трафика), поэтому он автоматически вырезается/нейтрализуется, а не просто варнится.
 */
export function detectRedirect(ast: Program, ctx: DetectorContext): DetectionResult[] {
  const results: DetectionResult[] = [];
  const { source, mainHost } = ctx;

  walk.simple(ast, {
    AssignmentExpression(node: Node) {
      const n = node as any;
      const left = n.left;

      // location = url | window.location = url | location.href = url | location['href'] = url
      // | top.location.href = url | self.location = url
      const isBareLocation = isLocationRef(left);
      const isHrefAssign =
        left?.type === 'MemberExpression' &&
        memberPropName(left) === 'href' &&
        isLocationRef(left.object);
      if (!isBareLocation && !isHrefAssign) return;

      // DET-1: extractStringish резолвит склейку ('htt'+'ps://evil') и template; опасный
      // декодер (atob/...) → обфусцированный редирект. Голая переменная — не флагуем.
      const url = extractStringish(n.right);
      let description: string | null = null;
      if (url && isExternalUrl(url, mainHost)) {
        description = `Редирект на внешний хост: ${url}`;
      } else {
        const dec = obfuscatedDecoderIn(n.right);
        if (dec) description = `Обфусцированный редирект (${dec})`;
      }
      if (!description) return;

      results.push({
        line: posToLine(source, n.start),
        start: n.start,
        end: n.end,
        threatType: 'redirect',
        description,
        snippet: snippetAt(source, n.start, n.end),
        shouldRemove: true,
        node,
      });
    },

    CallExpression(node: Node) {
      const n = node as any;
      // location.assign/replace(url) — в т.ч. window/top/self.location и bracket-формы
      const callee = n.callee;
      if (callee?.type !== 'MemberExpression') return;
      const method = memberPropName(callee);
      if (method !== 'assign' && method !== 'replace') return;
      if (!isLocationRef(callee.object)) return;

      const url = extractStringish(n.arguments[0]);
      let description: string | null = null;
      if (url && isExternalUrl(url, mainHost)) {
        description = `Редирект на внешний хост через location.${method}(): ${url}`;
      } else {
        const dec = obfuscatedDecoderIn(n.arguments[0]);
        if (dec) description = `Обфусцированный редирект через location.${method}() (${dec})`;
      }
      if (!description) return;

      results.push({
        line: posToLine(source, n.start),
        start: n.start,
        end: n.end,
        threatType: 'redirect',
        description,
        snippet: snippetAt(source, n.start, n.end),
        shouldRemove: true,
        node,
      });
    },
  });

  return results;
}
