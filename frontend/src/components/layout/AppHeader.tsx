import type { ReactNode } from 'react';
import { Trans, useTranslation } from '../../i18n/provider';
import { DEFAULT_HOTKEYS } from '../../lib/offlineNormalize';
import type { AppBuildInfo } from '../../types/buildInfo';
import type { OfflineHotkeys } from '../../types/offline';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { BrandMark, Icon } from '../ui/Icon';

interface AppHeaderProps {
  native: boolean;
  buildInfo?: AppBuildInfo | null;
  /** The DPS meter's state, for the click-through badge. */
  dps: { visible: boolean; known: boolean; locked: boolean };
  onQuit: () => void;
  hotkeys?: OfflineHotkeys;
  /** App update pill, shown beside the brand while a release is waiting. */
  update?: ReactNode;
}

/** Collapses to visually hidden (still announced) below the given width. */
const collapse = {
  mid: 'max-[1020px]:sr-only',
  narrow: 'max-[900px]:sr-only',
};

/**
 * Single-row fixed workspace bar: brand, a waiting app update, overlay hotkeys and Quit.
 * Window visibility lives on Home and the in-game menu bar.
 */
export function AppHeader({
  native,
  buildInfo: build = null,
  dps,
  onQuit,
  hotkeys = DEFAULT_HOTKEYS,
  update,
}: AppHeaderProps) {
  const { t } = useTranslation('workspace');
  const previewDev = !native && import.meta.env.DEV;
  const development = native ? build?.channel === 'development' : previewDev;
  const buildHint =
    native && build
      ? t(($) => $.header.build, {
          branch: build.branch || t(($) => $.header.branchUnknown),
          revision: build.revision?.slice(0, 7) || t(($) => $.header.revisionUnknown),
          reload: build.live_reload ? t(($) => $.header.liveReload) : t(($) => $.header.standalone),
        })
      : t(($) => $.header.preview);
  const hotkeyHint = [
    hotkeys.toggle_overlay && t(($) => $.header.hotkeyToggle, { key: hotkeys.toggle_overlay }),
    t(($) => $.header.hotkeyLock, { key: hotkeys.toggle_lock }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <header className="sticky top-0 z-20 h-header border-b border-line-soft bg-veil backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-workspace items-center justify-between gap-3 px-7 max-[720px]:px-4">
        <div className="flex flex-none items-center gap-3">
          <div
            className="flex flex-none items-center gap-2.5"
            title={t(($) => $.header.brandTitle)}
          >
            <span className="grid size-7 place-items-center rounded-leaf border border-accent-line bg-accent-soft text-accent shadow-glow">
              <BrandMark size={15} />
            </span>
            <span
              className={`flex items-baseline gap-1.5 leading-none whitespace-nowrap ${collapse.narrow}`}
            >
              <span className="text-2xs font-semibold tracking-[0.22em] text-ink-3">AION</span>
              <b className="text-md font-semibold tracking-tight text-ink">Companion</b>
            </span>
            {development && (
              <Badge tone="accent" variant="outline" shape="tag" title={buildHint}>
                {t(($) => $.header.dev)}
              </Badge>
            )}
          </div>
          {update}
        </div>
        <div className="flex min-w-0 flex-nowrap items-center gap-2">
          {/* Gives way first when the row is full (longer languages, the lock badge): Quit
              never leaves the window; the title still names both hotkeys. */}
          <span
            className={`mr-0.5 inline-flex min-w-0 items-center gap-1.5 overflow-hidden border-r border-line pr-3 text-xs leading-none whitespace-nowrap text-ink-3 ${collapse.mid}`}
            aria-label={t(($) => $.header.hotkeys)}
            title={hotkeyHint}
          >
            {hotkeys.toggle_overlay && (
              <>
                <Trans
                  t={t}
                  i18nKey={($) => $.header.showHide}
                  values={{ key: hotkeys.toggle_overlay }}
                  components={[<kbd key="key" />]}
                />
                <span className="mx-0.5 opacity-60" aria-hidden="true">
                  ·
                </span>
              </>
            )}
            <Trans
              t={t}
              i18nKey={($) => $.header.lock}
              values={{ key: hotkeys.toggle_lock }}
              components={[<kbd key="key" />]}
            />
          </span>
          {dps.known && dps.visible && dps.locked && (
            <Badge
              tone="warn"
              variant="outline"
              icon={<Icon name="lock" size={12} />}
              title={t(($) => $.header.clickThroughTitle)}
            >
              <span className={collapse.mid}>{t(($) => $.header.clickThrough)}</span>
            </Badge>
          )}
          <Button
            size="sm"
            variant="danger"
            disabled={!native}
            aria-label={t(($) => $.header.quitTitle)}
            title={t(($) => $.header.quitTitle)}
            icon={<Icon name="power" size={14} />}
            onClick={onQuit}
          >
            <span className={collapse.mid}>{t(($) => $.header.quit)}</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
