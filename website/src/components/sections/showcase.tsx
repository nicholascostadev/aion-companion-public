import { ArrowDown, Download } from 'lucide-react';
import { useState } from 'react';
import { AppAlertCard } from '@/components/app/alert-popup';
import { AppMeter } from '@/components/app/meter';
import { AppPartyRoom } from '@/components/app/party-room';
import { AppPetRadar } from '@/components/app/pet-radar';
import { AppTimers } from '@/components/app/timers';
import { ButtonLink } from '@/components/button-link';
import { AtlasDemo } from '@/components/demos/atlas-demo';
import { RotationDemo } from '@/components/demos/rotation-demo';
import { WindowsDemo } from '@/components/demos/windows-demo';
import { FEATURE_ICONS } from '@/components/features';
import { GameScreen } from '@/components/game-screen';
import { Kicker } from '@/components/kicker';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useI18n } from '@/i18n/context';
import type { Feature, FeatureId } from '@/i18n/en';
import { DOWNLOAD_URL } from '@/lib/site';
import { cn } from '@/lib/utils';

/**
 * The opening is a still game screen: the app's windows where players keep them, the headline
 * in the middle where the game would be. Then a feature switcher, styled like the app's top
 * menu, shows one real window at a time. Nothing here is driven by scrolling.
 */

export function Opening() {
  const { m } = useI18n();
  const headline = (
    <>
      {m.hero.headline} <span className="text-gradient text-glow">{m.hero.headlineEm}</span>
    </>
  );
  return (
    <section id="top" aria-labelledby="top-title" className="relative">
      {/* Desktop: the headline over the game screen. */}
      <div className="relative hidden h-[max(44rem,100svh)] lg:block">
        <GameScreen>
          <div className="absolute inset-x-0 top-16 bottom-0 z-10 flex items-center justify-center px-6">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(42%_48%_at_50%_52%,var(--void)_35%,transparent)] opacity-80" />
            <div className="relative flex max-w-[44rem] animate-rise flex-col items-center text-center">
              <div className="flex items-center gap-4">
                <span
                  aria-hidden="true"
                  className="h-px w-16 bg-gradient-to-r from-transparent to-gold-line"
                />
                <Kicker>{m.hero.kicker}</Kicker>
                <span
                  aria-hidden="true"
                  className="h-px w-16 bg-gradient-to-l from-transparent to-gold-line"
                />
              </div>
              <h1
                id="top-title"
                className="mt-7 font-display text-5xl leading-[0.98] font-semibold tracking-[-0.045em] text-balance xl:text-[4.5rem] 2xl:text-[5rem]"
              >
                {headline}
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-relaxed text-pretty text-ink-2">
                {m.hero.lede}
              </p>
              <div className="mt-8 flex items-center gap-3">
                <ButtonLink
                  size="lg"
                  href={DOWNLOAD_URL}
                  newTab
                  className="shadow-[0_0_40px_-8px_var(--primary)]"
                >
                  <Download aria-hidden="true" />
                  {m.hero.download}
                </ButtonLink>
                <ButtonLink size="lg" variant="ghost" href="#features" className="text-ink-2">
                  {m.hero.seeFeatures}
                  <ArrowDown aria-hidden="true" />
                </ButtonLink>
              </div>
              <p className="mt-5 text-xs text-muted-foreground">{m.hero.fine}</p>
            </div>
          </div>
        </GameScreen>
      </div>

      {/* Smaller screens: the headline alone; the windows follow in the features. Only one of the
          two headings is displayed at a time, so each screen has a single h1. */}
      <div className="px-4 pt-14 pb-10 text-center sm:px-6 lg:hidden">
        <Kicker>{m.hero.kicker}</Kicker>
        <h1 className="mx-auto mt-6 max-w-xl font-display text-[2.6rem] leading-[1] font-semibold tracking-[-0.045em] text-balance sm:text-6xl">
          {headline}
        </h1>
        <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-pretty text-ink-2">
          {m.hero.lede}
        </p>
        <ButtonLink size="lg" href={DOWNLOAD_URL} newTab className="mt-7">
          <Download aria-hidden="true" />
          {m.hero.download}
        </ButtonLink>
        <p className="mt-4 text-xs text-muted-foreground">{m.hero.fineShort}</p>
      </div>
    </section>
  );
}

