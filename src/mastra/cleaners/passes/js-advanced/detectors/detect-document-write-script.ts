import * as walk from 'acorn-walk';
import type { Program, Node } from 'acorn';
import type { DetectionResult, DetectorContext } from '../ast/types.js';
import { posToLine, snippetAt } from '../ast/parse.js';
import { isExternalUrl, extractStringArg } from './helpers.js';

/**
 * Detects document.write() calls that inject external <script> tags.
 * Pattern: document.write('<script src="https://external.com/...">...</script>')
 *
 * shouldRemove: true — these are actively removed.
 * Used for both inline HTML scripts (via remove-inline-exfil) and
 * external JS files (via clean-js.ts).
 */
export function detectDocWriteScript(ast: Program, ctx: DetectorContext): DetectionResult[] {
  const results: DetectionResult[] = [];
  const { source, mainHost } = ctx;

  walk.simple(ast, {
    CallExpression(node: Node) {
      const n = node as any;

      // document.write(...) or document.writeln(...)
      if (
        n.callee?.type !== 'MemberExpression' ||
        n.callee.object?.name !== 'document' ||
        (n.callee.property?.name !== 'write' && n.callee.property?.name !== 'writeln')
      ) {
        return;
      }

      const html = extractStringArg(n.arguments[0]);
      if (!html) return;

      // Check if the string contains a <script src="..."> with an external URL
      const scriptSrcMatch = html.match(/<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
      if (!scriptSrcMatch || !scriptSrcMatch[1]) return;

      const src = scriptSrcMatch[1];
      if (!isExternalUrl(src, mainHost)) return;

      results.push({
        line: posToLine(source, n.start),
        start: n.start,
        end: n.end,
        threatType: 'exfil-document-write',
        description: `document.write() инжектит внешний скрипт: ${src}`,
        snippet: snippetAt(source, n.start, n.end),
        shouldRemove: true,
        node,
      });
    },
  });

  return results;
}
