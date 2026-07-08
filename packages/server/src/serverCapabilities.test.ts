import { describe, it, expect } from 'vitest';
import { COMPLETION_TRIGGER_CHARACTERS } from './serverCapabilities.js';

describe('LSP server capabilities', () => {
  it('advertises the full trigger-character set required for Liquid completions', () => {
    const required = ['{', '%', '}', '|', '"', "'", '.', ',', ':', '-', ' '];
    for (const ch of required) {
      expect(COMPLETION_TRIGGER_CHARACTERS).toContain(ch);
    }
  });

  it('has no duplicate trigger characters', () => {
    const unique = new Set(COMPLETION_TRIGGER_CHARACTERS);
    expect(unique.size).toBe(COMPLETION_TRIGGER_CHARACTERS.length);
  });

  it('includes the HTML IntelliSense trigger characters', () => {
    for (const ch of ['<', '=', '/']) {
      expect(COMPLETION_TRIGGER_CHARACTERS).toContain(ch);
    }
  });

  it('retains every Liquid trigger character alongside the HTML additions', () => {
    const liquid = ['{', '%', '}', '|', '"', "'", '.', ',', ':', '-', ' '];
    for (const ch of liquid) {
      expect(COMPLETION_TRIGGER_CHARACTERS).toContain(ch);
    }
  });

  it('matches the full trigger-character set (Liquid + HTML)', () => {
    expect([...COMPLETION_TRIGGER_CHARACTERS].sort()).toEqual(
      [' ', '"', '%', "'", ',', '-', '.', '/', ':', '<', '=', '{', '|', '}'].sort(),
    );
  });
});
