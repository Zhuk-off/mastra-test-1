import type { Node } from 'acorn';

/** Результат одного детектора */
export interface DetectionResult {
  /** Строка в исходнике (1-indexed) */
  line: number;
  /** Символьная позиция начала узла */
  start: number;
  /** Символьная позиция конца узла */
  end: number;
  /** Тип угрозы: 'exfil' | 'dead' | 'obfuscated' | 'metric' | 'keylogger' | ... */
  threatType: string;
  /** Короткое описание для лога */
  description: string;
  /** Исходный фрагмент кода (≤ 200 символов) */
  snippet: string;
  /** Если true — узел должен быть удалён, false — только предупреждение */
  shouldRemove: boolean;
  /** AST-узел */
  node: Node;
}

/** Контекст для детекторов */
export interface DetectorContext {
  /** Исходный код файла */
  source: string;
  /** Относительный путь для лога */
  relPath: string;
  /** Хост лендинга (например, example.com) */
  mainHost: string;
}
