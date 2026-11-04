import { useState, type RefObject } from 'react';
import { Icon } from '../../components/ui/Icon';
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from '../../components/ui/Menu';
import { WindowButton } from '../../components/ui/Overlay';
import { Pressable } from '../../components/ui/Pressable';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { ProfileSelection, SavedCharacter } from '../../types/profile';

/** The saved-list key of a character: its exact name on its server. */
export const savedKey = (c: { server_id: number; name: string }) => `${c.server_id}|${c.name}`;

const menuItem = cn(
  'grid min-h-[24px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5',
  'rounded-md px-1.5 py-0.5 text-xs leading-snug text-ink',
);

/** `Triniel`, or the server id when the app has no name for it. */
const serverLabel = (c: SavedCharacter) => c.server_name ?? String(c.server_id);

/** Star in the caption: saves or forgets the shown character. */
export function SaveToggle({
  saved,
  full,
  busy,
  name,
  onToggle,
}: {
  saved: boolean;
  /** The list is full, so only a saved character can be toggled. */
  full: boolean;
  busy: boolean;
  name: string;
  onToggle: () => void;
}) {
  const { t } = useTranslation('profile');
  const label = saved ? t(($) => $.saved.remove) : t(($) => $.saved.add);
  return (
    <WindowButton
      size="sm"
      aria-pressed={saved}
      disabled={busy || (!saved && full)}
      title={
        !saved && full
          ? t(($) => $.saved.fullTitle)
          : saved
            ? t(($) => $.saved.removeTitle, { name })
            : t(($) => $.saved.addTitle, { name })
      }
      aria-label={label}
      className={cn(saved && 'text-accent')}
      onClick={onToggle}
    >
      <Icon name="star" size={14} className={cn(saved && '[&_path]:fill-current')} />
    </WindowButton>
  );
}

/** Caption menu listing the saved characters; choosing one opens its profile. */
export function SavedMenu({
  saved,
  max,
  current,
  container,
  onOpen,
}: {
  saved: SavedCharacter[];
  max: number;
  current: ProfileSelection | null;
  container: RefObject<HTMLElement | null>;
  onOpen: (character: SavedCharacter) => void;
}) {
  const { t } = useTranslation('profile');
  const [open, setOpen] = useState(false);
  const byKey = new Map(saved.map((c) => [savedKey(c), c]));
  return (
    <Menu open={open} onOpenChange={setOpen} modal={false}>
      <MenuTrigger
        render={
          <WindowButton
            size="sm"
            className={cn(open && 'text-accent')}
            title={t(($) => $.saved.menuTitle, { count: saved.length, max })}
            aria-label={t(($) => $.saved.menu)}
          />
        }
      >
        <Icon name="list" size={14} />
      </MenuTrigger>
      <MenuPopup
        container={container}
        className="max-h-72 w-[min(260px,calc(100vw-16px))]"
        aria-label={t(($) => $.saved.menu)}
      >
        <p className="m-0 px-1.5 py-1 text-3xs font-semibold tracking-caps text-ink-3 uppercase">
          {t(($) => $.saved.menu)}{' '}
          <span className="text-ink-4 figures">
            {t(($) => $.saved.count, { count: saved.length, max })}
          </span>
        </p>
        {saved.length === 0 ? (
          <p className="m-0 px-1.5 py-1 text-2xs text-ink-3">{t(($) => $.saved.none)}</p>
        ) : (
          <MenuRadioGroup
            value={current ? savedKey(current) : ''}
            onValueChange={(value: string) => {
              const character = byKey.get(value);
              if (character) onOpen(character);
            }}
          >
            {saved.map((c) => (
              <MenuRadioItem key={savedKey(c)} value={savedKey(c)} className={menuItem}>
                <Icon name="star" size={12} className="text-accent [&_path]:fill-current" />
                <span className="truncate font-semibold">{c.name}</span>
                <span className="truncate text-2xs text-ink-3">{serverLabel(c)}</span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        )}
      </MenuPopup>
    </Menu>
  );
}

/** Caption menu to share the character: its Shugo.gg link, or a one-line summary. */
export function ShareMenu({
  container,
  copied,
  onCopyLink,
  onCopySummary,
}: {
  container: RefObject<HTMLElement | null>;
  copied: 'link' | 'summary' | null;
  onCopyLink?: (() => void) | undefined;
  onCopySummary?: (() => void) | undefined;
}) {
  const { t } = useTranslation('profile');
  return (
    <Menu modal={false}>
      <MenuTrigger
        render={
          <WindowButton
            size="sm"
            className={cn(copied && 'text-success')}
            title={t(($) => $.actions.shareTitle)}
            aria-label={t(($) => $.actions.share)}
          />
        }
      >
        <Icon name={copied ? 'check' : 'link'} size={14} />
      </MenuTrigger>
      <MenuPopup
        container={container}
        className="w-[min(240px,calc(100vw-16px))]"
        aria-label={t(($) => $.actions.share)}
      >
        {onCopyLink && (
          <MenuItem className={menuItem} onClick={onCopyLink}>
            <Icon name="link" size={12} className="text-ink-3" />
            <span>{t(($) => $.actions.copyLink)}</span>
            <span />
          </MenuItem>
        )}
        {onCopySummary && (
          <MenuItem className={menuItem} onClick={onCopySummary}>
            <Icon name="copy" size={12} className="text-ink-3" />
            <span>{t(($) => $.actions.copy)}</span>
            <span />
          </MenuItem>
        )}
      </MenuPopup>
    </Menu>
  );
}

/** The saved characters as a list to open, for a window with no character shown. */
export function SavedList({
  saved,
  onOpen,
}: {
  saved: SavedCharacter[];
  onOpen: (character: SavedCharacter) => void;
}) {
  const { t } = useTranslation('profile');
  if (!saved.length) return null;
  return (
    <section className="mx-auto w-full max-w-sm px-3 pb-4" aria-label={t(($) => $.saved.menu)}>
      <h3 className="mb-1.5 text-2xs font-semibold tracking-caps text-ink-3 uppercase">
        {t(($) => $.saved.menu)}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {saved.map((c) => (
          <li key={savedKey(c)}>
            <Pressable
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-row-hover"
              aria-label={t(($) => $.saved.openLabel, { name: c.name, server: serverLabel(c) })}
              onClick={() => onOpen(c)}
            >
              <Icon name="star" size={12} className="text-accent [&_path]:fill-current" />
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.name}</span>
              <span className="truncate text-2xs text-ink-3">{serverLabel(c)}</span>
            </Pressable>
          </li>
        ))}
      </ul>
    </section>
  );
}
