import { Memory } from '@mastra/memory';
import type {
  MemoryConfig,
  WorkingMemory,
  SharedMemoryConfig,
} from '@mastra/core/memory';

/**
 * Универсальная фабрика памяти для агентов Mastra.
 *
 * Зачем фабрика?
 * - Единый источник правды для настроек памяти по умолчанию для всех агентов.
 * - Каждый агент объявляет только то, что отличается (например, схему рабочей памяти).
 * - Хранилище наследуется от экземпляра Mastra (см. `src/mastra/index.ts`),
 *   поэтому мы не передаём `storage` здесь, если только агенту не нужна изолированная БД.
 *
 * Слои памяти (вместе формируют финальный контекст агента):
 *  1. История сообщений       - последние необработанные сообщения (`lastMessages`)
 *  2. Рабочая память          - постоянное структурированное состояние (профиль / черновик)
 *  3. Семантический поиск    - RAG по прошлым сообщениям (требует vector + embedder)
 *  4. Наблюдательная память  - фоновый агент сжимает старую историю в
 *                             плотные наблюдения (лучше для длинных чатов с инструментами)
 */
export interface CreateAgentMemoryOptions {
  /**
   * Количество последних сообщений, всегда добавляемых в контекст.
   * - Установите `false`, чтобы отключить необработанную историю (например, при использовании observationalMemory).
   * - Значение по умолчанию `20` — хороший баланс для чат-агентов.
   */
  lastMessages?: MemoryConfig['lastMessages'];

  /**
   * Постоянное структурированное состояние, которое агент поддерживает через
   * инструмент `updateWorkingMemory`. Используйте `schema` для типизированных полей
   * (семантика слияния) или `template` для свободного формата Markdown
   * (семантика замены). Взаимоисключающие опции.
   *
   * Область по умолчанию — `'resource'` (общая для всех потоков одного пользователя).
   * Используйте `scope: 'thread'` для эфемерного состояния для каждого разговора.
   */
  workingMemory?: WorkingMemory;

  /**
   * Семантический поиск по прошлым сообщениям. Требует настройки `vector` + `embedder`
   * (либо здесь, либо на экземпляре Mastra).
   * Отключено по умолчанию — добавляет задержку и стоимость эмбеддингов.
   */
  semanticRecall?: MemoryConfig['semanticRecall'];

  /**
   * Наблюдательная память: фоновые агенты сжимают старые сообщения в плотные
   * наблюдения, сохраняя контекстное окно небольшим, но сохраняя долгосрочную память.
   * Рекомендуется для агентов с длинными сессиями или большими выводами инструментов.
   *
   * Передайте `true` для настроек по умолчанию (model = `google/gemini-2.5-flash`) или объект
   * для настройки модели / бюджета токенов / области.
   *
   * Примечание: требуется хранилище `@mastra/pg`, `@mastra/libsql` или `@mastra/mongodb`.
   */
  observationalMemory?: MemoryConfig['observationalMemory'];

  /**
   * Автоматически генерировать заголовок потока из первого сообщения пользователя.
   * Передайте объект, чтобы использовать более дешёвую/быструю модель, чем основная модель агента.
   */
  generateTitle?: MemoryConfig['generateTitle'];

  /**
   * Предотвращает сохранение новых сообщений в памяти и отключает
   * инструмент `updateWorkingMemory`. Используйте для маршрутизации / предварительного просмотра / суб-агентов,
   * которые должны ЧИТАТЬ контекст, но никогда не изменять его.
   */
  readOnly?: MemoryConfig['readOnly'];

  /** Переопределяет векторное хранилище уровня экземпляра (только для семантического поиска). */
  vector?: SharedMemoryConfig['vector'];
  /** Переопределяет эмбеддер уровня экземпляра (только для семантического поиска). */
  embedder?: SharedMemoryConfig['embedder'];
  /** Переопределяет хранилище уровня экземпляра. По умолчанию наследуем от Mastra. */
  storage?: SharedMemoryConfig['storage'];
}

/**
 * Разумные настройки по умолчанию для чат-агентов:
 * - 20 последних сообщений в контексте
 * - Рабочая память отключена (каждый агент должен включить её со своей схемой)
 * - Семантическая / наблюдательная память отключены (имеют побочные эффекты: стоимость, задержка)
 * - Автоматическая генерация заголовков потоков для лучшего UX в Studio
 */
const DEFAULT_LAST_MESSAGES = 20;
const DEFAULT_GENERATE_TITLE = true;

export function createAgentMemory(
  options: CreateAgentMemoryOptions = {},
): Memory {
  const {
    lastMessages = DEFAULT_LAST_MESSAGES,
    workingMemory,
    semanticRecall,
    observationalMemory,
    generateTitle = DEFAULT_GENERATE_TITLE,
    readOnly,
    vector,
    embedder,
    storage,
  } = options;

  if (semanticRecall && !embedder && !vector) {
    // Мягкое предупреждение: semanticRecall требует векторное хранилище и эмбеддер.
    // Мы не выбрасываем исключение, потому что они могут быть настроены на экземпляре Mastra.
    console.warn(
      '[createAgentMemory] semanticRecall is enabled but no vector/embedder ' +
        'was provided. Make sure they are configured on the Mastra instance.',
    );
  }

  const memoryOptions: MemoryConfig = {
    lastMessages,
    generateTitle,
  };
  if (workingMemory) memoryOptions.workingMemory = workingMemory;
  if (semanticRecall) memoryOptions.semanticRecall = semanticRecall;
  if (observationalMemory) memoryOptions.observationalMemory = observationalMemory;
  if (readOnly !== undefined) memoryOptions.readOnly = readOnly;

  return new Memory({
    ...(storage ? { storage } : {}),
    ...(vector !== undefined ? { vector } : {}),
    ...(embedder ? { embedder } : {}),
    options: memoryOptions,
  });
}
