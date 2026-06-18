import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { resolve } from 'node:path';
import { adaptSite } from '../../adapt/index.js';
import type { AdaptBrief } from '../../adapt/index.js';

export const adaptSiteTool = createTool({
  id: 'adapt-site',
  description:
    'Этап АДАПТАЦИИ — ПОСЛЕДНИЙ ЛОКАЛЬНЫЙ шаг, запускать ПОСЛЕ clean-site и verify-site (никогда до verify). ' +
    'Подставляет в очищенный лендинг продуктовые значения под оффер: (1) продуктовое изображение → ' +
    'серверный макрос Keitaro {_offer_value:offerimage} по вертикали (полный cloudfront-URL; на трекере ' +
    'раскроется в имя_товара.webp — локально НЕ резолвится и не качается), (2) название товара → ' +
    '{_offer_value:offername} (заменяются ВСЕ вхождения productName в тексте/alt/title/meta). ' +
    'Картинка ищется по offer-якорю <a href="{offer}"> с <img> или по чужому макросу в src. ' +
    'Вертикаль по умолчанию берётся из adapt.config.json (Adult); указывай vertical только чтобы переопределить. ' +
    'Для замены имени нужен productName (текущее название на лендинге). Идемпотентно; повторный прогон с другой ' +
    'вертикалью ПЕРЕНАЦЕЛИВАЕТ ранее вставленный URL (re-point). Пишет adapt-report.md. ' +
    'ВАЖНО: НЕ запускай verify-site после адаптации — макросы раскрываются только на трекере при отдаче, ' +
    'локально картинки будут «битые», это норма. Если warnings непусты — покажи их пользователю.',
  inputSchema: z.object({
    siteDir: z.string().describe('Путь к УЖЕ очищенной и проверенной папке лендинга'),
    vertical: z
      .string()
      .optional()
      .describe('Вертикаль: Adult/WeightLoss (встроенные) или своя из adapt.config.json. Не указано → defaultVertical из конфига (Adult)'),
    imageMode: z
      .enum(['macro', 'file', 'skip'])
      .optional()
      .default('macro')
      .describe("'macro' (по умолч.) — база вертикали из конфига; 'file' — свой URL/макрос (imageFile); 'skip' — не трогать"),
    imageFile: z.string().optional().describe('Свой URL/макрос картинки, если imageMode=file'),
    nameMode: z
      .enum(['macro', 'literal', 'skip'])
      .optional()
      .default('macro')
      .describe("'macro' (по умолч.) — макрос имени из конфига/nameMacro; 'literal' — строка nameLiteral; 'skip' — не трогать"),
    productName: z.string().optional().describe('Текущее название продукта на лендинге, которое надо заменить (напр. "PowerGummies")'),
    nameAliases: z.array(z.string()).optional().describe('Доп. варианты написания названия (мн. число, бренд+форма)'),
    nameMacro: z.string().optional().describe('Свой макрос имени (переопределяет конфиг), если nameMode=macro'),
    nameLiteral: z.string().optional().describe('Строка-замена, если nameMode=literal'),
  }),
  outputSchema: z.object({
    siteDir: z.string(),
    vertical: z.string(),
    configSource: z.enum(['file', 'builtin']),
    htmlFilesProcessed: z.number(),
    imagesReplaced: z.number(),
    namesReplaced: z.number(),
    warnings: z.array(z.string()),
    changesCount: z.number(),
    reportPath: z.string(),
  }),
  execute: async ({ siteDir, vertical, imageMode, imageFile, nameMode, productName, nameAliases, nameMacro, nameLiteral }) => {
    const dir = resolve(siteDir);
    const brief: AdaptBrief = {
      vertical,
      image: { mode: imageMode ?? 'macro', file: imageFile },
      name: { mode: nameMode ?? 'macro', productName, aliases: nameAliases, macro: nameMacro, literal: nameLiteral },
    };
    const stats = await adaptSite(dir, brief);
    return {
      siteDir: dir,
      vertical: stats.vertical,
      configSource: stats.configSource,
      htmlFilesProcessed: stats.htmlFilesProcessed,
      imagesReplaced: stats.imagesReplaced,
      namesReplaced: stats.namesReplaced,
      warnings: stats.warnings,
      changesCount: stats.changes.length,
      reportPath: stats.reportPath,
    };
  },
});
