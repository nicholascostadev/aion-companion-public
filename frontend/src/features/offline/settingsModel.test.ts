import { act, renderHook } from '@testing-library/react';
import { getI18n } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { OfflineSettings } from '../../types/offline';
import { shortcutFromEvent } from './HotkeyInput';
import { rebaseBarPositions, useSettingsDraft, validateSettings } from './settingsModel';

const base: OfflineSettings = { ...SETTINGS_FALLBACK };
// English messages from the shipped catalog (tests run in English).
const validate = (settings: OfflineSettings) =>
  validateSettings(settings, getI18n().getFixedT('en', 'settings'));
const bar = {
  id: 'b1',
  name: 'Bar',
  mode: 'cooldowns' as const,
  skills: [11000101],
  x: 0,
  y: 0,
  icon_size: 36,
  appearance: 'icons' as const,
  hidden: false,
};

describe('settings validation mirrors native limits', () => {
  it('accepts native defaults', () => {
    expect(validate(base)).toEqual({});
  });

  it('rejects out-of-range and fractional seconds', () => {
    const errors = validate({
      ...base,
      dummy_length_seconds: 5,
      idle_timeout_seconds: 2.5,
      refresh_ms: 20,
      opacity: 0.1,
    });
    expect(Object.keys(errors).sort()).toEqual([
      'dummy_length_seconds',
      'idle_timeout_seconds',
      'opacity',
      'refresh_ms',
    ]);
  });

  it('requires the unlock hotkey, frees Ctrl+Shift+F7 and rejects duplicates', () => {
    const errors = validate({
      ...base,
      hotkeys: {
        ...base.hotkeys,
        toggle_lock: '',
        reset: 'Ctrl+Shift+F7',
        copy_summary: 'Ctrl+Shift+F9',
      },
    });
    expect(errors['hotkeys.toggle_lock']).toMatch(/Required/);
    expect(errors['hotkeys.reset']).toBeUndefined();
    expect(errors['hotkeys.copy_summary']).toMatch(/Already used/);
  });

  it('checks preset keys, names, bar ids and positions', () => {
    const errors = validate({
      ...base,
      presets: [
        {
          id: 'p1',
          name: 'Main',
          class: null,
          keybind: 'Ctrl+Shift+F9',
          bars: [bar, { ...bar, x: 30000, icon_size: 8 }],
        },
        { id: 'p1', name: 'main', class: null, keybind: 'ctrl+shift+f7', bars: [] },
      ],
      active_preset: 'gone',
    });
    expect(errors['presets.0.keybind']).toMatch(/Already used/);
    expect(errors['presets.1.keybind']).toBeUndefined();
    expect(errors['presets.0.bars.1.id']).toMatch(/unique/);
    expect(errors['presets.0.bars.1.x']).toBeDefined();
    expect(errors['presets.0.bars.1.icon_size']).toBeDefined();
    expect(errors['presets.1.id']).toMatch(/unique/);
    expect(errors['presets.1.name']).toMatch(/already/);
    expect(errors.active_preset).toBeDefined();
  });

  it('validates alert schedules', () => {
    const alert = {
      id: 'a',
      name: 'Reset',
      enabled: true,
      at_ms: null,
      repeat_seconds: 0.5,
      lead_seconds: 90000,
      volume: 2,
      sound: 'chime',
    };
    const errors = validate({ ...base, alerts: [alert] });
    expect(Object.keys(errors).sort()).toEqual([
      'alerts.0.at_ms',
      'alerts.0.lead_seconds',
      'alerts.0.repeat_seconds',
      'alerts.0.volume',
    ]);
  });
});

describe('hotkey capture', () => {
  const press = (
    code: string,
    mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {},
  ) =>
    shortcutFromEvent({
      code,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      ...mods,
    });
  it('produces native shortcut syntax and refuses bare letters', () => {
    expect(press('KeyA', { ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+A');
    expect(press('Digit3', { altKey: true })).toBe('Alt+3');
    expect(press('F6')).toBe('F6');
    expect(press('KeyQ')).toBe('');
    expect(press('ShiftLeft', { shiftKey: true })).toBeNull();
  });
});

describe('saving settings never undoes an in-game drag', () => {
  const withBar = (x: number, y: number, name = 'Main'): OfflineSettings => ({
    ...base,
    presets: [{ id: 'p1', name, class: null, keybind: null, bars: [{ ...bar, x, y }] }],
    active_preset: 'p1',
  });

  it('takes native coordinates for bars the user did not move in the draft', () => {
    const origin = withBar(0, 0);
    const draft = { ...withBar(0, 0, 'Renamed'), opacity: 0.5 };
    const latest = withBar(300, 400);
    const saved = rebaseBarPositions(draft, origin, latest);
    expect(saved.presets[0]!.bars[0]).toMatchObject({ x: 300, y: 400 });
    expect(saved.presets[0]!.name).toBe('Renamed');
    expect(saved.opacity).toBe(0.5);
  });

  it('keeps coordinates the user edited in the workspace', () => {
    const saved = rebaseBarPositions(withBar(10, 10), withBar(0, 0), withBar(300, 400));
    expect(saved.presets[0]!.bars[0]).toMatchObject({ x: 10, y: 10 });
  });

  it('applies the rebase when the draft is saved after an in-game drag', async () => {
    const save = vi.fn<(s: OfflineSettings) => Promise<boolean>>().mockResolvedValue(true);
    const { result, rerender } = renderHook(({ settings }) => useSettingsDraft(settings, save), {
      initialProps: { settings: withBar(0, 0) },
    });
    act(() => result.current.update((s) => ({ ...s, opacity: 0.5 })));
    // The tracker surface patches positions natively while the draft is dirty.
    rerender({ settings: withBar(300, 400) });
    expect(result.current.dirty).toBe(true);
    await act(async () => {
      await result.current.save();
    });
    expect(save.mock.calls[0]![0].presets[0]!.bars[0]).toMatchObject({ x: 300, y: 400 });
    expect(save.mock.calls[0]![0].opacity).toBe(0.5);
  });
});
