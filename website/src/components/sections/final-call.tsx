import { Download } from 'lucide-react';
import { ButtonLink } from '@/components/button-link';
import { Wayseed } from '@/components/wayseed';
import { useI18n } from '@/i18n/context';
import { DOWNLOAD_URL } from '@/lib/site';

export function FinalCall() {
  const { m } = useI18n();
  return (
    <section
      aria-labelledby="final-title"
      className="mx-auto flex min-h-[80svh] max-w-7xl flex-col items-center justify-center px-4 py-28 text-center sm:px-6"
    >
      <Wayseed spin className="size-24 drop-shadow-[0_0_30px_var(--primary)]" />
      <h2
        id="final-title"
        className="mt-10 max-w-4xl font-display text-5xl leading-[1] font-semibold tracking-[-0.04em] text-balance sm:text-7xl"
      >
        {m.final.title} <span className="text-gradient text-glow">{m.final.titleEm}</span>
      </h2>
      <p className="mt-6 max-w-md text-base text-balance text-ink-2 sm:text-lg">{m.final.lede}</p>
      <ButtonLink
        size="lg"
        href={DOWNLOAD_URL}
        newTab
        className="mt-9 shadow-[0_0_40px_-8px_var(--primary)]"
      >
        <Download aria-hidden="true" />
        {m.final.download}
      </ButtonLink>
    </section>
  );
}
