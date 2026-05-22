import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Program, Node as AcornNode } from 'acorn';
import { parseJs } from '../ast/parse.js';
import * as walk from 'acorn-walk';

export interface DeadFileAnalysis {
  relPath: string;
  coveragePercent: number;
  hasEventHandlers: boolean;
  isDead: boolean;
  reason: string;
}

/** Проверяет: содержит ли файл регистрацию event-handlers */
function hasEventHandlers(ast: Program): boolean {
  let found = false;
  walk.simple(ast, {
    CallExpression(node: AcornNode) {
      const n = node as any;
      if (
        n.callee?.property?.name === 'addEventListener' ||
        n.callee?.name === 'jQuery' ||
        n.callee?.name === '$'
      ) {
        found = true;
      }
    },
    AssignmentExpression(node: AcornNode) {
      const n = node as any;
      // window.onload = ..., document.onclick = ...
      if (
        n.left?.type === 'MemberExpression' &&
        /^on[a-z]+$/.test(n.left.property?.name ?? '')
      ) {
        found = true;
      }
    },
  });
  return found;
}

export function analyzeDeadFiles(
  coverages: Array<{ relPath: string | null; percent: number }>,
  siteDir: string,
  deadThresholdPercent = 1,
): DeadFileAnalysis[] {
  const results: DeadFileAnalysis[] = [];

  for (const cov of coverages) {
    if (!cov.relPath) continue; // пропускаем inline-скрипты
    if (cov.percent > deadThresholdPercent) continue; // достаточно живой

    const absPath = path.join(siteDir, cov.relPath);
    if (!fs.existsSync(absPath)) continue;

    const source = fs.readFileSync(absPath, 'utf8');
    const ast = parseJs(source, cov.relPath);

    const hasHandlers = ast ? hasEventHandlers(ast) : false;

    if (hasHandlers) {
      results.push({
        relPath: cov.relPath,
        coveragePercent: cov.percent,
        hasEventHandlers: true,
        isDead: false,
        reason: 'Содержит event handlers — возможно lazy-инициализация',
      });
    } else {
      results.push({
        relPath: cov.relPath,
        coveragePercent: cov.percent,
        hasEventHandlers: false,
        isDead: true,
        reason: `0% покрытия, нет event handlers — мёртвый код`,
      });
    }
  }

  return results;
}
