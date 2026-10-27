import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { classArt, skillArt } from '../../lib/gameArt';
import { petArt } from '../../lib/petArt';
import { petTypeArt } from '../../lib/petTypeArt';
import { ClassIcon, PetPortrait, PetTypeIcon, SkillIcon, SkillLabel } from './GameArt';

afterEach(cleanup);

describe('game artwork icons', () => {
  it('leads a skill name with its decorative, non-draggable original icon', () => {
    const { container } = render(<SkillLabel id={18290000}>Spinning Strike</SkillLabel>);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(skillArt(18290000)!.src);
    // The adjacent text names the skill, so the image stays out of the accessible name.
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(screen.getByText('Spinning Strike')).toBeTruthy();
  });

  it('keeps only the written name for a skill without verified artwork', () => {
    const { container } = render(<SkillLabel id={11000101}>Snipe</SkillLabel>);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('Snipe');
  });

  it('falls back cleanly when an image fails to load', () => {
    // Raging Spell is used only here, so the shared failure memory affects no other test.
    const { container } = render(
      <>
        <SkillIcon id={18770000} fallback="RS" />
        <SkillLabel id={18770000}>Raging Spell</SkillLabel>
      </>,
    );
    const [first] = [...container.querySelectorAll('img')];
    fireEvent.error(first!);
    expect(container.textContent).toBe('RSRaging Spell');
    // Later renders skip the broken image instead of showing a broken-image glyph.
    cleanup();
    const again = render(<SkillIcon id={18770000} />);
    expect(again.container.querySelector('img')).toBeNull();
  });

  it('labels an icon only when asked to stand on its own', () => {
    render(<ClassIcon name="Chanter" label="Chanter" />);
    const img = screen.getByRole('img', { name: 'Chanter' });
    expect(img.getAttribute('src')).toBe(classArt('Chanter')!.src);
    expect(img.hasAttribute('aria-hidden')).toBe(false);
  });

  it('frames a pet portrait, decorative beside its written name', () => {
    const { container } = render(<PetPortrait id={1002} lazy />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(petArt(1002)!.src);
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
  });

  it('names a standalone pet portrait, and its written fallback', () => {
    render(<PetPortrait id={1001} label="Black Dragon" />);
    expect(screen.getByRole('img', { name: 'Black Dragon' }).tagName).toBe('IMG');
    cleanup();
    render(<PetPortrait id={1} label="Test pet" />);
    expect(screen.getByRole('img', { name: 'Test pet' }).textContent).toBe('No portrait');
  });

  it('writes a note instead of a broken pet portrait', () => {
    // Pet 1003 is used only here, so the shared failure memory affects no other test.
    const { container } = render(<PetPortrait id={1003} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('No portrait');
  });

  it('shows a pet family by its original type symbol, decorative unless labelled', () => {
    const { container } = render(<PetTypeIcon family="Fera" />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(petTypeArt('Fera')!.src);
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(img.classList.contains('pet-type-art')).toBe(true);
    cleanup();
    render(<PetTypeIcon family="Specia" label="Specia" />);
    expect(screen.getByRole('img', { name: 'Specia' }).tagName).toBe('IMG');
    cleanup();
    expect(render(<PetTypeIcon family="all" />).container.innerHTML).toBe('');
  });

  it('draws nothing for an unknown class', () => {
    const { container } = render(<ClassIcon name="Entity" />);
    expect(container.innerHTML).toBe('');
  });
});
