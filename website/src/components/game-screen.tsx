import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppAlertCard } from '@/components/app/alert-popup';
import { AppMenuBar } from '@/components/app/menu-bar';
import { AppMeter } from '@/components/app/meter';
import { AppPetRadar } from '@/components/app/pet-radar';
import { clock } from '@/components/app/primitives';
import { AppTimers } from '@/components/app/timers';

/**
 * A 1600 × 900 game screen with the app's windows where players keep them, scaled to fill the
 * box below the site header. The windows are softened so whatever sits on top (the headline)
 * reads first. A picture of the app: hidden from assistive technology and not interactive.
 */
const SCREEN = { w: 1600, h: 900 };
const HEADER = 64; // the site header, kept in step with top-[calc(64px+…)] below

export function GameScreen({ children }: { children?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  // Measured with scripts; before that (or without them) styles.css picks a size per width.
  const [view, setView] = useState<{ w: number; h: number } | null>(null);
  const [seconds, setSeconds] = useState(24);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setView({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const s = view ? Math.min(view.w / SCREEN.w, (view.h - HEADER) / SCREEN.h) * 0.94 : null;

  return (
    <div ref={box} className="relative h-full w-full overflow-hidden">
      <div
        aria-hidden="true"
        inert
        // Centred below the header; only the scale is measured.
        className="hud-scale absolute top-[calc(64px+(100%-64px)/2)] left-1/2 opacity-70"
        style={{
          width: SCREEN.w,
          height: SCREEN.h,
          ...(s ? { ['--hud-scale' as string]: s } : {}),
        }}
      >
        <AppMenuBar time={clock(seconds)} className="absolute top-[18px] left-[580px]" />
        <AppAlertCard
          name="Shugo Festival"
          className="absolute top-[66px] left-[640px] w-[320px]"
        />
        <AppTimers compact className="absolute top-[110px] left-[36px] w-[300px] max-w-none" />
        <AppMeter
          onClock={setSeconds}
          className="absolute top-[110px] left-[1204px] w-[360px] max-w-none"
        />
        <AppPetRadar
          mapHeight={230}
          className="absolute top-[432px] left-[1224px] w-[340px] max-w-none"
        />
      </div>
      {children}
    </div>
  );
}
