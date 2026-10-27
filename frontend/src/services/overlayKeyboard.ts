import { invoke } from '@tauri-apps/api/core';

/** Input types that never need the keyboard: buttons, toggles, pickers and sliders. */
const POINTER_ONLY = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** True when pressing `target` starts typing: an editable text field or editable content. */
export function needsKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const field = target.closest('input, textarea, [contenteditable]');
  if (field instanceof HTMLInputElement)
    return !field.disabled && !field.readOnly && !POINTER_ONLY.has(field.type);
  if (field instanceof HTMLTextAreaElement) return !field.disabled && !field.readOnly;
  return field instanceof HTMLElement && field.isContentEditable;
}

async function takeKeyboard() {
  try {
    await invoke('overlay_take_keyboard');
  } catch {
    // The field still works with the mouse; typing waits for the next press.
  }
}

/**
 * In-game windows never take focus from the game, so clicking them keeps AION in front and
 * its audio playing. Typing is the exception: keyboard input only reaches the foreground
 * window, so a primary press on a text field brings this window forward. Returns the
 * uninstaller.
 */
export function installOverlayKeyboard(root: Document = document): () => void {
  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 0 && needsKeyboard(event.target)) void takeKeyboard();
  };
  root.addEventListener('pointerdown', onPointerDown, true);
  return () => root.removeEventListener('pointerdown', onPointerDown, true);
}
