import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('keeps a background colour under a class-colour fade, which is an image', () => {
    expect(cn('bg-row-hover bg-mark-fade-25')).toBe('bg-row-hover bg-mark-fade-25');
    expect(cn('bg-mark-fade-25', 'bg-mark-fade-35')).toBe('bg-mark-fade-35');
  });
});
