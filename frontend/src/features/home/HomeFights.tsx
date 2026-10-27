import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { Card } from '../../components/ui/Panel';
import { Pressable } from '../../components/ui/Pressable';
import { Ticking } from '../../components/ui/Ticking';
import { clock, UNKNOWN } from '../../i18n/formatters';
import { Trans, useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { LogId, LogMeta } from '../../types/offline';
import { fightResult, fightTrends, sameDay, since, type FightTrend } from './model';

const SHOWN = 5;

/** Party DPS against the previous fight on the same boss; nothing when there is none. */
function Trend({ trend }: { trend: FightTrend | undefined }) {
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  if (!trend || trend.change === null || Math.abs(trend.change) < 0.005) return null;
  const up = trend.change > 0;
  const percent = fmt.pct(Math.round(Math.abs(trend.change) * 100) / 100, 0);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-2xs font-semibold tabular-nums',
        up ? 'text-success' : 'text-ink-3',
      )}
      title={
        up
          ? t(($) => $.home.trendUpTitle, { percent })
          : t(($) => $.home.trendDownTitle, { percent })
      }
    >
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={11} strokeWidth={2.2} />
      {percent}
      <span className="sr-only"> {up ? t(($) => $.home.trendUp) : t(($) => $.home.trendDown)}</span>
    </span>
  );
}

/** Today's fights in one line: how many, how many kills, time in combat. */
function Today({ logs, now }: { logs: LogMeta[]; now: number }) {
  const { t } = useTranslation('reports');
  const today = logs.filter((l) => l.started_ms !== null && sameDay(l.started_ms, now));
  if (!today.length) return null;
  const kills = today.filter((l) => l.end_reason === 'kill').length;
  const time = today.reduce((n, l) => n + l.duration_ms, 0);
  return (
    <p className="mt-0 mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3 tabular-nums">
      <span>
        <Trans
          t={t}
          i18nKey={($) => $.home.fightsToday}
          count={today.length}
          components={[<b key="count" className="font-semibold text-ink" />]}
        />
      </span>
      <span>
        <Trans
          t={t}
          i18nKey={($) => $.home.kills}
          count={kills}
          components={[<b key="count" className="font-semibold text-ink" />]}
        />
      </span>
      <span>
        <Trans
          t={t}
          i18nKey={($) => $.home.inCombat}
          values={{ time: clock(time) }}
          components={[<b key="time" className="font-semibold text-ink" />]}
        />
      </span>
    </p>
  );
}

/** The newest saved fights, each opening its full report in Logs. */
export function LastFights({
  logs,
  error,
  autoSave,
  onOpen,
  onOpenLogs,
  className,
}: {
  logs: LogMeta[] | null;
  error: string;
  autoSave: boolean | null;
  onOpen: (id: LogId) => void;
  onOpenLogs: () => void;
  className?: string;
}) {
  const { t } = useTranslation('reports');
  const { t: th } = useTranslation('home');
  const fmt = useFormat();
  const trends = fightTrends(logs ?? []);
  const shown = (logs ?? []).slice(0, SHOWN);
  return (
    <Card
      title={t(($) => $.home.title)}
      className={cn('mb-0', className)}
      actions={
        <Button variant="link" size="sm" onClick={onOpenLogs}>
          {t(($) => $.home.allLogs)} <Icon name="arrowRight" size={13} />
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {logs === null ? (
        !error && (
          <p className="m-0 py-6 text-center text-sm text-ink-3">{t(($) => $.home.reading)}</p>
        )
      ) : !shown.length ? (
        <EmptyState
          compact
          icon={<Icon name="combatPower" size={18} />}
          title={t(($) => $.home.emptyTitle)}
        >
          {autoSave === false ? t(($) => $.home.emptyOff) : t(($) => $.home.emptyOn)}
        </EmptyState>
      ) : (
        <Ticking every={30_000}>
          {(now) => (
            <>
              <Today logs={logs} now={now} />
              <ul
                className="-mx-2 m-0 flex list-none flex-col gap-0.5 p-0"
                aria-label={t(($) => $.home.recent)}
              >
                {shown.map((log) => {
                  const result = fightResult(log.end_reason, th);
                  const trend = trends.get(log.id);
                  const name = log.label ?? log.boss ?? t(($) => $.library.encounter);
                  const players = log.players ?? log.player_names.length;
                  const meta = [
                    log.started_ms !== null
                      ? since(log.started_ms, now, th)
                      : t(($) => $.home.unknownTime),
                    clock(log.duration_ms),
                    ...(players ? [t(($) => $.library.players, { count: players })] : []),
                    ...(log.boss && log.boss !== name ? [log.boss] : []),
                  ].join(' · ');
                  return (
                    <li key={log.id}>
                      <Pressable
                        className="group grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-lg px-2 py-2 hover:bg-row-hover"
                        aria-label={t(($) => $.home.open, { name })}
                        onClick={() => onOpen(log.id)}
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex min-w-0 items-center gap-2">
                            {/* A long label takes a second line before it is cut. */}
                            <b
                              className="line-clamp-2 min-w-0 text-sm font-semibold break-words text-ink"
                              title={name}
                            >
                              {name}
                            </b>
                            <Badge shape="tag" tone={result.tone} variant="outline">
                              {result.label}
                            </Badge>
                            {trend?.best && (
                              <Badge
                                shape="tag"
                                tone="accent"
                                icon={<Icon name="trophy" size={10} />}
                                title={t(($) => $.home.bestTitle)}
                              >
                                {t(($) => $.home.best)}
                              </Badge>
                            )}
                          </span>
                          <small className="truncate text-xs text-ink-3 tabular-nums" title={meta}>
                            {meta}
                          </small>
                        </span>
                        <span className="flex flex-col items-end gap-0.5">
                          <span className="text-md font-semibold text-ink tabular-nums">
                            {log.dps === null ? UNKNOWN : fmt.compact.format(log.dps)}
                            <span className="ml-1 text-2xs font-medium text-ink-3">DPS</span>
                          </span>
                          <Trend trend={trend} />
                        </span>
                        <Icon
                          name="chevronRight"
                          size={14}
                          className="text-ink-4 transition-[translate,color] duration-150 ease-grow group-hover:translate-x-0.5 group-hover:text-ink-2"
                        />
                      </Pressable>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Ticking>
      )}
    </Card>
  );
}
