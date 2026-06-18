import { PRODUCT_NAME_MACRO } from '../cleaners/registry/policy.js';
import { BUILTIN_ADAPT_CONFIG, type AdaptConfig } from './config.js';
import type { AdaptBrief } from './types.js';

/** Эффективная вертикаль: из брифа или дефолт конфига. */
export function resolveVertical(brief: AdaptBrief, config: AdaptConfig = BUILTIN_ADAPT_CONFIG): string {
  return (brief.vertical ?? config.defaultVertical).trim();
}

/**
 * Целевой URL продуктового изображения по брифу+конфигу:
 *  - 'skip' → null (картинки не трогаем);
 *  - 'file' → реальный URL/макрос из брифа (или null, если не задан);
 *  - 'macro' (по умолчанию) → база вертикали из конфига (или null, если вертикали нет в конфиге).
 */
export function resolveImageTarget(brief: AdaptBrief, config: AdaptConfig = BUILTIN_ADAPT_CONFIG): string | null {
  const img = brief.image ?? {};
  const mode = img.mode ?? 'macro';
  if (mode === 'skip') return null;
  if (mode === 'file') return img.file?.trim() || null;
  const vertical = resolveVertical(brief, config);
  return config.verticals[vertical]?.imageBase ?? null;
}

/**
 * Все известные «наши» базы картинок (по всем вертикалям конфига). Нужно для re-point:
 * проход узнаёт ранее вставленный URL другой вертикали и перенаправляет на текущий target.
 */
export function knownOwnImageBases(config: AdaptConfig = BUILTIN_ADAPT_CONFIG): string[] {
  return Object.values(config.verticals).map((v) => v.imageBase);
}

/**
 * Замена названия по брифу+конфигу: строка-цель + список искомых названий.
 * В список искомых, помимо productName/aliases, добавляются известные «наши» макросы имени
 * (встроенный + конфиг + brief.macro), КРОМЕ текущего target — это даёт re-point: при смене
 * макроса имени повторный прогон находит старый макрос и меняет на новый.
 *  - 'skip' → null;
 *  - 'literal' → цель = literal (если задан);
 *  - 'macro' (по умолчанию) → цель = brief.name.macro || config.nameMacro.
 */
export function resolveNameReplacement(
  brief: AdaptBrief,
  config: AdaptConfig = BUILTIN_ADAPT_CONFIG,
): { target: string; names: string[] } | null {
  const n = brief.name ?? {};
  const mode = n.mode ?? 'macro';
  if (mode === 'skip') return null;

  const target = mode === 'literal' ? (n.literal ?? '').trim() : (n.macro?.trim() || config.nameMacro);
  if (!target) return null;

  const explicit = [n.productName, ...(n.aliases ?? [])].map((s) => (s ?? '').trim()).filter((s) => s.length > 0);

  // re-point: известные наши макросы имени, кроме текущего target (при смене макроса — старый → новый).
  const knownNameMacros = [PRODUCT_NAME_MACRO, config.nameMacro, n.macro].map((s) => (s ?? '').trim()).filter(Boolean);
  const repoint = [...new Set(knownNameMacros)].filter((m) => m !== target);

  const names = [...new Set([...explicit, ...repoint])];
  if (names.length === 0) return null;

  return { target, names };
}
