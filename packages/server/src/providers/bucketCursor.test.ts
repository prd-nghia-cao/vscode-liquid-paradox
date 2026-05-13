import { describe, it, expect } from 'vitest';
import { bucketCursor } from './bucketCursor.js';

describe('bucketCursor', () => {
  it('classifies empty document as text', () => {
    expect(bucketCursor('', 0)).toEqual({ region: 'text', openOffset: -1, body: '' });
  });

  it('classifies pure HTML cursor as text', () => {
    const t = '<h1>Hello</h1>';
    expect(bucketCursor(t, 5).region).toBe('text');
  });

  it('classifies cursor immediately after `{%` as empty tag body', () => {
    const b = bucketCursor('{%', 2);
    expect(b.region).toBe('tag');
    expect(b.body).toBe('');
    expect(b.tagName).toBeUndefined();
  });

  it('classifies cursor immediately after `{{` as empty output body', () => {
    const b = bucketCursor('{{', 2);
    expect(b.region).toBe('output');
    expect(b.body).toBe('');
  });

  it('classifies cursor immediately after `{%-` as empty tag body', () => {
    const b = bucketCursor('{%-', 3);
    expect(b.region).toBe('tag');
    expect(b.body).toBe('');
  });

  it('classifies cursor immediately after `{{-` as empty output body', () => {
    const b = bucketCursor('{{-', 3);
    expect(b.region).toBe('output');
    expect(b.body).toBe('');
  });

  it('treats `{% %}` open with cursor at 2 as tag body (auto-close ignored)', () => {
    const b = bucketCursor('{% %}', 2);
    expect(b.region).toBe('tag');
    expect(b.body).toBe('');
  });

  it('treats `{{ }}` open with cursor at 2 as output body (auto-close ignored)', () => {
    const b = bucketCursor('{{ }}', 2);
    expect(b.region).toBe('output');
    expect(b.body).toBe('');
  });

  it('captures tag name after `{% if`', () => {
    const b = bucketCursor('{% if', 5);
    expect(b.region).toBe('tag');
    expect(b.tagName).toBe('if');
    expect(b.body).toBe(' if');
  });

  it('captures partial tag name `{%a` as tag region (no tag name yet)', () => {
    const b = bucketCursor('{%a', 3);
    expect(b.region).toBe('tag');
    expect(b.tagName).toBe('a');
  });

  it('recognizes `{% for x ` body for continuation suggestions', () => {
    const src = '{% for x ';
    const b = bucketCursor(src, src.length);
    expect(b.region).toBe('tag');
    expect(b.tagName).toBe('for');
    expect(b.body).toBe(' for x ');
  });

  it('recognizes `{{ x|` cursor as output-after-pipe (no space before pipe)', () => {
    const src = '{{ x|';
    const b = bucketCursor(src, src.length);
    expect(b.region).toBe('output-after-pipe');
    expect(b.filterPartial).toBe('');
  });

  it('recognizes `{{ x | up` cursor as output-after-pipe with partial filter', () => {
    const src = '{{ x | up';
    const b = bucketCursor(src, src.length);
    expect(b.region).toBe('output-after-pipe');
    expect(b.filterPartial).toBe('up');
  });

  it('recognizes `{{co` cursor as paradox-intent', () => {
    const src = '{{co';
    const b = bucketCursor(src, src.length);
    expect(b.region).toBe('paradox-intent');
  });

  it('recognizes `{{component:` cursor as paradox-value-typing with empty value', () => {
    const src = '{{component:';
    const b = bucketCursor(src, src.length);
    expect(b.region).toBe('paradox-value-typing');
    expect(b.paradoxKind).toBe('component');
  });

  it('recognizes `{{component:Hero` cursor as paradox-value-typing with partial value', () => {
    const src = '{{component:Hero';
    const b = bucketCursor(src, src.length);
    expect(b.region).toBe('paradox-value-typing');
    expect(b.paradoxKind).toBe('component');
  });

  it('recognizes `{{component:Hero ` (trailing space) as paradox-confirmed', () => {
    const src = '{{component:Hero ';
    const b = bucketCursor(src, src.length);
    expect(b.region).toBe('paradox-confirmed');
    expect(b.paradoxKind).toBe('component');
  });

  it('classifies cursor inside a render string literal', () => {
    const src = '{% render "';
    const b = bucketCursor(src, src.length);
    expect(b.region).toBe('string-render-path');
    expect(b.tagName).toBe('render');
  });

  it('classifies cursor inside a layout string literal', () => {
    const src = '{% layout "';
    const b = bucketCursor(src, src.length);
    expect(b.region).toBe('string-layout-path');
    expect(b.tagName).toBe('layout');
  });

  it('classifies cursor inside render kwargs after a comma', () => {
    const src = '{% render "button", ';
    const b = bucketCursor(src, src.length);
    expect(b.region).toBe('render-args');
    expect(b.renderTarget).toBe('button');
  });

  it('does not mis-bucket cursor inside HTML text following a closed tag', () => {
    const src = '{% assign x = 1 %}<h1>';
    const b = bucketCursor(src, src.length);
    expect(b.region).toBe('text');
  });

  it('does not mis-bucket cursor inside HTML text following a closed output', () => {
    const src = '{{ x }}<h1>';
    const b = bucketCursor(src, src.length);
    expect(b.region).toBe('text');
  });

  // Regression for the bug "typing `{%` shows no completions". When VS Code's
  // single-char `{` -> `}` auto-close fires before the `{%` -> `%}` pair, the
  // buffer ends up as `{%}` (3 chars) with the cursor at offset 2. The cursor
  // is at the boundary `{%|}` — we must treat this as "inside an open tag",
  // not as "after a `%}` close".
  it('treats `{%}` cursor at 2 as tag-open body (single-char autoclose conflict)', () => {
    const b = bucketCursor('{%}', 2);
    expect(b.region).toBe('tag');
    expect(b.body).toBe('');
  });

  it('treats `{{}` cursor at 2 as output-open body (single-char autoclose conflict)', () => {
    const b = bucketCursor('{{}', 2);
    expect(b.region).toBe('output');
    expect(b.body).toBe('');
  });

  it('treats `{%-}` cursor at 3 as tag-open body', () => {
    const b = bucketCursor('{%-}', 3);
    expect(b.region).toBe('tag');
    expect(b.body).toBe('');
  });

  it('treats `{{-}` cursor at 3 as output-open body', () => {
    const b = bucketCursor('{{-}', 3);
    expect(b.region).toBe('output');
    expect(b.body).toBe('');
  });
});
