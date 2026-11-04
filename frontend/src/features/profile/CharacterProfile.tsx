import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { ClassIcon } from '../../components/ui/GameArt';
import { HoverCard, useHoverCard } from '../../components/ui/HoverCard';
import { Icon } from '../../components/ui/Icon';
import {
  CaptionState,
  CaptionTitle,
  OverlayCaption,
  overlayWindow,
  WindowButton,
} from '../../components/ui/Overlay';
import { TabList, TabPanel, Tabs } from '../../components/ui/Tabs';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type {
  Board,
  CharacterSheet,
  EquippedItem,
  ItemDetail,
  Lazy,
  ProfileSelection,
  SavedCharacter,
  Title,
} from '../../types/profile';
import { CosmeticsTab } from './CosmeticsTab';
import { DaevanionTab } from './DaevanionTab';
import { ArcanaTab } from './ArcanaTab';
import { EquipmentTab } from './EquipmentTab';
import { gradeStyle, profileSummary } from './model';
import { GradeWord, OfficialArt, initial } from './parts';
import { SavedList, SavedMenu, SaveToggle, ShareMenu, savedKey } from './ProfileActions';
import { SkillsTab } from './SkillsTab';
import { ErrorLine, SheetError } from './states';
import { StatsTab } from './StatsTab';

export type ProfileTab = 'equipment' | 'arcana' | 'skills' | 'daevanion' | 'stats' | 'cosmetics';
const TABS: readonly ProfileTab[] = [
  'equipment',
  'arcana',
  'skills',
  'daevanion',
  'stats',
  'cosmetics',
];
const TAB_ICONS = {
  equipment: 'armor',
  arcana: 'card',
  skills: 'event',
  daevanion: 'daevanion',
  stats: 'stats',
  cosmetics: 'cosmetics',
} as const;

/** The profile data and its loaders, as the window's hook provides them. */
export interface ProfileData {
  sheet: Lazy<CharacterSheet> | null;
  items: Record<string, Lazy<ItemDetail>>;
  boards: Record<number, Lazy<Board>>;
  refresh: () => void;
  retry: () => void;
  loadItem: (item: EquippedItem, again?: boolean) => void;
  loadBoard: (id: number, again?: boolean) => void;
}

interface Props {
  native: boolean;
  /** The character native selected, or null (none yet, or names hidden). */
  selection: ProfileSelection | null;
  hideNames: boolean;
  profile: ProfileData;
  itemKey: (item: EquippedItem) => string;
  /** Window action failures (close, copy, opening the website). */
  windowError?: string;
  onClose: () => void;
  /** Copies one line about the character; omitted where there is no clipboard. */
  onCopy?: ((text: string) => Promise<void>) | undefined;
  /** Copies the character's Shugo.gg address (native builds it); omitted without a clipboard. */
  onCopyLink?: (() => Promise<void>) | undefined;
  /** Opens the character on Shugo.gg in the browser (native builds the address). */
  onOpenShugo?: (() => void) | undefined;
  /** Saved characters, newest first, as native keeps them. */
  saved?: SavedCharacter[];
  savedMax?: number;
  /** Saves or forgets the shown character; omitted where native keeps no list. */
  onSetSaved?: ((saved: boolean) => Promise<void>) | undefined;
  /** Opens a saved character in this window. */
  onOpenSaved?: ((character: SavedCharacter) => void) | undefined;
  /**
   * Windows refused this open the foreground, so the game may still hold the mouse; the
   * button asks again from the user's own click.
   */
  onTakeFocus?: (() => void) | undefined;
}

/** A title the character wears, with its effects on hover or focus. */
function TitleChip({
  title,
  trigger,
}: {
  title: Title;
  trigger: ReturnType<ReturnType<typeof useHoverCard>['trigger']>;
}) {
  return (
    <li>
      <span
        {...trigger}
        // Focusable so the effects are reachable without a pointer.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- opens an informational card on focus
        tabIndex={0}
        className={cn(
          'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-2xs',
          gradeStyle(title.grade).edge,
        )}
      >
        <span className="text-ink-3">{title.category}</span>
        <span className={cn('truncate font-semibold', gradeStyle(title.grade).ink)}>
          {title.name}
        </span>
      </span>
    </li>
  );
}

