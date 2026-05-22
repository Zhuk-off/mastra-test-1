/**
 * Detect JS obfuscation patterns.
 * Files identified as obfuscated are deleted entirely (like metric files).
 *
 * Criteria (any 1 of 3 suffices):
 *  1. More than 15% of identifiers are in _0x[a-f0-9]{4,8} format
 *  2. Dean Edwards packer signature: (function(p,a,c,k,e,d){...})(...)
 *  3. String['fromCharCode'] chained usage
 *
 * Returns true if the file should be removed.
 */
export function detectObfuscation(source: string): boolean {
  // Criterion 1: high ratio of _0x hex-named identifiers
  const hexVarCount = (source.match(/_0x[a-f0-9]{4,8}/gi) ?? []).length;
  const totalIdentifiers = (source.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) ?? []).length;
  if (totalIdentifiers > 0 && hexVarCount / totalIdentifiers > 0.15) return true;

  // Criterion 2: Dean Edwards packer pattern
  if (/eval\s*\(\s*function\s*\(p,a,c,k,e/.test(source)) return true;

  // Criterion 3: String['fromCharCode'] chained obfuscation
  if (/String\s*\[\s*['"]fromCharCode['"]\s*\]/.test(source)) return true;

  return false;
}
