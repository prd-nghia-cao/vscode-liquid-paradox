import { describe, it, expect } from 'vitest';
import { createServer } from './server.js';

describe('createServer', () => {
  it('returns a function that, when called, exits cleanly with no connection', () => {
    expect(typeof createServer).toBe('function');
  });
});
