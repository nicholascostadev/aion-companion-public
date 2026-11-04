import { useState, type MouseEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { HoverPopover, useHoverPopover } from '../../components/ui/HoverPopover';
import { Icon } from '../../components/ui/Icon';
import { Pressable } from '../../components/ui/Pressable';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import { statArt } from '../../lib/statArt';
import type { Board, CharacterInfo, Lazy, Stat } from '../../types/profile';
import { gradeStyle, splitDeity } from './model';
import { GradeWord, SectionTitle, Unavailable, initial } from './parts';

type View = 'text' | 'picture';

function StatRow({ stat }: { stat: Stat }) {
  const { stat: name, deity } = splitDeity(stat.name);
  return (
    <li className="border-t border-line-soft py-1.5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink">
          {name}
          {deity && <span className="ml-1.5 text-2xs text-ink-3">{deity}</span>}
        </span>
        <span className="text-md font-semibold text-ink figures">{stat.value}</span>
      </div>
      {stat.effects.length > 0 && (
        <ul className="m-0 mt-0.5 list-none p-0 text-2xs text-ink-3">
          {stat.effects.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Where the game draws each stat, in degrees clockwise from the top: the six base stats
 * around the compass in its centre, the ten divine stats on the outer ring, five on each
 * side, the top and bottom of the ring left open.
 */
const BASE_AT: Record<string, number> = { STR: 0, DEX: 60, AGI: 120, WIS: 180, INT: 240, CON: 300 };
const DIVINE_AT: Record<string, number> = {
  Destruction: 30,
  Death: 60,
  Wisdom: 90,
  Destiny: 120,
  Space: 150,
  Time: 210,
  Life: 240,
  Illusion: 270,
  Freedom: 300,
  Justice: 330,
};

/** A point `r` (percent of the figure) from its centre, `deg` clockwise from the top. */
const at = (deg: number, r: number) => {
  const angle = (deg * Math.PI) / 180;
  return { x: 50 + Math.sin(angle) * r, y: 50 - Math.cos(angle) * r };
};

/** The figure's rings, spokes and compass star: decoration only, every value is text. */
function WheelFrame() {
  const spoke = (deg: number, from: number, to: number, strong: boolean) => {
    const a = at(deg, from);
    const b = at(deg, to);
    return (
      <line
        key={`${deg}-${from}`}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        className={strong ? 'stroke-line' : 'stroke-line-soft'}
        strokeWidth="0.3"
      />
    );
  };
  const star = (long: number, short: number, turn: number) =>
    Array.from({ length: 8 }, (_, i) => {
      const p = at(turn + i * 45, i % 2 ? short : long);
      return `${p.x},${p.y}`;
    }).join(' ');
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden="true">
      <circle cx="50" cy="50" r="49.5" className="fill-surface-2 stroke-line" strokeWidth="0.4" />
      <circle cx="50" cy="50" r="47.6" className="fill-none stroke-line-soft" strokeWidth="0.3" />
      <circle cx="50" cy="50" r="34.4" className="fill-sunken stroke-line" strokeWidth="0.4" />
      <circle cx="50" cy="50" r="33" className="fill-none stroke-accent-line" strokeWidth="0.25" />
      <circle cx="50" cy="50" r="11" className="fill-none stroke-line-soft" strokeWidth="0.3" />
      {/* The open top and bottom of the ring, each held by a pillar and a diamond. */}
      {[0, 180].map((deg) => {
        const c = at(deg, 41);
        return (
          <g key={deg}>
            {spoke(deg, 34.4, 38, true)}
            {spoke(deg, 44, 49.5, true)}
            <rect
              x={c.x - 2}
              y={c.y - 2}
              width="4"
              height="4"
              transform={`rotate(45 ${c.x} ${c.y})`}
              className="fill-surface-3 stroke-accent-line"
              strokeWidth="0.35"
            />
          </g>
        );
      })}
      {Array.from({ length: 12 }, (_, i) => spoke(i * 30, 4, 32, i % 2 === 0))}
      <circle cx="50" cy="50" r="5" className="fill-accent-soft" />
      <polygon points={star(4.5, 0.9, 45)} className="fill-accent-line" />
      <polygon points={star(7.5, 1.1, 0)} className="fill-accent" />
      <circle cx="50" cy="50" r="0.9" className="fill-accent-strong" />
    </svg>
  );
}

/**
 * The stat sheet as the game draws it: the ten divine stats with their original emblems
 * on the outer ring, the six base stats around a compass in its centre. Every value is
 * printed and every stat is focusable, its secondary effects shown on hover or focus; a
 * stat the service did not list keeps its place, marked, never shown as 0.
 */
function StatWheel({ base, divine }: { base: Stat[]; divine: Stat[] }) {
  const { t } = useTranslation('profile');
  const hover = useHoverPopover();
  const byType = new Map([...base, ...divine].map((s) => [s.type, s]));
  // Divine stats this layout has no place for are still listed, under the figure.
  const unplaced = divine.filter((s) => !Object.hasOwn(DIVINE_AT, s.type));
  const name = (type: string) => {
    const stat = byType.get(type);
    return stat
      ? splitDeity(stat.name).stat
      : t(($) => $.stats.names[type as keyof typeof $.stats.names]);
  };
  const label = (type: string) => {
    const stat = byType.get(type);
    return stat
      ? t(($) => $.stats.statLabel, { name: stat.name, value: stat.value })
      : t(($) => $.stats.statMissing, { name: name(type) });
  };
  const shown = hover.shown ? hover.shown.key : null;
  const shownStat = shown ? byType.get(shown) : undefined;

  const trigger = (type: string) => ({
    ...hover.trigger(type),
    'aria-label': label(type),
    // Touch never hovers: a tap shows the same details.
    onClick: (event: MouseEvent<HTMLButtonElement>) =>
      hover.show(type, event.currentTarget, { immediate: true }),
  });

  return (
    <>
      <figure
        className="m-0 mx-auto aspect-square w-full max-w-[26rem] @container"
        aria-label={t(($) => $.stats.wheelLabel)}
      >
        <div className="relative size-full">
          <WheelFrame />
          {Object.entries(DIVINE_AT).map(([type, deg]) => {
            const p = at(deg, 42);
            const stat = byType.get(type);
            return (
              <Pressable
                key={type}
                {...trigger(type)}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full p-0.5 hover:bg-surface-hover"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <span className="relative block">
                  <StatEmblem type={type} name={name(type)} dim={!stat} className="size-[10cqi]" />
                  <span className="absolute -right-2 -bottom-1 text-xs font-semibold text-ink figures @min-[22rem]:text-sm">
                    {stat ? stat.value : '–'}
                  </span>
                </span>
              </Pressable>
            );
          })}
          {Object.entries(BASE_AT).map(([type, deg]) => {
            const p = at(deg, 21.5);
            const stat = byType.get(type);
            return (
              <Pressable
                key={type}
                {...trigger(type)}
                className="absolute flex w-[22%] -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-md px-0.5 py-0.5 text-center leading-tight hover:bg-surface-hover"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <StatEmblem type={type} name={name(type)} dim={!stat} className="size-[7.5cqi]" />
                <span className="mt-0.5 max-w-full truncate text-2xs font-semibold text-accent @min-[22rem]:text-xs">
                  {name(type)}
                </span>
                <span className="text-xs text-ink-2 figures @min-[22rem]:text-sm">
                  {stat ? stat.value : '–'}
                </span>
              </Pressable>
            );
          })}
        </div>
      </figure>
      {unplaced.length > 0 && (
        <ul className="m-0 mx-auto w-full max-w-[26rem] list-none p-0">
          {unplaced.map((s) => (
            <StatRow key={s.type} stat={s} />
          ))}
        </ul>
      )}
      <HoverPopover
        popover={hover.popover}
        label={t(($) => $.stats.detailLabel, { name: shown ? name(shown) : '' })}
      >
        {shown && <StatDetail type={shown} stat={shownStat} name={name(shown)} />}
      </HoverPopover>
    </>
  );
}

/** A stat's original emblem; a stat without one keeps only its written name beside it. */
function StatEmblem({
  type,
  name,
  dim,
  className,
}: {
  type: string;
  name: string;
  dim: boolean;
  /** Its size. */
  className: string;
}) {
  const src = statArt(type);
  if (!src)
    return (
      <span
        aria-hidden="true"
        className={cn(
          'grid place-items-center rounded-full border border-line text-2xs font-semibold text-ink-3',
          className,
        )}
      >
        {initial(name)}
      </span>
    );
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      className={cn(
        'pointer-events-none block object-contain select-none',
        className,
        dim && 'opacity-35',
      )}
    />
  );
}

/** What hovering or focusing one stat shows: its full name, value and secondary effects. */
function StatDetail({ type, stat, name }: { type: string; stat: Stat | undefined; name: string }) {
  const { t } = useTranslation('profile');
  const deity = stat ? splitDeity(stat.name).deity : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <StatEmblem type={type} name={name} dim={!stat} className="size-8 shrink-0" />
        <p className="m-0 min-w-0 flex-1 text-sm font-semibold text-ink">
          {name}
          {deity && <span className="ml-1.5 text-2xs font-normal text-ink-3">{deity}</span>}
        </p>
        {stat && <span className="text-md font-semibold text-ink figures">{stat.value}</span>}
      </div>
      {!stat ? (
        <p className="m-0 text-ink-3">{t(($) => $.stats.notListed)}</p>
      ) : stat.effects.length > 0 ? (
        <ul className="m-0 list-none border-t border-line-soft p-0 pt-1.5 text-ink-2">
          {stat.effects.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-ink-4">{t(($) => $.stats.noEffects)}</p>
      )}
    </div>
  );
}

/**
 * Base and divine stats as the service lists them, as text or a wheel, then the stat
 * sources the official documents themselves name (titles and opened Daevanion nodes). The
 * service publishes no combined combat sheet, and none is computed here.
 */
export function StatsTab({
  info,
  boards,
  onLoadBoard,
}: {
  info: CharacterInfo;
  boards: Record<number, Lazy<Board>>;
  onLoadBoard: (id: number) => void;
}) {
  const { t } = useTranslation('profile');
  const fmt = useFormat();
  const [view, setView] = useState<View>('picture');
  const read = info.boards.filter((b) => boards[b.id]?.state === 'ready');
  const unread = info.boards.filter((b) => !boards[b.id] || boards[b.id]?.state === 'error');
  const loading = info.boards.some((b) => boards[b.id]?.state === 'loading');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle className="mb-0">{t(($) => $.stats.title)}</SectionTitle>
        <SegmentedControl<View>
          size="xs"
          label={t(($) => $.stats.viewLabel)}
          value={view}
          onChange={setView}
          options={[
            {
              value: 'text',
              label: (
                <>
                  <Icon name="list" size={12} /> {t(($) => $.stats.text)}
                </>
              ),
            },
            {
              value: 'picture',
              label: (
                <>
                  <Icon name="picture" size={12} /> {t(($) => $.stats.picture)}
                </>
              ),
            },
          ]}
        />
      </div>

      {info.baseStats.length === 0 && info.divineStats.length === 0 ? (
        <Unavailable>{t(($) => $.stats.none)}</Unavailable>
      ) : view === 'text' ? (
        <div className="grid gap-4 @min-[40rem]:grid-cols-2">
          <section aria-label={t(($) => $.stats.base)}>
            <SectionTitle count={info.baseStats.length}>{t(($) => $.stats.base)}</SectionTitle>
            <ul className="m-0 list-none p-0">
              {info.baseStats.map((s) => (
                <StatRow key={s.type} stat={s} />
              ))}
            </ul>
          </section>
          <section aria-label={t(($) => $.stats.divine)}>
            <SectionTitle count={info.divineStats.length}>{t(($) => $.stats.divine)}</SectionTitle>
            <ul className="m-0 list-none p-0">
              {info.divineStats.map((s) => (
                <StatRow key={s.type} stat={s} />
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <StatWheel base={info.baseStats} divine={info.divineStats} />
      )}

      <section aria-label={t(($) => $.stats.titles)}>
        <SectionTitle
          count={
            info.titlesOwned !== null && info.titlesTotal !== null
              ? t(($) => $.stats.titlesOwned, { owned: info.titlesOwned, total: info.titlesTotal })
              : undefined
          }
        >
          {t(($) => $.stats.titles)}
        </SectionTitle>
        {info.titles.length === 0 ? (
          <Unavailable>{t(($) => $.stats.noTitles)}</Unavailable>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0 @min-[40rem]:grid-cols-3">
            {info.titles.map((title) => (
              <li
                key={title.id}
                className={cn('rounded-sm border bg-surface-2 p-2', gradeStyle(title.grade).edge)}
              >
                <p className="m-0 text-2xs text-ink-3">
                  {title.category} · <GradeWord grade={title.grade} />
                </p>
                <p className="m-0 text-sm font-semibold text-ink">{title.name}</p>
                {title.equipEffects.length > 0 && (
                  <>
                    <p className="m-0 mt-1 text-3xs font-semibold tracking-caps text-ink-3 uppercase">
                      {t(($) => $.stats.whileEquipped)}
                    </p>
                    <ul className="m-0 list-none p-0 text-xs text-ink-2">
                      {title.equipEffects.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </>
                )}
                {title.ownEffects.length > 0 && (
                  <>
                    <p className="m-0 mt-1 text-3xs font-semibold tracking-caps text-ink-3 uppercase">
                      {t(($) => $.stats.whileOwned)}
                    </p>
                    <ul className="m-0 list-none p-0 text-xs text-ink-2">
                      {title.ownEffects.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </>
                )}
                {title.ownedPercent !== null && (
                  <p className="m-0 mt-1 text-2xs text-ink-4">
                    {t(($) => $.stats.ownedBy, { percent: fmt.integer.format(title.ownedPercent) })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t(($) => $.stats.boardBonuses)}>
        <SectionTitle>{t(($) => $.stats.boardBonuses)}</SectionTitle>
        {read.length > 0 && (
          <div className="grid gap-2 @min-[40rem]:grid-cols-2">
            {read.map((b) => {
              const effects = boards[b.id]?.data?.statEffects ?? [];
              return (
                <div key={b.id}>
                  <p className="m-0 text-xs font-semibold text-ink">{b.name}</p>
                  {effects.length ? (
                    <ul className="m-0 list-none p-0 text-xs text-ink-2">
                      {effects.map((e, i) => (
                        <li key={`${e}${i}`}>{e}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="m-0 text-xs text-ink-4">{t(($) => $.stats.noBoardStats)}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {unread.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="m-0 text-xs text-ink-3">
              {t(($) => $.stats.boardsUnread, { count: unread.length })}
            </p>
            <Button
              size="xs"
              loading={loading}
              icon={<Icon name="daevanion" size={12} />}
              onClick={() => unread.forEach((b) => onLoadBoard(b.id))}
            >
              {t(($) => $.stats.readBoards)}
            </Button>
          </div>
        )}
      </section>

      {info.rankings && info.rankings.length > 0 && (
        <section aria-label={t(($) => $.stats.rankings)}>
          <SectionTitle count={info.rankings.length}>{t(($) => $.stats.rankings)}</SectionTitle>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-ink-2">
            {info.rankings.map((entry, i) => (
              <li key={i} className="border-t border-line-soft pt-1 first:border-t-0">
                {entry.map(([k, v]) => `${k}: ${v}`).join(' · ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="border-t border-line-soft pt-3">
        <Unavailable>{t(($) => $.stats.combatUnavailable)}</Unavailable>
      </section>
    </div>
  );
}
