import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { PRODUCT_IMAGE_BASE, PRODUCT_NAME_MACRO } from '../cleaners/registry/policy.js';
import type { Vertical } from './types.js';

/**
 * Конфигурация адаптации (этап 5). Три слоя, переопределение сверху вниз:
 *  1. ВСТРОЕННЫЕ дефолты (этот файл, из policy.ts) — фолбэк.
 *  2. Файл проекта `adapt.config.json` в корне — правит владелец (дефолтная вертикаль, базы
 *     URL картинок по вертикали, макрос имени). Можно добавлять вертикали.
 *  3. Бриф на задачу (чат/инструмент) — переопределяет на конкретный лендинг.
 * Слой 1↔2 сводит `loadAdaptConfig()`; слой 3 накладывается в `targets.ts` (резолверы).
 */

export interface VerticalConfig {
  /** Полный URL продуктовой картинки С макросом на конце (трекер раскроет в имя_товара.webp). */
  imageBase: string;
}

export interface AdaptConfig {
  /** Вертикаль по умолчанию, когда бриф её не задаёт. */
  defaultVertical: Vertical;
  /** Карта вертикаль → базовый URL картинки. Открыта для расширения новыми вертикалями. */
  verticals: Record<string, VerticalConfig>;
  /** Макрос названия товара (по умолчанию {_offer_value:offername}). */
  nameMacro: string;
}

/** Встроенные дефолты — из единого реестра policy.ts. */
export const BUILTIN_ADAPT_CONFIG: AdaptConfig = {
  defaultVertical: 'Adult',
  verticals: {
    Adult: { imageBase: PRODUCT_IMAGE_BASE.Adult },
    WeightLoss: { imageBase: PRODUCT_IMAGE_BASE.WeightLoss },
  },
  nameMacro: PRODUCT_NAME_MACRO,
};

export const ADAPT_CONFIG_FILENAME = 'adapt.config.json';

/** Схема файла настроек. Все поля опциональны — отсутствующие берутся из встроенных дефолтов. */
const ConfigFileSchema = z.object({
  defaultVertical: z.string().optional(),
  verticals: z.record(z.string(), z.object({ imageBase: z.string().min(1) })).optional(),
  nameMacro: z.string().min(1).optional(),
});

export interface LoadedAdaptConfig {
  config: AdaptConfig;
  source: 'file' | 'builtin';
  path?: string;
  warnings: string[];
}

/**
 * Загружает и сводит конфиг: встроенные дефолты ← `adapt.config.json` (если есть и валиден).
 * Отсутствие/битость файла — НЕ ошибка: берём встроенные дефолты и пишем предупреждение.
 */
export async function loadAdaptConfig(opts?: { configPath?: string; rootDir?: string }): Promise<LoadedAdaptConfig> {
  const path = opts?.configPath ?? join(opts?.rootDir ?? process.cwd(), ADAPT_CONFIG_FILENAME);
  const warnings: string[] = [];

  let raw: string | null = null;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return { config: BUILTIN_ADAPT_CONFIG, source: 'builtin', warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    warnings.push(`adapt.config.json не распарсился (${e instanceof Error ? e.message : 'JSON error'}) — взяты встроенные дефолты.`);
    return { config: BUILTIN_ADAPT_CONFIG, source: 'builtin', warnings };
  }

  const res = ConfigFileSchema.safeParse(parsed);
  if (!res.success) {
    warnings.push(
      'adapt.config.json не прошёл валидацию — взяты встроенные дефолты. ' +
        res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
    return { config: BUILTIN_ADAPT_CONFIG, source: 'builtin', warnings };
  }

  const file = res.data;
  const config: AdaptConfig = {
    defaultVertical: (file.defaultVertical as Vertical | undefined) ?? BUILTIN_ADAPT_CONFIG.defaultVertical,
    // вертикали из файла МЕРДЖАТСЯ поверх встроенных (можно переопределить базу или добавить новую)
    verticals: { ...BUILTIN_ADAPT_CONFIG.verticals, ...(file.verticals ?? {}) },
    nameMacro: file.nameMacro ?? BUILTIN_ADAPT_CONFIG.nameMacro,
  };
  return { config, source: 'file', path, warnings };
}
