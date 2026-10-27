import { useState, type KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/** Converts a key press to the native shortcut syntax, e.g. "Ctrl+Shift+F9". */
export function shortcutFromEvent(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
) {
  if (MODIFIER_CODES.has(event.code)) return null;
  const key = /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3)
    : /^Digit\d$/.test(event.code)
      ? event.code.slice(5)
      : event.code;
  const mods = [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Super',
  ].filter(Boolean);
  // A bare letter or digit would fire while typing in game chat.
  if (!mods.length && !/^F\d{1,2}$/.test(key)) return '';
  return [...mods, key].join('+');
}

export function HotkeyInput({
  id,
  value,
  onChange,
  required = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const { t } = useTranslation('settings');
  // A pressed key that needs a modifier first.
  const [needsModifier, setNeedsModifier] = useState(false);
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    if (event.key === 'Escape') {
      setRecording(false);
      setNeedsModifier(false);
      return;
    }
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      if (!required) onChange('');
      setRecording(false);
      return;
    }
    const shortcut = shortcutFromEvent(event);
    if (shortcut === null) return;
    if (shortcut === '') {
      setNeedsModifier(true);
      return;
    }
    onChange(shortcut);
    setRecording(false);
    setNeedsModifier(false);
  };
  return (
    <span className="relative flex flex-wrap items-center gap-1">
      <Input
        id={id}
        readOnly
        data-recording={recording || undefined}
        className={cn(
          'min-w-40 flex-1 cursor-pointer font-mono text-xs',
          !required && value && 'pr-8',
          'data-recording:border-accent data-recording:text-accent data-recording:shadow-glow',
        )}
        value={
          recording
            ? t(($) => $.hotkeys.input.recording)
            : value || t(($) => $.hotkeys.input.notSet)
        }
        onFocus={() => setRecording(true)}
        onBlur={() => {
          setRecording(false);
          setNeedsModifier(false);
        }}
        onKeyDown={onKey}
        aria-describedby={`${id}-how`}
      />
      {!required && value && (
        <Button
          size="xs"
          variant="ghost"
          iconOnly
          className="absolute top-1 right-1"
          aria-label={t(($) => $.hotkeys.input.clear)}
          title={t(($) => $.hotkeys.input.clear)}
          onClick={() => onChange('')}
        >
          <Icon name="close" size={13} />
        </Button>
      )}
      <small id={`${id}-how`} className="sr-only">
        {t(($) => $.hotkeys.input.how)}
      </small>
      {needsModifier && (
        <small className="w-full text-2xs text-warn">
          {t(($) => $.hotkeys.input.needsModifier)}
        </small>
      )}
    </span>
  );
}
