import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FamilyLabel } from './parts';

// Only Cognia and Natura have a symbol here, so the others exercise the written fallback.
vi.mock('../../lib/petTypeArt', () => ({
  petTypeArt: (family: string) =>
    family === 'Cognia' || family === 'Natura'
      ? { src: `/pet-type-art/${family.toLowerCase()}-test.webp`, width: 94, height: 106 }
      : null,
}));

afterEach(cleanup);

describe('family label', () => {
  it('leads the written family name with its decorative original symbol', () => {
    const { container } = render(<FamilyLabel family="Cognia" className="pet-card-family" />);
    const label = container.firstElementChild!;
    expect([...label.classList]).toEqual(expect.arrayContaining(['pet-family', 'pet-card-family']));
    const img = label.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/pet-type-art/cognia-test.webp');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(label.querySelector('svg')).toBeNull();
    expect(label.textContent).toBe('Cognia');
  });

  it('keeps only the written name without a symbol, never a substitute glyph', () => {
    const { container } = render(<FamilyLabel family="Fera" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('Fera');
  });

  it('drops a symbol that fails to load and keeps the name', () => {
    const { container } = render(<FamilyLabel family="Natura" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('Natura');
  });

  it('leads the generic All choice with a plain paw', () => {
    const { container } = render(<FamilyLabel family="all" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg.icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.textContent).toBe('All');
  });
});