/**
 * One character's public profile from NCSOFT's official character service, in its own
 * in-game window: a header with who they are, then Equipment, Arcana, Skills, Daevanion,
 * Stats and Cosmetics. Anything the service did not send says so; nothing is estimated.
 */
export function CharacterProfile({
  native,
  selection,
  hideNames,
  profile,
  itemKey,
  windowError = '',
  onClose,
  onCopy,
  onCopyLink,
  onOpenShugo,
  saved = [],
  savedMax = 50,
  onSetSaved,
  onOpenSaved,
  onTakeFocus,
}: Props) {
  const { t } = useTranslation('profile');
  const fmt = useFormat();
  const root = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<ProfileTab>('equipment');
  const [copied, setCopied] = useState<'link' | 'summary' | null>(null);
  const [saving, setSaving] = useState(false);
  const titleHover = useHoverCard();
  const sheet = profile.sheet;
  const data = sheet?.data ?? null;
  const info = data?.info ?? null;
  const equipment = data?.equipment ?? null;
  const loading = sheet?.state === 'loading';
  const name = info?.name || selection?.name || '';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy =
    onCopy && info
      ? () =>
          void onCopy(
            profileSummary(
              info,
              {
                level: t(($) => $.header.levelShort),
                combatPower: t(($) => $.header.combatPowerShort),
                itemLevel: t(($) => $.header.itemLevelShort),
              },
              fmt,
            ),
          ).then(
            () => setCopied('summary'),
            () => setCopied(null),
          )
      : undefined;
  const copyLink =
    onCopyLink && selection
      ? () =>
          void onCopyLink().then(
            () => setCopied('link'),
            () => setCopied(null),
          )
      : undefined;
  const isSaved = selection ? saved.some((c) => savedKey(c) === savedKey(selection)) : false;
  const toggleSaved = onSetSaved
    ? () => {
        setSaving(true);
        void onSetSaved(!isSaved)
          .catch(() => undefined)
          .finally(() => setSaving(false));
      }
    : undefined;
  /** Boards with open nodes: the only ones whose skill effects can raise a skill's level. */
  const openBoards = info ? info.boards.filter((b) => b.openNodes > 0) : [];
  const { loadBoard } = profile;
  // Stable per sheet and loader, so an open skill detail reads its boards again only when a
  // Refresh brings a new sheet.
  const readOpenBoards = useCallback(() => {
    for (const b of info?.boards ?? []) if (b.openNodes > 0) loadBoard(b.id);
  }, [info, loadBoard]);
  /** An open board not read yet is about to be: its bonuses are pending, not absent. */
  const boardsLoading = openBoards.some((b) => {
    const state = profile.boards[b.id]?.state;
    return state === undefined || state === 'loading';
  });

  const state = !selection
    ? null
    : loading
      ? { tone: 'live' as const, label: t(($) => $.state.loading) }
      : sheet?.state === 'error'
        ? { tone: 'warn' as const, label: t(($) => $.state.failed) }
        : data
          ? {
              tone: 'muted' as const,
              label: t(($) => $.state.updated, { time: fmt.hourMinute(data.fetchedMs) }),
            }
          : null;

  const shownTitle = titleHover.shown
    ? info?.titles.find((x) => String(x.id) === titleHover.shown?.key)
    : undefined;
  const readBoards = info
    ? info.boards
        .map((b) => ({ name: b.name, board: profile.boards[b.id]?.data ?? null }))
        .filter((b): b is { name: string; board: Board } => b.board !== null)
    : [];
  const readItems = Object.values(profile.items)
    .map((i) => i.data)
    .filter((i): i is ItemDetail => i !== null);

  const equipmentMissing = (what: string): ReactNode =>
    data?.equipmentError ? (
      <div className="p-3">
        <ErrorLine error={data.equipmentError} what={what} onRetry={profile.refresh} />
      </div>
    ) : (
      <div className="p-3">
        <EmptyState
          compact
          icon={<Icon name="info" size={16} />}
          title={t(($) => $.state.noEquipment)}
        />
      </div>
    );
  const infoMissing = (what: string): ReactNode =>
    data?.infoError ? (
      <div className="p-3">
        <ErrorLine error={data.infoError} what={what} onRetry={profile.refresh} />
      </div>
    ) : null;

  return (
    <section
      ref={root}
      // Opaque: a profile is read at length, so none of the game shows through it.
      className={overlayWindow({ glass: 'deep', className: 'bg-surface' })}
      data-glass="deep"
      aria-label={t(($) => $.window.label)}
    >
      <OverlayCaption className="h-9 cursor-move pr-1.5 pl-2.5" data-tauri-drag-region>
        <CaptionTitle
          icon={<Icon name="profile" size={13} />}
          label={t(($) => $.window.label)}
          data-tauri-drag-region
        />
        {state && (
          <CaptionState tone={state.tone} data-tauri-drag-region>
            {state.label}
          </CaptionState>
        )}
        <span className="flex items-center gap-0.5">
          {selection && (
            <WindowButton
              size="sm"
              disabled={loading}
              title={t(($) => $.actions.refreshTitle)}
              aria-label={t(($) => $.actions.refresh)}
              onClick={profile.refresh}
            >
              <Icon name="refresh" size={14} className={cn(loading && 'animate-spin')} />
            </WindowButton>
          )}
          {selection && toggleSaved && (
            <SaveToggle
              saved={isSaved}
              full={saved.length >= savedMax}
              busy={saving}
              name={name}
              onToggle={toggleSaved}
            />
          )}
          {onOpenSaved && !hideNames && (
            <SavedMenu
              saved={saved}
              max={savedMax}
              current={selection}
              container={root}
              onOpen={onOpenSaved}
            />
          )}
          {(copy || copyLink) && (
            <ShareMenu
              container={root}
              copied={copied}
              onCopyLink={copyLink}
              onCopySummary={copy}
            />
          )}
          {selection && onOpenShugo && (
            <WindowButton
              size="sm"
              title={t(($) => $.actions.shugoTitle, { name })}
              aria-label={t(($) => $.actions.shugo)}
              onClick={onOpenShugo}
            >
              <Icon name="external" size={14} />
            </WindowButton>
          )}
          <WindowButton
            size="sm"
            close
            onClick={onClose}
            title={t(($) => $.actions.closeTitle)}
            aria-label={t(($) => $.actions.close)}
          >
            <Icon name="close" size={14} />
          </WindowButton>
        </span>
        <output className="sr-only">
          {copied === 'link'
            ? t(($) => $.actions.linkCopied)
            : copied === 'summary'
              ? t(($) => $.actions.copied)
              : ''}
        </output>
      </OverlayCaption>

      <div className="@container flex min-h-0 flex-1 flex-col [text-shadow:none]">
        {!native && (
          <Notice tone="info" className="m-3 mb-0">
            {t(($) => $.window.needsDesktop)}
          </Notice>
        )}
        {windowError && (
          <Notice tone="error" className="m-3 mb-0">
            {windowError}
          </Notice>
        )}
        {onTakeFocus && selection && !hideNames && (
          <Notice tone="warn" className="m-3 mb-0">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="min-w-0 flex-1 basis-56">{t(($) => $.window.focusDenied)}</span>
              <Button size="xs" icon={<Icon name="appWindow" size={12} />} onClick={onTakeFocus}>
                {t(($) => $.window.takeFocus)}
              </Button>
            </span>
          </Notice>
        )}

        {hideNames ? (
          <EmptyState
            icon={<Icon name="lock" size={18} />}
            title={t(($) => $.window.hidden)}
            className="my-8"
          >
            {t(($) => $.window.hiddenHint)}
          </EmptyState>
        ) : !selection ? (
          native && (
            <>
              <EmptyState
                icon={<Icon name="profile" size={18} />}
                title={t(($) => $.window.empty)}
                className="my-8"
              >
                {t(($) => $.window.emptyHint)}
              </EmptyState>
              {onOpenSaved && <SavedList saved={saved} onOpen={onOpenSaved} />}
            </>
          )
        ) : !data && sheet?.state === 'error' ? (
          <SheetError
            error={sheet.error}
            onRetry={profile.retry}
            extra={
              onOpenShugo && (
                <Button size="sm" icon={<Icon name="external" size={14} />} onClick={onOpenShugo}>
                  {t(($) => $.actions.shugo)}
                </Button>
              )
            }
          />
        ) : !data ? (
          <EmptyState
            icon={<Icon name="loader" size={18} className="animate-spin" />}
            title={t(($) => $.state.loadingName, { name: selection.name })}
            className="my-8"
          >
            {t(($) => $.state.loadingHint)}
          </EmptyState>
        ) : (
          <>
            {sheet?.state === 'error' && (
              <div className="px-3 pt-2">
                <ErrorLine
                  error={sheet.error}
                  what={t(($) => $.state.refreshWhat)}
                  onRetry={profile.refresh}
                />
              </div>
            )}

            <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft px-3 pt-3 pb-2.5">
              <div className="flex min-w-56 flex-1 items-center gap-3">
                <span className="relative shrink-0">
                  <span className="block overflow-hidden rounded-leaf border border-accent-line bg-sunken">
                    <OfficialArt
                      url={info?.portrait ?? null}
                      size={60}
                      label={t(($) => $.header.portrait, { name })}
                      fallback={<span className="text-lg">{initial(name)}</span>}
                    />
                  </span>
                  {info?.className && (
                    <span className="absolute -right-1.5 -bottom-1.5 rounded-full border border-line bg-shade p-0.5">
                      <ClassIcon name={info.className} size={18} solid label={info.className} />
                    </span>
                  )}
                </span>
                <div className="min-w-0">
                  {info?.title && (
                    <p
                      className={cn(
                        'm-0 truncate text-2xs font-semibold',
                        gradeStyle(info.title.grade).ink,
                      )}
                    >
                      {info.title.name}
                    </p>
                  )}
                  <h2 className="m-0 truncate text-xl leading-tight font-semibold tracking-tight text-ink">
                    {name}
                  </h2>
                  <p className="m-0 mt-0.5 truncate text-xs text-ink-2">
                    {[
                      info?.level != null && t(($) => $.header.level, { level: info.level }),
                      info?.className,
                      info?.raceName,
                      info?.serverName,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </div>
              {info && (
                <dl className="m-0 flex shrink-0 gap-5">
                  <div className="text-right">
                    <dt className="text-3xs font-semibold tracking-caps text-ink-3 uppercase">
                      {t(($) => $.header.combatPower)}
                    </dt>
                    <dd className="m-0 text-2xl leading-none font-semibold tracking-tight text-accent figures">
                      {fmt.maybe(info.combatPower, fmt.integer)}
                    </dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-3xs font-semibold tracking-caps text-ink-3 uppercase">
                      {t(($) => $.header.itemLevel)}
                    </dt>
                    <dd className="m-0 text-2xl leading-none font-semibold tracking-tight text-ink figures">
                      {fmt.maybe(info.itemLevel, fmt.integer)}
                    </dd>
                  </div>
                </dl>
              )}
              {info && info.titles.length > 0 && (
                <ul
                  className="m-0 flex w-full list-none flex-wrap gap-1 p-0"
                  aria-label={t(($) => $.header.titles)}
                >
                  {info.titles.map((title) => (
                    <TitleChip
                      key={title.id}
                      title={title}
                      trigger={titleHover.trigger(String(title.id))}
                    />
                  ))}
                </ul>
              )}
            </header>
            {data.infoError && !info && infoMissing(t(($) => $.state.infoWhat))}

            <Tabs value={tab} onValueChange={setTab} className="min-h-0">
              <TabList<ProfileTab>
                label={t(($) => $.window.tabs)}
                className="shrink-0 overflow-x-auto px-2"
                items={TABS.map((id) => ({
                  id,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name={TAB_ICONS[id]} size={13} className="@max-[32rem]:hidden" />
                      {t(($) => $.tabs[id])}
                    </span>
                  ),
                }))}
              />
              <TabPanel value="equipment" className="flex min-h-0 flex-1 flex-col">
                {equipment ? (
                  <EquipmentTab
                    equipment={equipment}
                    details={profile.items}
                    itemKey={itemKey}
                    onLoadItem={profile.loadItem}
                  />
                ) : (
                  equipmentMissing(t(($) => $.tabs.equipment))
                )}
              </TabPanel>
              <TabPanel value="arcana" className="flex min-h-0 flex-1 flex-col">
                {equipment ? (
                  <ArcanaTab
                    equipment={equipment}
                    details={profile.items}
                    itemKey={itemKey}
                    onLoadItem={profile.loadItem}
                  />
                ) : (
                  equipmentMissing(t(($) => $.tabs.arcana))
                )}
              </TabPanel>
              <TabPanel value="skills" className="flex min-h-0 flex-1 flex-col">
                {equipment ? (
                  <SkillsTab
                    skills={equipment.skills}
                    characterLevel={info?.level ?? null}
                    boards={readBoards}
                    items={readItems}
                    boardsLoading={boardsLoading}
                    onLoadBonuses={readOpenBoards}
                  />
                ) : (
                  equipmentMissing(t(($) => $.tabs.skills))
                )}
              </TabPanel>
              <TabPanel value="daevanion" className="flex min-h-0 flex-1 flex-col">
                {info ? (
                  <DaevanionTab
                    summaries={info.boards}
                    boards={profile.boards}
                    skills={equipment?.skills ?? []}
                    onLoadBoard={profile.loadBoard}
                  />
                ) : (
                  infoMissing(t(($) => $.tabs.daevanion))
                )}
              </TabPanel>
              <TabPanel value="stats" className="flex min-h-0 flex-1 flex-col">
                {info ? (
                  <StatsTab info={info} boards={profile.boards} onLoadBoard={profile.loadBoard} />
                ) : (
                  infoMissing(t(($) => $.tabs.stats))
                )}
              </TabPanel>
              <TabPanel value="cosmetics" className="flex min-h-0 flex-1 flex-col">
                {equipment ? (
                  <CosmeticsTab skins={equipment.skins} wingSkin={equipment.wingSkin} />
                ) : (
                  equipmentMissing(t(($) => $.tabs.cosmetics))
                )}
              </TabPanel>
            </Tabs>
          </>
        )}
      </div>
      <p className="m-0 border-t border-line-soft px-3 py-1 text-3xs text-ink-4">
        {t(($) => $.window.source)}
      </p>
      <HoverCard
        id={titleHover.id}
        anchor={shownTitle ? (titleHover.shown?.anchor ?? null) : null}
        side="bottom"
      >
        {shownTitle && (
          <span className="flex max-w-64 flex-col gap-0.5 text-xs">
            <b className="font-semibold text-ink">{shownTitle.name}</b>
            <span className="text-ink-3">
              {shownTitle.category} · <GradeWord grade={shownTitle.grade} />
            </span>
            {shownTitle.equipEffects.length > 0 && (
              <span className="text-ink-2">
                {t(($) => $.stats.whileEquipped)}: {shownTitle.equipEffects.join(', ')}
              </span>
            )}
            {shownTitle.ownEffects.length > 0 && (
              <span className="text-ink-2">
                {t(($) => $.stats.whileOwned)}: {shownTitle.ownEffects.join(', ')}
              </span>
            )}
          </span>
        )}
      </HoverCard>
    </section>
  );
}
