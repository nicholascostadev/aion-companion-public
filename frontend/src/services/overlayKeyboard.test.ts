import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installOverlayKeyboard, needsKeyboard } from './overlayKeyboard';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn<typeof invoke>() }));
afterEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = '';
});

const press = (target: Element, button = 0) =>
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button }));

describe('overlay keyboard', () => {
  it('treats only editable text as needing the keyboard', () => {
    document.body.innerHTML = `
      <input id="text" />
      <input id="search" type="search" />
      <input id="number" type="number" />
      <input id="check" type="checkbox" />
      <input id="disabled" disabled />
      <input id="readonly" readonly />
      <textarea id="area"></textarea>
      <select id="select"><option>One</option></select>
      <div id="editable" contenteditable="true"><span id="inside">Note</span></div>
      <button id="button">Pin</button>`;
    const typing = (ids: string[]) =>
      ids.filter((id) => needsKeyboard(document.getElementById(id)));
    expect(typing(['text', 'search', 'number', 'area'])).toEqual([
      'text',
      'search',
      'number',
      'area',
    ]);
    expect(typing(['check', 'disabled', 'readonly', 'select', 'button'])).toEqual([]);
    expect(needsKeyboard(null)).toBe(false);
  });

  it('asks for the keyboard only when a text field is pressed with the primary button', () => {
    vi.mocked(invoke).mockResolvedValue(true);
    document.body.innerHTML = '<button id="pin">Pin</button><input id="name" />';
    const uninstall = installOverlayKeyboard();
    press(document.getElementById('pin')!);
    press(document.getElementById('name')!, 2);
    expect(invoke).not.toHaveBeenCalled();
    press(document.getElementById('name')!);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('overlay_take_keyboard');
    uninstall();
    press(document.getElementById('name')!);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('keeps working when the window cannot come forward', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('unavailable'));
    document.body.innerHTML = '<textarea id="note"></textarea>';
    const uninstall = installOverlayKeyboard();
    press(document.getElementById('note')!);
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledOnce();
    uninstall();
  });
});
