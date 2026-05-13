import { describe, it, expect } from 'vitest';
import { PARADOX_TAGS, getParadoxHover, PARADOX_KIND_REGEX } from './paradoxTags.js';

describe('paradox tag metadata', () => {
  it('lists exactly four kinds with the wording from the spec', () => {
    expect(PARADOX_TAGS.component.hover).toBe('Render the component on Site Studio');
    expect(PARADOX_TAGS.snippet.hover).toBe('Render the snippet on Site Studio');
    expect(PARADOX_TAGS.data.hover).toBe('Render the data for Site Studio');
    expect(PARADOX_TAGS.attribute.hover).toBe('Render the data for Site Studio');
    expect(Object.keys(PARADOX_TAGS).sort()).toEqual(['attribute', 'component', 'data', 'snippet']);
  });

  it('getParadoxHover is case-sensitive and returns undefined on unknown', () => {
    expect(getParadoxHover('component')).toBe('Render the component on Site Studio');
    expect(getParadoxHover('Component' as never)).toBeUndefined();
    expect(getParadoxHover('widget' as never)).toBeUndefined();
  });

  it('PARADOX_KIND_REGEX matches kind:value with surrounding whitespace', () => {
    expect('component:Hero'.match(PARADOX_KIND_REGEX)?.slice(1)).toEqual(['component', 'Hero']);
    expect('  data : job.title  '.match(PARADOX_KIND_REGEX)?.slice(1)).toEqual(['data', 'job.title']);
    expect('attribute:className'.match(PARADOX_KIND_REGEX)?.slice(1)).toEqual(['attribute', 'className']);
    expect('forloop'.match(PARADOX_KIND_REGEX)).toBeNull();
    expect('not_a_kind:foo'.match(PARADOX_KIND_REGEX)).toBeNull();
  });
});
