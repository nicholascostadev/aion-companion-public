import { HardDrive, Radio, ShieldCheck, UserX, type LucideIcon } from 'lucide-react';
import { Kicker } from '@/components/kicker';
import { useI18n } from '@/i18n/context';

/** One icon per fact, in the order of the dictionary's privacy.facts. */
const FACT_ICONS: LucideIcon[] = [HardDrive, UserX, Radio, ShieldCheck];

/** Privacy: the promise on the left, the four facts that back it on the right. */
export function Statement() {
  const { m } = useI18n();
  return (
    <section
      id="privacy"
      aria-labelledby="privacy-title"
      className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:gap-20 lg:py-32"
    >
      <div>
        <Kicker>{m.privacy.kicker}</Kicker>
        <h2
          id="privacy-title"
          className="mt-6 font-display text-5xl leading-[1] font-semibold tracking-[-0.04em] sm:text-6xl xl:text-7xl"
        >
          {m.privacy.line1}
          <br />
          <span className="text-gradient">{m.privacy.line2}</span>
        </h2>
        <p className="mt-6 max-w-sm text-base leading-relaxed text-muted-foreground">
          {m.privacy.lede}
        </p>
      </div>

      <ul className="grid gap-x-10 sm:grid-cols-2">
        {m.privacy.facts.map(({ title, body }, i) => {
          const Icon = FACT_ICONS[i] ?? HardDrive;
          return (
            <li
              key={title}
              className="border-t border-border py-7 sm:nth-[-n+2]:border-t-0 sm:nth-[-n+2]:pt-0 max-sm:first:border-t-0 max-sm:first:pt-0"
            >
              <span className="flex size-10 items-center justify-center rounded-leaf bg-gold-soft text-primary">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold tracking-tight">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
