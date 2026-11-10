import { ArrowUpRight } from 'lucide-react';
import { ButtonLink } from '@/components/button-link';
import { Kicker } from '@/components/kicker';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useI18n } from '@/i18n/context';
import { REPO_URL } from '@/lib/site';

/**
 * The questions, large in one centred column on hairlines. Answers open with an animation;
 * without scripts they are all shown (styles.css).
 */
export function Faq() {
  const { m } = useI18n();
  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="mx-auto max-w-3xl px-4 py-24 sm:px-6 lg:py-32"
    >
      <div className="flex flex-col items-center text-center">
        <Kicker>{m.faq.kicker}</Kicker>
        <h2
          id="faq-title"
          className="mt-6 font-display text-4xl leading-[1.02] font-semibold tracking-[-0.035em] sm:text-5xl"
        >
          {m.faq.title}
        </h2>
      </div>
      <Accordion className="mt-12 border-y border-border">
        {m.faq.items.map(({ q, a }, i) => (
          <AccordionItem key={i} value={String(i)} className="border-border not-last:border-b">
            <AccordionTrigger className="py-6 text-xl font-semibold tracking-tight hover:text-primary hover:no-underline aria-expanded:text-primary">
              {q}
            </AccordionTrigger>
            <AccordionContent className="pr-8 pb-6 text-base leading-relaxed text-muted-foreground [&_a]:text-primary">
              <p>{a}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      <div className="flex flex-col items-center text-center">
        <p className="mt-5 max-w-xs text-sm leading-relaxed text-muted-foreground">{m.faq.ask}</p>
        <ButtonLink
          href={`${REPO_URL}/issues`}
          variant="outline"
          size="sm"
          className="mt-4 border-border bg-transparent"
        >
          {m.faq.askButton}
          <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
        </ButtonLink>
      </div>
    </section>
  );
}
