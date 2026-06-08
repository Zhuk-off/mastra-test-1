import * as walk from 'acorn-walk';
import type { Program, Node } from 'acorn';
import { SUSPICIOUS_CALL_GLOBALS } from '../../../registry/suspicious-globals.js';
import type { DetectionResult, DetectorContext } from '../ast/types.js';
import { posToLine, snippetAt } from '../ast/parse.js';
import { isExternalUrl, extractStringArg } from './helpers.js';

export function detectExfilCalls(
  ast: Program,
  ctx: DetectorContext,
): DetectionResult[] {
  const results: DetectionResult[] = [];

  walk.simple(ast, {
    NewExpression(node: Node) {
      const n = node as any;
      const { source, mainHost } = ctx;
      // new WebSocket('wss://external...')
      if (n.callee?.type === 'Identifier' && n.callee.name === 'WebSocket') {
        const url = extractStringArg(n.arguments[0]);
        if (
          url &&
          isExternalUrl(
            url.replace('wss://', 'https://').replace('ws://', 'http://'),
            mainHost,
          )
        ) {
          results.push({
            line: posToLine(source, n.start),
            start: n.start,
            end: n.end,
            threatType: 'exfil-websocket',
            description: `WebSocket на внешний хост: ${url}`,
            snippet: snippetAt(source, n.start, n.end),
            shouldRemove: true,
            node,
          });
        }
      }
    },

    CallExpression(node: Node) {
      const n = node as any;
      const { source, mainHost } = ctx;

      // fetch('https://external...')
      if (n.callee?.name === 'fetch') {
        const url = extractStringArg(n.arguments[0]);
        if (url && isExternalUrl(url, mainHost)) {
          results.push({
            line: posToLine(source, n.start),
            start: n.start,
            end: n.end,
            threatType: 'exfil-fetch',
            description: `fetch() на внешний хост: ${url}`,
            snippet: snippetAt(source, n.start, n.end),
            shouldRemove: true,
            node,
          });
        }
      }

      // navigator.sendBeacon(url)
      if (
        n.callee?.type === 'MemberExpression' &&
        n.callee.object?.name === 'navigator' &&
        n.callee.property?.name === 'sendBeacon'
      ) {
        const url = extractStringArg(n.arguments[0]);
        if (!url || isExternalUrl(url, mainHost)) {
          results.push({
            line: posToLine(source, n.start),
            start: n.start,
            end: n.end,
            threatType: 'exfil-beacon',
            description: `sendBeacon() на внешний хост`,
            snippet: snippetAt(source, n.start, n.end),
            shouldRemove: true,
            node,
          });
        }
      }

      // fbq(...), gtag(...), ym(...) и другие трекерные глобалы
      if (n.callee?.name && SUSPICIOUS_CALL_GLOBALS.has(n.callee.name)) {
        results.push({
          line: posToLine(source, n.start),
          start: n.start,
          end: n.end,
          threatType: 'tracker-call',
          description: `Вызов трекера: ${n.callee.name}(...)`,
          snippet: snippetAt(source, n.start, n.end),
          shouldRemove: true,
          node,
        });
      }

      // document.write('<script src="https://external.com/...">')
      if (
        n.callee?.type === 'MemberExpression' &&
        n.callee.object?.name === 'document' &&
        n.callee.property?.name === 'write'
      ) {
        const html = extractStringArg(n.arguments[0]);
        if (html) {
          const scriptSrcMatch = html.match(/<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
          if (scriptSrcMatch && scriptSrcMatch[1]) {
            const src = scriptSrcMatch[1];
            if (isExternalUrl(src, mainHost)) {
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
            }
          }
        }
      }
    },

    AssignmentExpression(node: Node) {
      const n = node as any;
      // new Image().src = 'https://external.com/pixel'
      if (
        n.left?.type === 'MemberExpression' &&
        n.left.property?.name === 'src' &&
        n.left.object?.type === 'NewExpression' &&
        n.left.object?.callee?.name === 'Image'
      ) {
        const url = extractStringArg(n.right);
        if (url && isExternalUrl(url, ctx.mainHost)) {
          results.push({
            line: posToLine(ctx.source, n.start),
            start: n.start,
            end: n.end,
            threatType: 'exfil-pixel',
            description: `Tracking pixel через new Image().src`,
            snippet: snippetAt(ctx.source, n.start, n.end),
            shouldRemove: true,
            node,
          });
        }
      }
    },
  });

  return results;
}
