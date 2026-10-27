import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from './Collapsible';
import { focusRing } from './Button';
import { Icon } from './Icon';

/**
 * A quiet summary row that unfolds its content, with a chevron that turns as it opens: Base
 * UI's Collapsible, so the summary is a button with aria-expanded and aria-controls. Like
 * `<details open>`, `open` sets the state and setting it again (a new value) re-applies it,
 * while the reader can still fold and unfold it in between. Closed content stays in the
 * page, hidden until the browser's find-in-page reaches it. `variant="rule"` draws a
 * hairline above (a section inside a card); `plain` has no rule.
 */
export function Disclosure({
  summary,
  children,
  open = false,
  variant = 'rule',
  className,
  summaryClassName,
  bodyClassName,
  summaryAttributes,
}: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
  variant?: 'rule' | 'plain';
  className?: string;
  summaryClassName?: string;
  bodyClassName?: string;
  /** Data attributes for the summary, e.g. `{ 'data-hit': 'about' }` on a click-through overlay. */
  summaryAttributes?: Record<`data-${string}`, string>;
}) {
  const [shown, setShown] = useState(open);
  const [applied, setApplied] = useState(open);
  if (open !== applied) {
    setApplied(open);
    setShown(open);
  }
  return (
    <Collapsible
      data-ui="disclosure"
      open={shown}
      onOpenChange={setShown}
      className={cn(
        'm-0 border-0 p-0',
        variant === 'rule' && 'border-t border-line-soft',
        className,
      )}
    >
      <CollapsibleTrigger
        data-ui="disclosure-summary"
        {...summaryAttributes}
        className={cn(
          'group/summary mb-0 flex w-full cursor-pointer items-center gap-2 rounded-sm py-3 text-left text-sm font-medium text-ink-2',
          'transition-colors duration-150 hover:text-ink',
          focusRing,
          summaryClassName,
        )}
      >
        <Icon
          name="chevronRight"
          size={14}
          className="text-ink-3 transition-transform duration-200 ease-grow group-data-panel-open/summary:rotate-90"
        />
        <span className="min-w-0 flex-1">{summary}</span>
      </CollapsibleTrigger>
      {/* The padding sits inside: a panel hidden until found keeps its own box. */}
      <CollapsiblePanel hiddenUntilFound>
        <div className={cn('pb-4 pl-5.5', bodyClassName)}>{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
