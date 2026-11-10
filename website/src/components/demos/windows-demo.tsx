import { useEffect, useRef, useState } from 'react';
import { AppAlertCard } from '@/components/app/alert-popup';
import { AppMenuBar } from '@/components/app/menu-bar';
import { AppMeter } from '@/components/app/meter';
import { clock } from '@/components/app/primitives';
import { AppPetRadar } from '@/components/app/pet-radar';
import { AppTimers } from '@/components/app/timers';
import { useI18n } from '@/i18n/context';

/**
 * A 1280 × 720 screen with the real windows where players usually keep them, scaled to fit.
 */
const W = 1280;
const H = 720;

export function WindowsDemo() {
  const box = useRef<HTMLDivElement>(null);
  // Measured with scripts; before that (or without them) styles.css picks a size per width.
  const [scale, setScale] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(24);
  const { m } = useI18n();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / W);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    // Below tablet width the screen keeps a readable size and scrolls sideways.
    <div className="-mx-4 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] sm:mx-0 sm:px-0">
      <div
        ref={box}
        aria-hidden="true"
        className="scene-box relative aspect-video min-w-[720px] overflow-hidden rounded-2xl border border-border bg-void/40"
      >
        <span className="absolute top-2 left-3 z-10 text-[0.625rem] tracking-[0.25em] text-ink-4 uppercase">
          {m.app.borderless}
        </span>
        <div
          className="scene-scale absolute top-0 left-0 origin-top-left"
          style={{ width: W, height: H, ...(scale ? { ['--scene-scale' as string]: scale } : {}) }}
        >
          <span className="absolute top-1/2 left-1/2 -translate-1/2 text-center text-sm tracking-[0.2em] text-ink-4/70 uppercase">
            {m.app.gameInView}
          </span>
          <AppMenuBar time={clock(seconds)} className="absolute top-5 left-1/2 -translate-x-1/2" />
          <AppAlertCard
            className="absolute top-[72px] left-1/2 w-[320px] -translate-x-1/2"
            name="Shugo Festival"
          />
          <AppTimers compact className="absolute top-[110px] left-6 w-[300px]" />
          <AppPetRadar mapHeight={150} className="absolute top-[340px] left-6 w-[320px]" />
          <AppMeter onClock={setSeconds} className="absolute top-[110px] right-6 w-[360px]" />
        </div>
      </div>
    </div>
  );
}
