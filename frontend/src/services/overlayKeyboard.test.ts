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

  it('lets a clicked button go of focus, but not a keyboard press, a field or a popup', () => {
    document.body.innerHTML = `
      <button id="dps"><svg id="icon"></svg></button>
      <input id="name" />
      <button id="more" aria-haspopup="menu">More</button>
      <div id="popup" tabindex="-1"><span id="row">Row</span></div>`;
    const focused = (id: string) => {
      const element = document.getElementById(id)!;
      element.focus();
      return element;
    };
    const click = (target: Element, detail = 1) =>
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
    const uninstall = installOverlayKeyboard();
    // A click on the button's icon still releases the button the press focused.
    focused('dps');
    click(document.getElementById('icon')!);
    expect(document.activeElement).toBe(document.body);
    // Enter or Space on a focused button clicks it with detail 0: focus stays for the keyboard.
    click(focused('dps'), 0);
    expect(document.activeElement?.id).toBe('dps');
    for (const id of ['name', 'more']) {
      click(focused(id));
      expect(document.activeElement?.id).toBe(id);
    }
    focused('popup');
    click(document.getElementById('row')!);
    expect(document.activeElement?.id).toBe('popup');
    uninstall();
    click(focused('dps'));
    expect(document.activeElement?.id).toBe('dps');
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
