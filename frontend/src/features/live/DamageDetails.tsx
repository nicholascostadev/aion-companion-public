import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import {
  CaptionState,
  OverlayCaption,
  overlayWindow,
  WindowButton,
} from '../../components/ui/Overlay';
import { useTranslation } from '../../i18n/provider';
import type { DetailsSelection } from '../../types/companion';
import type { InspectedReport } from '../../types/offline';
import { key, Names } from '../offline/analysis';
import { ReportView } from '../offline/report/ReportView';

interface Props {
  selection: DetailsSelection | null;
  inspected: InspectedReport;
  native: boolean;
  /** Window action failures, e.g. a failed close. */
  windowError?: string;
  /** Hides the panel; never quits the app. */
  onClose: () => void;
}

/**
 * Full native report of one fight, opened on the player whose meter row was clicked.
 * Its own borderless window: drag the caption, resize from the edges, Escape closes.
 */
export function DamageDetails({ selection, inspected, native, windowError = '', onClose }: Props) {
  const { t } = useTranslation('live');
  const { t: tr } = useTranslation('reports');
  const { report, scope, settings, loading, error, stale, following, updating, setFollowing } =
    inspected;
  const hideNames = settings?.hide_names ?? false;
  const names = useMemo(
    () => (report ? new Names(report, { hideNames, t: tr }) : null),
    [report, hideNames, tr],
  );
  const player = report?.players.find((p) => key(p.id) === selection?.player) ?? null;
  const playerName = selection
    ? player && names
      ? names.entity(player.id)
      : t(($) => $.names.playerId, { id: selection.player })
    : '';
  // Browsing other players is an explicit choice when the clicked one is missing.
  const [browse, setBrowse] = useState<number | null>(null);
  const browsing = browse !== null && browse === selection?.revision;
  const ended = report !== null && report.end_reason !== null;
  const state = !report
    ? null
    : ended
      ? { label: t(($) => $.details.ended), tone: 'muted' as const }
      : stale
        ? { label: t(($) => $.details.snapshot), tone: 'warn' as const }
        : updating
          ? { label: t(($) => $.details.live), tone: 'live' as const }
          : { label: t(($) => $.details.paused), tone: 'muted' as const };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section
      className={overlayWindow({ glass: 'deep', className: 'bg-shade/95' })}
      data-glass="deep"
      aria-label={t(($) => $.details.label)}
    >
      <OverlayCaption className="h-9 cursor-move pr-1.5 pl-2.5" data-tauri-drag-region>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-ink-3" data-tauri-drag-region>
          <Icon name="grip" size={14} />
          <span
            className="flex min-w-0 items-baseline gap-2 text-2xs font-semibold tracking-caps whitespace-nowrap text-ink-2 uppercase"
            data-tauri-drag-region
          >
            {t(($) => $.details.label)}
            {playerName && (
              <b
                className="truncate text-sm font-semibold tracking-normal text-ink normal-case"
                data-tauri-drag-region
                title={playerName}
              >
                {playerName}
              </b>
            )}
          </span>
        </span>
        {state && (
          <CaptionState tone={state.tone} data-tauri-drag-region>
            {state.label}
          </CaptionState>
        )}
        <span className="flex items-center gap-1">
          {report && !ended && !stale && (
            <Button
              size="xs"
              icon={<Icon name={following ? 'pause' : 'play'} size={12} />}
              aria-pressed={following}
              onClick={() => setFollowing(!following)}
              title={following ? t(($) => $.details.pauseTitle) : t(($) => $.details.resumeTitle)}
            >
              {following ? t(($) => $.details.pause) : t(($) => $.details.resume)}
            </Button>
          )}
          <WindowButton
            size="sm"
            close
            onClick={onClose}
            title={t(($) => $.details.closeTitle)}
            aria-label={t(($) => $.details.close)}
          >
            <Icon name="close" size={14} />
          </WindowButton>
        </span>
      </OverlayCaption>
      <div className="min-h-0 flex-1 overflow-auto px-3 pt-2.5 pb-3.5 [text-shadow:none]">
        {!native && <Notice tone="info">{t(($) => $.details.needsDesktop)}</Notice>}
        {windowError && <Notice tone="error">{windowError}</Notice>}
        {native && !selection && (
          <EmptyState
            icon={<Icon name="meter" size={18} />}
            title={t(($) => $.details.noPlayer)}
            className="my-6"
          >
            {t(($) => $.details.noPlayerHint)}
          </EmptyState>
        )}
        {selection && !report && loading && (
          <EmptyState
            icon={<Icon name="loader" size={18} className="animate-spin" />}
            title={t(($) => $.details.loading)}
            className="my-6"
          />
        )}
        {selection && !report && error && <Notice tone="error">{error}</Notice>}
        {stale && <Notice tone="warn">{t(($) => $.details.stale, { detail: stale })}</Notice>}
        {report && selection && !player && !browsing && (
          <div className="flex flex-col items-start gap-2.5">
            <Notice tone="warn">
              {t(($) => $.details.missingPlayer, { id: selection.player })}
            </Notice>
            {report.players.length > 0 && (
              <Button size="sm" onClick={() => setBrowse(selection.revision)}>
                {t(($) => $.details.browse)}
              </Button>
            )}
          </div>
        )}
        {report && selection && (player || browsing) && (
          <ReportView
            key={`${selection.revision}-${player ? 'player' : 'browse'}`}
            report={report}
            settings={settings}
            scope={scope}
            native={native}
            initialPlayer={player ? selection.player : null}
            initialTab="skills"
            // The report's own line under the title already gives the date and duration.
            title={report.label ?? t(($) => $.details.untitled)}
          />
        )}
      </div>
    </section>
  );
}
