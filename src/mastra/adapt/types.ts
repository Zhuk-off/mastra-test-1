import type { Dom } from '../cleaners/utils/html-dom.js';
import type { AdaptConfig } from './config.js';

/**
 * Этап 5 — АДАПТАЦИЯ. Подставляет продуктовые значения под конкретный оффер в УЖЕ очищенный
 * лендинг. Отдельный модуль (сестра `cleaners/`), переиспользует `cleaners/registry/policy.ts`
 * и `cleaners/utils/html-dom.ts`. См. docs/stage-5-adaptation.md.
 *
 * Настройки берутся слоями: встроенные дефолты ← adapt.config.json ← бриф (см. config.ts).
 */

/** Встроенные вертикали. Через adapt.config.json можно добавить свои (поэтому в брифе — string). */
export type Vertical = 'Adult' | 'WeightLoss';

/**
 * Адаптационный бриф — переопределения на КОНКРЕТНЫЙ лендинг (поверх adapt.config.json).
 * Всё опционально: чего нет — берётся из конфига/дефолтов. v1: картинка + имя.
 */
export interface AdaptBrief {
  /** Вертикаль. Если не задана — берётся defaultVertical из конфига. Встроенные: Adult/WeightLoss. */
  vertical?: string;
  /** Замена продуктового изображения. По умолчанию mode:'macro'. */
  image?: {
    /**
     * - 'macro'  (по умолчанию) — вписать базу из конфига для вертикали (макрос {_offer_value:offerimage});
     * - 'file'   — вписать реальный URL/макрос из поля `file` (для неуниверсальных лендингов или своего адреса);
     * - 'skip'   — не трогать картинки.
     */
    mode?: 'macro' | 'file' | 'skip';
    /** Свой URL/макрос картинки (если mode:'file'). */
    file?: string;
  };
  /** Замена названия товара. По умолчанию mode:'macro'. */
  name?: {
    /**
     * - 'macro'   (по умолчанию) — заменить все вхождения названия на макрос имени (из `macro` или конфига);
     * - 'literal' — заменить на строку `literal`;
     * - 'skip'    — не трогать названия.
     */
    mode?: 'macro' | 'literal' | 'skip';
    /** Текущее название продукта на лендинге, которое надо заменить (напр. "PowerGummies"). */
    productName?: string;
    /** Доп. варианты написания названия (мн. число, бренд+форма и т.п.). */
    aliases?: string[];
    /** Свой макрос имени (переопределяет конфиг), если mode:'macro'. */
    macro?: string;
    /** Строка-замена, если mode:'literal'. */
    literal?: string;
  };
}

/** Тип внесённого изменения (для отчёта adapt-report.md). */
export interface AdaptChange {
  file: string;
  pass: 'image' | 'name';
  element: string;
  attr: string;
  /** Старое значение (обрезано). */
  before: string;
  /** Новое значение. */
  after: string;
  /** Чем сработало: 'offer-anchor' | 'foreign-macro' | 'foreign-macro-bg' | 're-point' | 're-point-bg' | 'text' | 'attr' | 'meta'. */
  trigger: string;
}

/** Контекст одного файла для прохода адаптации. */
export interface AdaptContext {
  siteDir: string;
  relPath: string;
  brief: AdaptBrief;
  /** Сведённый конфиг (дефолты ← файл). Если не задан — проход берёт встроенные дефолты. */
  config?: AdaptConfig;
  /** Накопитель изменений (общий на весь прогон). */
  changes: AdaptChange[];
}

/** Счётчики, которые возвращает один проход. */
export interface AdaptStatsDelta {
  imagesReplaced?: number;
  namesReplaced?: number;
}

/** Проход адаптации: принимает cheerio-дерево + контекст, мутирует дерево, возвращает счётчики. */
export type AdaptPass = (dom: Dom, ctx: AdaptContext) => AdaptStatsDelta;

/** Итоговая статистика прогона adaptSite(). */
export interface AdaptStats {
  htmlFilesProcessed: number;
  imagesReplaced: number;
  namesReplaced: number;
  /** Эффективная вертикаль (из брифа или дефолта конфига). */
  vertical: string;
  /** Откуда взят конфиг: файл adapt.config.json или встроенные дефолты. */
  configSource: 'file' | 'builtin';
  /** Предупреждения (напр. «имя не заменено — не задан productName»). */
  warnings: string[];
  /** Все внесённые изменения (для отчёта). */
  changes: AdaptChange[];
  /** Путь к adapt-report.md (пишется всегда). */
  reportPath: string;
}