function Visual({ id }: { id: FeatureId }) {
  switch (id) {
    case 'live':
      return <AppMeter className="mx-auto" />;
    case 'reports':
      return <RotationDemo />;
    case 'group':
      return <AppPartyRoom className="mx-auto" />;
    case 'alerts':
      return (
        <div className="mx-auto max-w-[340px] space-y-3">
          <AppTimers />
          <AppAlertCard minutes={5} name="Shugo Festival" />
        </div>
      );
    case 'pets':
      return <AppPetRadar className="mx-auto" />;
    case 'explore':
      return <AtlasDemo />;
    case 'windows':
      return <WindowsDemo />;
  }
}

export function Features() {
  const { m } = useI18n();
  const list = m.features.list;
  const [id, setId] = useState<FeatureId>(list[0]!.id);

  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28"
    >
      <div className="flex flex-col items-center text-center">
        <h2
          id="features-title"
          className="max-w-3xl font-display text-4xl leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-5xl"
        >
          {m.features.title}
        </h2>
        <p className="mt-5 max-w-lg text-base text-pretty text-muted-foreground">
          {m.features.subtitle}
        </p>
      </div>

      {/* The switcher wears the app's top-menu pill. It needs scripts, so without them every
          panel is listed instead (styles.css). */}
      <div className="js-only mt-10 -mx-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <ToggleGroup
          aria-label={m.features.label}
          value={[id]}
          onValueChange={(values) => {
            const next = list.find((f) => f.id === values[0]);
            if (next) setId(next.id);
          }}
          spacing={1}
          className="mx-auto w-max rounded-full border border-app-line-strong bg-app-surface p-1 shadow-xl"
        >
          {list.map(({ id: key, name }) => {
            const Icon = FEATURE_ICONS[key];
            return (
              <ToggleGroupItem
                key={key}
                value={key}
                className="h-9 gap-2 rounded-full px-3.5 text-sm text-ink-2 hover:bg-foreground/5 aria-pressed:bg-gold-soft aria-pressed:text-primary aria-pressed:ring-1 aria-pressed:ring-gold-line"
              >
                <Icon aria-hidden="true" />
                {name}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>

      {list.map((feature) => (
        <Panel key={feature.id} feature={feature} active={feature.id === id} />
      ))}
    </section>
  );
}

function Panel({ feature, active }: { feature: Feature; active: boolean }) {
  const Icon = FEATURE_ICONS[feature.id];
  return (
    <div
      data-panel
      data-inactive={active ? undefined : ''}
      className={cn(
        'mt-12 grid items-start gap-10 lg:min-h-[34rem] lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-16',
        // Fade in when chosen; without scripts the panels simply follow each other.
        'animate-in duration-300 fade-in-0 slide-in-from-bottom-2',
        'in-[.no-js]:border-t in-[.no-js]:border-border in-[.no-js]:pt-12',
      )}
    >
      <div>
        <Kicker icon={Icon}>{feature.name}</Kicker>
        <h3 className="mt-5 font-display text-3xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
          {feature.title}
        </h3>
        <ul className="mt-6 space-y-3">
          {feature.points.map((point, i) => (
            <li key={i} className="flex gap-3 text-[0.9375rem] leading-relaxed text-ink-2">
              <span
                aria-hidden="true"
                className="mt-[0.6em] size-1.5 shrink-0 rotate-45 bg-primary shadow-[0_0_10px_var(--primary)]"
              />
              <span>{point}</span>
            </li>
          ))}
        </ul>
        {feature.note ? (
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">{feature.note}</p>
        ) : null}
      </div>
      <div className="min-w-0">
        <Visual id={feature.id} />
      </div>
    </div>
  );
}
