import type { ReactNode } from 'react';
import { Badge, type Tone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { BarList, Meter, Stat, StatStrip, Swatch } from '../../components/ui/Data';
import { Disclosure } from '../../components/ui/Disclosure';
import { Checkbox } from '../../components/ui/Field';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { ClassIcon } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { Card } from '../../components/ui/Panel';
import { DataTable } from '../../components/ui/Table';
import { clock, UNKNOWN } from '../../i18n/formatters';
import { useFormat, useTranslation } from '../../i18n/provider';
import { captureState } from '../../lib/capture';
import { playerRows } from '../../lib/playerRow';
import type { LiveStatus } from '../../types/companion';
import type { LastDeath } from '../../types/offline';
import { deathShortcut } from './lastDeath';
import { liveWords } from './playerName';
import { ProfileLink, type OpenProfile } from './ProfileLink';

interface Props {
  status: LiveStatus;
  native: boolean;
  busy: boolean;
  error: string;
  onReset: () => void;
  onReplay: (id?: number) => void;
  onConfigure: (autoEnd: boolean, partyOnly: boolean) => void;
  onComparison: () => void;
  comparisonPath: string;
  /** Opens a character in the in-game profile window; omit (native only, names shown) to show no links. */
  onOpenProfile?: OpenProfile | undefined;
  /** Your latest death this session, from the offline status; omit while names are hidden. */
  lastDeath?: LastDeath | null | undefined;
  /**
   * The reader's Hide character names setting: rows then show "You" or class and rank, and
   * your own class colour stays neutral, as on the DPS meter.
   */
  hideNames?: boolean | undefined;
}

const STATE_TONES: Partial<Record<ReturnType<typeof captureState>, Tone>> = {
  capturing: 'accent',
  error: 'danger',
};

/** A quiet line of capture facts. */
function Fine({ children }: { children: ReactNode }) {
  return <p className="m-0 text-xs leading-snug text-ink-3">{children}</p>;
}

export function LiveMeter({
  status,
  native,
  busy,
  error,
  onReset,
  onReplay,
  onConfigure,
  onComparison,
  comparisonPath,
  onOpenProfile,
  lastDeath,
  hideNames = false,
}: Props) {
  const { t } = useTranslation('live');
  const { t: tc } = useTranslation('common');
  const fmt = useFormat();
  const state = native ? captureState(status) : null;
  const total = status.players.reduce((sum, player) => sum + player.damage, 0);
  // Each player's row: name or hidden label, title, class colour and profile.
  const players = playerRows(
    { kind: 'live', players: status.players, words: liveWords(t) },
    hideNames,
  );
  const death = deathShortcut(lastDeath);
  const count = (value: number | null | undefined) => fmt.integer.format(value ?? 0);
  const tenths = fmt.numberWith({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
  // Until native reports, the placeholder status has no message of its own.
  const message =
    error ||
    status.message ||
    (captureState(status) === 'connecting' ? tc(($) => $.capture.hint.connecting) : '');
  return (
    <Card
      title={t(($) => $.meter.title)}
      subtitle={t(($) => $.meter.subtitle)}
      actions={
        <Badge
          tone={(state && STATE_TONES[state]) ?? 'neutral'}
          dot={state === 'capturing' ? 'live' : true}
        >
          {state ? tc(($) => $.capture.label[state]) : t(($) => $.meter.preview)}
        </Badge>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={<Icon name="reset" size={13} />}
            disabled={!native || busy || status.events === 0}
            onClick={onReset}
          >
            {t(($) => $.meter.reset)}
          </Button>
          <Button
            size="sm"
            icon={<Icon name="play" size={13} />}
            disabled={
              !native || busy || (status.running && !status.encounter_ended) || status.events === 0
            }
            onClick={() => onReplay()}
          >
            {t(($) => $.meter.openRecording)}
          </Button>
        </span>
        <span className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Checkbox
            label={t(($) => $.meter.autoEnd)}
            checked={status.auto_end}
            disabled={!native || busy}
            onCheckedChange={(checked) => onConfigure(checked, status.party_only)}
          />
          <Checkbox
            label={t(($) => $.meter.partyOnly)}
            checked={status.party_only}
            disabled={
              !native || busy || (!status.party_only && !status.roster_seen && !status.local_known)
            }
            onCheckedChange={(checked) => onConfigure(status.auto_end, checked)}
          />
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          icon={<Icon name="save" size={13} />}
          disabled={!native || busy || (status.events === 0 && !status.history.length)}
          onClick={onComparison}
        >
          {t(($) => $.meter.saveComparison)}
        </Button>
      </div>
      <output
        className="mb-4 block text-left text-sm text-ink-2"
        aria-label={t(($) => $.meter.status)}
      >
        {message}
      </output>
      <StatStrip variant="open" columns={4} className="mb-5">
        <Stat label={t(($) => $.meter.encounter)} value={status.encounter} />
        <Stat label={t(($) => $.meter.duration)} value={clock(status.duration_ms)} />
        <Stat label={t(($) => $.meter.totalDamage)} value={fmt.number.format(total)} />
        <Stat label={t(($) => $.meter.damageEvents)} value={fmt.number.format(status.events)} />
      </StatStrip>
      {death && (
        // Who landed the last hit before your latest death; never called the killer.
        <p
          className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2"
          title={t(($) => $.overlay.lastDeath.title, {
            name: death.name,
            time: fmt.hourMinute(death.at),
          })}
        >
          <Icon name="death" size={14} className="text-danger" />
          <span className="text-ink-3">
            {t(($) => $.overlay.lastDeath.label)} · {fmt.hourMinute(death.at)} ·{' '}
            {t(($) => $.overlay.lastDeath.lastHit)}
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <ClassIcon name={death.class} size={16} solid />
            {death.name}
          </span>
          {onOpenProfile && death.profile && (
            <ProfileLink
              profile={death.profile}
              label={t(($) => $.profile.open, { name: death.name })}
              onOpen={onOpenProfile}
              size="2xs"
            />
          )}
        </p>
      )}
      {comparisonPath && (
        <Notice tone="good">{t(($) => $.meter.comparisonSaved, { path: comparisonPath })}</Notice>
      )}
      <DataTable
        headings={[
          t(($) => $.meter.columns.actor),
          t(($) => $.meter.columns.damage),
          t(($) => $.meter.columns.avgDps),
          t(($) => $.meter.columns.share),
          t(($) => $.meter.columns.critRate),
        ]}
        rows={status.players.map((player, index) => {
          const row = players[index]!;
          const { name } = row;
          return {
            key: String(player.entity),
            cells: [
              <span className="inline-flex items-center gap-2 font-semibold text-ink" key="actor">
                <Swatch color={row.color} />
                <span title={row.title}>{name}</span>
                {onOpenProfile && row.profile && (
                  <ProfileLink
                    profile={row.profile}
                    label={t(($) => $.profile.open, { name })}
                    onOpen={onOpenProfile}
                    size="2xs"
                  />
                )}
              </span>,
              fmt.number.format(player.damage),
              fmt.number.format(player.dps),
              <span className="inline-flex items-center justify-end gap-2.5" key="share">
                <Meter
                  fraction={player.share}
                  color={row.color}
                  label={t(($) => $.meter.playerShare, { name })}
                  className="w-20 flex-none"
                />
                <span className="w-12">{fmt.pct(player.share, 1)}</span>
              </span>,
              player.direct_hits > 0
                ? fmt.pct(player.critical_hits / player.direct_hits, 1)
                : UNKNOWN,
            ],
          };
        })}
      />
      {status.players.length === 0 && (
        <EmptyState
          compact
          live={state === 'capturing'}
          title={t(($) => $.meter.empty)}
          icon={<Icon name="hourglass" size={18} />}
        />
      )}
      <p className="mt-4 mb-1 max-w-4xl text-xs leading-snug text-ink-3">
        {t(($) => $.meter.about)}{' '}
        {status.encounter_ended
          ? t(($) => $.meter.encounterEnded)
          : t(($) => $.meter.resetArchives)}
      </p>
      {status.history.length > 0 && (
        <Disclosure
          summary={t(($) => $.meter.completed, {
            total: fmt.integer.format(status.history.length),
          })}
        >
          <div className="mb-2.5 flex flex-wrap gap-2">
            {status.history.map((fight) => (
              <Button
                key={fight.id}
                size="xs"
                disabled={!native || busy}
                icon={<Icon name="play" size={11} />}
                onClick={() => onReplay(fight.id)}
              >
                {t(($) => $.meter.replay, {
                  id: fight.id,
                  seconds: tenths.format(fight.duration_ms / 1000),
                })}
              </Button>
            ))}
          </div>
          <Fine>{t(($) => $.meter.retained)}</Fine>
        </Disclosure>
      )}
      <Disclosure summary={t(($) => $.meter.breakdown)} bodyClassName="flex flex-col gap-2">
        <div className="mb-3 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-8 gap-y-5">
          {status.players.map((player, index) => {
            const row = players[index]!;
            const skills = Object.entries(player.skills).sort((a, b) => b[1] - a[1]);
            const top = Math.max(1, skills[0]?.[1] ?? 0);
            return (
              <div key={player.entity} className="min-w-0">
                <h3 className="mb-2 flex items-center gap-2 text-sm" title={row.title}>
                  <Swatch color={row.color} />
                  {row.name}
                </h3>
                <BarList
                  className="text-xs"
                  rows={skills.map(([skill, damage]) => ({
                    key: skill,
                    label: skill,
                    fraction: damage / top,
                    color: row.color,
                    meterLabel: t(($) => $.meter.skillDamage, { skill }),
                    value: fmt.compact.format(damage),
                  }))}
                />
              </div>
            );
          })}
        </div>
        <Fine>
          {t(($) => $.meter.identity, {
            names: count(status.named_entities),
            members: count(status.party_members),
            labels: count(status.skill_labels),
          })}
        </Fine>
        <Fine>
          {t(($) => $.meter.traffic, {
            adapters: count(status.stats.adapters),
            packets: fmt.number.format(status.stats.packets ?? 0),
            frames: fmt.number.format(status.stats.frames ?? 0),
            bundles: fmt.number.format(status.stats.bundles ?? 0),
          })}
        </Fine>
        <Fine>
          {t(($) => $.meter.integrity, {
            gaps: count(status.stats.gaps),
            dropped: count(status.stats.dropped),
            rejected: count(status.stats.rejected),
            desyncs: count(status.stats.desyncs),
          })}
        </Fine>
        <Fine>{t(($) => $.meter.rules)}</Fine>
      </Disclosure>
    </Card>
  );
}
