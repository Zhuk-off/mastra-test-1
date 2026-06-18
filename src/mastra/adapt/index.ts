/** Публичный barrel модуля адаптации (этап 5). */
export { adaptSite } from './adapt-site.js';
export type { AdaptSiteOptions } from './adapt-site.js';
export { loadAdaptConfig, BUILTIN_ADAPT_CONFIG, ADAPT_CONFIG_FILENAME } from './config.js';
export type { AdaptConfig, VerticalConfig, LoadedAdaptConfig } from './config.js';
export { resolveImageTarget, resolveNameReplacement, resolveVertical, knownOwnImageBases } from './targets.js';
export { replaceProductImage } from './passes/replace-product-image.js';
export { replaceProductName } from './passes/replace-product-name.js';
export type { AdaptBrief, AdaptStats, AdaptChange, AdaptContext, AdaptPass, Vertical } from './types.js';
