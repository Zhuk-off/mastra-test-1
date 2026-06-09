import type { Program } from 'acorn';
import { detectExfilCalls } from './detectors/detect-exfil-calls.js';
import { detectRedirect } from './detectors/detect-redirect.js';
import { detectKeylogger } from './detectors/detect-keylogger.js';
import { neutralizeDetections } from './neutralize-detections.js';
import type { DetectorContext } from './ast/types.js';
import type { ChangelogEntry } from '../../types.js';

export interface InlineExfilResult {
  code: string;
  removed: number;
}

/**
 * Нейтрализует в inline-`<script>` exfil-вызовы, внешние JS-редиректы и keylogger-паттерны
 * (последние два у владельца никогда не легит — см. detect-redirect/detect-keylogger).
 * Удаление reference-safe (DEC-1): statement убирается целиком, вызов в выражении → `void 0`.
 */
export function removeInlineExfil(
  scriptContent: string,
  ctx: DetectorContext,
  ast: Program,
  log: ChangelogEntry[],
): InlineExfilResult {
  const detections = [
    ...detectExfilCalls(ast, ctx),
    ...detectRedirect(ast, ctx),
    ...detectKeylogger(ast, scriptContent),
  ];
  return neutralizeDetections(scriptContent, ast, detections, log, ctx.relPath);
}
