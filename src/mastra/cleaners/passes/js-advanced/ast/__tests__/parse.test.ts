import { describe, it, expect } from 'vitest';
import { parseJs, posToLine, snippetAt } from '../parse.js';

describe('parseJs', () => {
  it('парсит корректный JS', () => {
    const ast = parseJs('const x = 1;', 'test.js');
    expect(ast).not.toBeNull();
    expect(ast?.type).toBe('Program');
  });

  it('пробует module, потом script', () => {
    // import — только в module mode
    const ast = parseJs('import x from "y";', 'test.js');
    expect(ast).not.toBeNull();
  });

  it('возвращает null для сломанного JS', () => {
    const ast = parseJs('{{{{', 'broken.js');
    expect(ast).toBeNull();
  });
});

describe('PARSE-1 — Annex B HTML-комментарии не выключают AST-анализ', () => {
  // acorn НЕ берёт `<!--`/`-->` в module-режиме, но БЕРЁТ в script-режиме. parseJs пробует
  // module→script, поэтому legacy `<script><!-- … //--></script>` всё равно парсится (script
  // fallback) → файл анализируется, а не «тихо null». Регресс-замок против удаления fallback.
  it('классический <!-- … //--> парсится', () => {
    const ast = parseJs('<!--\nvar x = 1; document.write(x);\n//-->', 'legacy.js');
    expect(ast).not.toBeNull();
    expect(ast?.type).toBe('Program');
  });

  it('голый -->-закрыватель в начале строки парсится', () => {
    expect(parseJs('<!--\nvar x = 1;\n-->', 'legacy.js')).not.toBeNull();
  });

  it('inline <!-- в середине (legacy) парсится', () => {
    expect(parseJs('var a = 1; <!-- legacy\nvar b = 2;', 'legacy.js')).not.toBeNull();
  });
});

describe('posToLine', () => {
  it('правильно считает строку', () => {
    expect(posToLine('a\nb\nc', 4)).toBe(3); // позиция 'c'
  });
});

describe('snippetAt', () => {
  it('возвращает срез кода', () => {
    expect(snippetAt('const x = 1;', 0, 12)).toBe('const x = 1;');
  });

  it('сокращает пробелы', () => {
    expect(snippetAt('const  x =  \n  1;', 0, 17)).toBe('const x = 1;');
  });

  it('ограничивает длину до 200 символов', () => {
    const long = 'x'.repeat(500);
    const result = snippetAt(long, 0, 500);
    expect(result.length).toBe(200);
  });
});
