import { useEffect, useState, type RefObject } from 'react';
import { Icon } from '../../components/ui/Icon';
import { MenuPopup, MenuRadioGroup, MenuRadioItem } from '../../components/ui/Menu';
import { clock } from '../../i18n/formatters';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { CombatReport, LogId, LogMeta } from '../../types/offline';

/** This app's own local fight library, as the meter uses it. */
export interface MeterLibrary {
  /** Most recent saved fights, newest first. */
  list: () => Promise<LogMeta[]>;
  /**
   * One saved fight as the meter shows it, natively aggregated against every target, or
   * with `bossOnly` against its bosses and training dummies (every target if it met none).
   */
  read: (id: LogId, bossOnly: boolean) => Promise<CombatReport>;
}

export interface PinnedFight {
  report: CombatReport | null;
  loading: boolean;
  error: string;
}

/**
 * Loads the saved fight pinned in the meter in the chosen target scope, read again when the
 * scope changes. A report for another fight or scope (an earlier pick answering late, or
 * native returning a different id) is never shown in its place.
 */
export function usePinnedFight(
  library: MeterLibrary | null,
  id: LogId | null,
  bossOnly: boolean,
): PinnedFight {
  const request = id ? `${id}|${bossOnly ? 'boss' : 'all'}` : '';
  const { t } = useTranslation('live');
  // Failures are kept as facts and worded on render, so they follow a language change.
  const [state, setState] = useState({
    request: '',
    report: null as CombatReport | null,
    error: null as { mismatch: true } | { mismatch: false; detail: string } | null,
  });
  useEffect(() => {
    if (!library || !id) return;
    let cancelled = false;
    library.read(id, bossOnly).then(
      (report) => {
        if (cancelled) return;
        if (report.id !== null && report.id !== id)
          setState({ request, report: null, error: { mismatch: true } });
        else setState({ request, report, error: null });
      },
      (cause: unknown) => {
        if (!cancelled)
          setState({ request, report: null, error: { mismatch: false, detail: String(cause) } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [library, id, bossOnly, request]);
  const current = request !== '' && state.request === request;
  const error = current ? state.error : null;
  return {
    report: current ? state.report : null,
    loading: request !== '' && !current,
    error: !error ? '' : error.mismatch ? t(($) => $.history.nativeMismatch) : error.detail,
  };
}

/** One choice in the menu: a name over its time, lit with the accent when chosen. */
const item = cn(
  'grid min-h-[22px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5',
  'rounded-md px-1.5 py-0.5 text-2xs leading-snug text-ink',
);
/** The radio value of the current (live) fight; a saved fight is its log id. */
const LIVE = '';
const note = 'm-0 px-1.5 py-1 text-3xs text-ink-3';

/**
 * Drop-down of the current fight and recent saved fights: the popup of a `Menu` whose
 * trigger is the meter's History button. It hangs from the right of the toolbar
 * (`anchor`), mounted inside the meter (`container`) so it keeps the meter's zoom and
 * its items stay clickable on a locked meter. The fights are read each time it opens.
 */
export function HistoryMenu({
  container,
  anchor,
  ...list
}: HistoryListProps & {
  container: RefObject<HTMLElement | null>;
  anchor: RefObject<Element | null>;
}) {
  const { t } = useTranslation('live');
  return (
    <MenuPopup
      container={container}
      anchor={anchor}
      alignOffset={6}
      className="max-h-42 w-[min(230px,calc(100vw-16px))]"
      aria-label={t(($) => $.history.label)}
      data-hit-clip
    >
      <HistoryList {...list} />
    </MenuPopup>
  );
}

interface HistoryListProps {
  library: MeterLibrary;
  pinned: LogId | null;
  onPick: (id: LogId) => void;
  onLive: () => void;
}

/** The choices of an open history menu; mounted only while it is open. */
function HistoryList({ library, pinned, onPick, onLive }: HistoryListProps) {
  const { t } = useTranslation('live');
  const fmt = useFormat();
  const fightName = (log: LogMeta) => log.label ?? log.boss ?? t(($) => $.history.fight);
  const [state, setState] = useState<{ logs: LogMeta[] | null; error: string }>({
    logs: null,
    error: '',
  });
  useEffect(() => {
    let cancelled = false;
    library.list().then(
      (logs) => {
        if (!cancelled) setState({ logs, error: '' });
      },
      (cause: unknown) => {
        if (!cancelled) setState({ logs: [], error: String(cause) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [library]);
  return (
    <MenuRadioGroup
      value={pinned ?? LIVE}
      onValueChange={(value: LogId) => (value === LIVE ? onLive() : onPick(value))}
    >
      <MenuRadioItem value={LIVE} data-hit className={item}>
        <Icon name="live" size={12} />
        <span className="col-start-2 truncate font-semibold">{t(($) => $.history.current)}</span>
        <small className="text-3xs text-ink-3">{t(($) => $.history.live)}</small>
      </MenuRadioItem>
      {state.logs === null && <p className={note}>{t(($) => $.history.loading)}</p>}
      {state.error && <p className={cn(note, 'text-danger')}>{state.error}</p>}
      {state.logs?.length === 0 && !state.error && (
        <p className={note}>{t(($) => $.history.empty)}</p>
      )}
      {state.logs?.map((log) => (
        <MenuRadioItem
          key={log.id}
          value={log.id}
          data-hit
          className={item}
          title={`${fightName(log)} · ${clock(log.duration_ms)}`}
        >
          <span className="col-span-2 truncate font-semibold">{fightName(log)}</span>
          <small className="text-3xs text-ink-3 tabular-nums">
            {fmt.hourMinute(log.started_ms)} · {clock(log.duration_ms)}
          </small>
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  );
}
