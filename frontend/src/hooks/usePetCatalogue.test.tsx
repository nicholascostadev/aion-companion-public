import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { getI18n } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogue } from '../features/pets/fixtures';
import * as api from '../services/pets';
import { resetPetCatalogue, usePetCatalogue } from './usePets';

vi.mock('../services/pets', () => ({
  readPetsCatalogue: vi.fn<typeof api.readPetsCatalogue>(),
}));

beforeEach(() => {
  resetPetCatalogue();
  vi.mocked(api.readPetsCatalogue).mockResolvedValue(catalogue());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Home and Pets, both mounted in one workspace window. */
const both = () => renderHook(() => ({ home: usePetCatalogue(true), pets: usePetCatalogue(true) }));

describe('usePetCatalogue', () => {
  it('builds one index per window for every reader of the catalogue', async () => {
    const { result } = both();
    await waitFor(() => expect(result.current.home.index).not.toBeNull());
    expect(result.current.pets.index).toBe(result.current.home.index);
    expect(api.readPetsCatalogue).toHaveBeenCalledTimes(1);

    // A reader mounted later (e.g. Home shown again) reuses it rather than repeating spawns.
    const later = renderHook(() => usePetCatalogue(true));
    await waitFor(() => expect(later.result.current.index).toBe(result.current.home.index));
  });

  it('words a new language in a new shared index', async () => {
    const { result } = both();
    await waitFor(() => expect(result.current.home.index).not.toBeNull());
    const english = result.current.home.index!;
    const unnamed = english.unnamedNpc(42);

    await act(() => getI18n().changeLanguage('pt-BR'));
    await waitFor(() => expect(result.current.home.index).not.toBe(english));
    const portuguese = result.current.home.index!;
    expect(result.current.pets.index).toBe(portuguese);
    expect(portuguese.unnamedNpc(42)).not.toBe(unnamed);
    expect(portuguese.catalogue).toBe(english.catalogue);
  });
});
