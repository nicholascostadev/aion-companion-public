import type { ReactNode } from 'react';
import { Badge, type Tone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { BarList, Meter, Stat, StatStrip, Swatch } from '../../components/ui/Data';
import { Disclosure } from '../../components/ui/Disclosure';
import { Checkbox } from '../../components/ui/Field';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { Card } from '../../components/ui/Panel';
import { DataTable } from '../../components/ui/Table';
import { clock, UNKNOWN } from '../../i18n/formatters';
import { useFormat, useTranslation } from '../../i18n/provider';
import { captureState } from '../../lib/capture';
import { classColor } from '../../lib/classColors';
import type { LiveStatus } from '../../types/companion';
import { playerDisplay } from './playerName';

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
}: Props) {
  const { t } = useTranslation('live');
  const { t: tc } = useTranslation('common');
  const fmt = useFormat();
  const state = native ? captureState(status) : null;
  const total = status.players.reduce((sum, player) => sum + player.damage, 0);
  const names = new Map(status.players.map((player) => [player.entity, playerDisplay(player, t)]));
  const classes = new Map(status.players.map((player) => [player.entity, player.class ?? null]));
  const colorOf = (entity: number) => classColor(classes.get(entity));
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
        {/* The meter always counts only you and your party; native ignores other players. */}
        <Checkbox
          label={t(($) => $.meter.autoEnd)}
          checked={status.auto_end ?? true}
          disabled={!native || busy}
          onCheckedChange={(checked) => onConfigure(checked, true)}
        />
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          icon={<Icon name="save" size={13} />}
          disabled={!native || busy || (status.events === 0 && !status.history?.length)}
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
        <Stat label={t(($) => $.meter.encounter)} value={status.encounter ?? 1} />
        <Stat label={t(($) => $.meter.duration)} value={clock(status.duration_ms)} />
        <Stat label={t(($) => $.meter.totalDamage)} value={fmt.number.format(total)} />
        <Stat label={t(($) => $.meter.damageEvents)} value={fmt.number.format(status.events)} />
      </StatStrip>
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
        rows={status.players.map((player) => ({
          key: String(player.entity),
          cells: [
            <span
              className="inline-flex items-center gap-2 font-semibold text-ink"
              key="actor"
              title={names.get(player.entity)?.title}
            >
              <Swatch color={colorOf(player.entity)} />
              {names.get(player.entity)?.text}
            </span>,
            fmt.number.format(player.damage),
            fmt.number.format(player.dps),
            <span className="inline-flex items-center justify-end gap-2.5" key="share">
              <Meter
                fraction={player.share}
                color={colorOf(player.entity)}
                label={t(($) => $.meter.playerShare, {
                  name: names.get(player.entity)?.text ?? t(($) => $.meter.player),
                })}
                className="w-20 flex-none"
              />
              <span className="w-12">{fmt.pct(player.share, 1)}</span>
            </span>,
            player.direct_hits > 0
              ? fmt.pct(player.critical_hits / player.direct_hits, 1)
              : UNKNOWN,
          ],
        }))}
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
      {(status.history?.length ?? 0) > 0 && (
        <Disclosure
          summary={t(($) => $.meter.completed, {
            total: fmt.integer.format(status.history?.length ?? 0),
          })}
        >
          <div className="mb-2.5 flex flex-wrap gap-2">
            {status.history?.map((fight) => (
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
          {status.players.map((player) => {
            const skills = Object.entries(player.skills).sort((a, b) => b[1] - a[1]);
            const top = Math.max(1, skills[0]?.[1] ?? 0);
            return (
              <div key={player.entity} className="min-w-0">
                <h3
                  className="mb-2 flex items-center gap-2 text-sm"
                  title={names.get(player.entity)?.title}
                >
                  <Swatch color={colorOf(player.entity)} />
                  {names.get(player.entity)?.text}
                </h3>
                <BarList
                  className="text-xs"
                  rows={skills.map(([skill, damage]) => ({
                    key: skill,
                    label: skill,
                    fraction: damage / top,
                    color: colorOf(player.entity),
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
