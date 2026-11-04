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

/** Controls a click only presses; a focused popup or menu item is left to its popup. */
const PRESSABLE = 'button, [role="button"], [role="switch"], [role="tab"], summary, a[href], input';

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
 *
 * A clicked button lets go of focus as soon as its click has run. The window never becomes
 * the foreground window, so that focus could never be moved by the keyboard. It would stay on
 * the button, highlighted, while the user plays. A click from the keyboard (`detail` 0)
 * keeps its focus. So do text fields, popups, and controls that open a popup, whose focus
 * the popup manages.
 */
export function installOverlayKeyboard(root: Document = document): () => void {
  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 0 && needsKeyboard(event.target)) void takeKeyboard();
  };
  // Bubbling on the document, so it runs after the click's own handlers (React's root).
  const onClick = (event: MouseEvent) => {
    const active = root.activeElement;
    if (
      event.detail === 0 ||
      !(active instanceof HTMLElement) ||
      !active.matches(PRESSABLE) ||
      !(event.target instanceof Node) ||
      !active.contains(event.target) ||
      needsKeyboard(active) ||
      active.matches('[aria-haspopup]:not([aria-haspopup="false"])')
    )
      return;
    active.blur();
  };
  root.addEventListener('pointerdown', onPointerDown, true);
  root.addEventListener('click', onClick);
  return () => {
    root.removeEventListener('pointerdown', onPointerDown, true);
    root.removeEventListener('click', onClick);
  };
}
