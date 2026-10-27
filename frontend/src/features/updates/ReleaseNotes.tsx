import { Fragment, useId, useMemo, type ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { buttonClasses, focusRing } from '../../components/ui/Button';
import { Icon, type IconName } from '../../components/ui/Icon';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import {
  parseInline,
  parseReleaseNotes,
  type Block,
  type Change,
  type ChangeGroup,
  type ChangeKind,
  type Compare,
  type Inline,
} from './releaseNotesModel';

/**
 * Each kind of change has its own Lucide glyph and, for the kinds a player notices, a data
 * ink; the written group name always says what it is, so colour is never the only signal.
 */
const KINDS: Record<ChangeKind, { icon: IconName; tone: string; stem: string }> = {
  breaking: { icon: 'warning', tone: 'text-danger', stem: 'border-danger-line' },
  feature: { icon: 'event', tone: 'text-jade-ink', stem: 'border-line' },
  fix: { icon: 'bug', tone: 'text-sky-ink', stem: 'border-line' },
  performance: { icon: 'gauge', tone: 'text-ember-ink', stem: 'border-line' },
  improvement: { icon: 'sprout', tone: 'text-iris-ink', stem: 'border-line' },
  docs: { icon: 'book', tone: 'text-ink-3', stem: 'border-line' },
  revert: { icon: 'undo', tone: 'text-ink-3', stem: 'border-line' },
  maintenance: { icon: 'wrench', tone: 'text-ink-3', stem: 'border-line' },
};

/** Inline links in the notes: quiet accent text that underlines on hover. */
const linkClass = cn(
  'rounded-xs text-accent underline decoration-accent-line underline-offset-2',
  'transition-colors duration-150 hover:text-accent-strong hover:decoration-current',
  focusRing,
);

/** Every link leaves the app for GitHub; it never gets a handle on this window. */
function ExternalLink({
  href,
  className,
  title,
  children,
}: {
  href: string;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title ?? href}
      className={className}
    >
      {children}
    </a>
  );
}

function Rich({ text }: { text: string }) {
  return <InlineNodes nodes={useMemo(() => parseInline(text), [text])} />;
}

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case 'text':
        return <Fragment key={index}>{node.text}</Fragment>;
      case 'strong':
        return (
          <strong key={index} className="font-semibold text-ink">
            <InlineNodes nodes={node.children} />
          </strong>
        );
      case 'em':
        return (
          <em key={index}>
            <InlineNodes nodes={node.children} />
          </em>
        );
      case 'code':
        return (
          <code
            key={index}
            className="rounded-xs bg-surface-3 px-1 py-px font-mono text-2xs text-ink"
          >
            {node.text}
          </code>
        );
      case 'link':
        return (
          <ExternalLink key={index} href={node.href} className={linkClass}>
            <InlineNodes nodes={node.children} />
          </ExternalLink>
        );
    }
  });
}

function ChangeRow({ change, inBreaking }: { change: Change; inBreaking: boolean }) {
  const { t } = useTranslation('updates');
  const pull = change.pull;
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5" data-kind={change.kind}>
      <div className="min-w-0 flex-[1_1_16rem] text-sm leading-snug text-ink [overflow-wrap:anywhere]">
        {inBreaking && (
          <Badge tone="danger" shape="tag" className="mr-1.5 -translate-y-px">
            {t(($) => $.releaseNotes.kinds[change.kind])}
          </Badge>
        )}
        {change.scopes.map((scope) => (
          <Badge
            key={scope}
            shape="tag"
            variant="outline"
            title={t(($) => $.releaseNotes.scope, { scope })}
            className="mr-1.5 -translate-y-px font-mono font-medium tracking-normal text-ink-3"
          >
            {scope}
          </Badge>
        ))}
        <Rich text={change.description} />
        {change.details.length > 0 && (
          <ul className="m-0 mt-1 list-disc pl-4 text-xs leading-snug text-ink-3 marker:text-ink-4">
            {change.details.map((detail, index) => (
              <li key={index}>
                <Rich text={detail} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {(pull || change.author) && (
        <span className="ml-auto flex shrink-0 items-baseline gap-1.5 text-2xs text-ink-4 tabular-nums">
          {pull &&
            (pull.url ? (
              <ExternalLink
                href={pull.url}
                title={t(($) => $.releaseNotes.pull, { number: pull.number })}
                className={cn(linkClass, 'inline-flex items-center gap-1 no-underline')}
              >
                <Icon name="pullRequest" size={11} />#{pull.number}
              </ExternalLink>
            ) : (
              <span className="inline-flex items-center gap-1 text-ink-3">
                <Icon name="pullRequest" size={11} />#{pull.number}
              </span>
            ))}
          {pull && change.author && <span aria-hidden="true">·</span>}
          {change.author && (
            <span>{t(($) => $.releaseNotes.author, { author: change.author })}</span>
          )}
        </span>
      )}
    </li>
  );
}

function Group({ group }: { group: ChangeGroup }) {
  const { t } = useTranslation('updates');
  const id = useId();
  const look = KINDS[group.kind];
  return (
    <section aria-labelledby={id} data-group={group.kind}>
      <h3
        id={id}
        className="m-0 flex items-center gap-2 text-2xs font-semibold tracking-caps text-ink-2 uppercase"
      >
        <Icon name={look.icon} size={14} className={look.tone} />
        {t(($) => $.releaseNotes.groups[group.kind])}
        <span className="font-medium text-ink-4 tabular-nums">{group.changes.length}</span>
      </h3>
      <ul className={cn('m-0 mt-1 ml-[6.5px] list-none border-l py-0 pr-0 pl-4', look.stem)}>
        {group.changes.map((change, index) => (
          <ChangeRow key={index} change={change} inBreaking={group.kind === 'breaking'} />
        ))}
      </ul>
    </section>
  );
}

function MarkdownBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':
      return (
        <h3
          className={cn(
            'm-0 text-sm font-semibold text-ink',
            block.level >= 4 && 'text-xs text-ink-2',
          )}
        >
          <Rich text={block.text} />
        </h3>
      );
    case 'paragraph':
      return (
        <p className="m-0 text-sm leading-snug whitespace-pre-line text-ink-2 [overflow-wrap:anywhere]">
          <Rich text={block.text} />
        </p>
      );
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List
          className={cn(
            'm-0 flex flex-col gap-1 pl-5 text-sm leading-snug text-ink-2 [overflow-wrap:anywhere] marker:text-ink-4',
            block.ordered ? 'list-decimal' : 'list-disc',
          )}
        >
          {block.items.map((item, index) => (
            <li key={index} className={cn(item.depth > 0 && 'ml-4 list-[circle]')}>
              <Rich text={item.text} />
            </li>
          ))}
        </List>
      );
    }
    case 'code':
      return (
        <pre className="m-0 overflow-auto rounded-md bg-sunken px-3 py-2 font-mono text-xs leading-snug text-ink-2">
          {block.text}
        </pre>
      );
    case 'quote':
      return (
        <blockquote className="m-0 border-l-2 border-line-strong pl-3 text-sm leading-snug whitespace-pre-line text-ink-3">
          <Rich text={block.text} />
        </blockquote>
      );
    case 'rule':
      return <hr className="m-0 border-0 border-t border-line-soft" />;
  }
}

function CompareLink({ compare }: { compare: Compare }) {
  const { t } = useTranslation('updates');
  return (
    <div className="flex border-t border-line-soft pt-3">
      <ExternalLink
        href={compare.url}
        className={buttonClasses({ variant: 'ghost', size: 'xs', className: '-ml-2' })}
      >
        <Icon name="compare" size={12} />
        {t(($) => $.releaseNotes.fullChangelog)}
        {compare.from && compare.to && (
          <span className="font-normal text-ink-3 tabular-nums">
            {t(($) => $.releaseNotes.compareRange, { from: compare.from, to: compare.to })}
          </span>
        )}
        <Icon name="external" size={12} className="text-ink-4" />
      </ExternalLink>
    </div>
  );
}

/** How many grouped changes the notes hold, for the summary line. */
export function releaseNotesCount(notes: string) {
  return parseReleaseNotes(notes).groups.reduce((sum, group) => sum + group.changes.length, 0);
}

/**
 * GitHub release notes as a readable changelog: Conventional Commit entries grouped by kind
 * with their scope and pull request, any other Markdown kept in order below them, and the
 * full comparison link apart at the end.
 */
export function ReleaseNotes({ notes, className }: { notes: string; className?: string }) {
  const model = useMemo(() => parseReleaseNotes(notes), [notes]);
  return (
    <div data-ui="release-notes" className={cn('flex max-w-3xl flex-col gap-4', className)}>
      {model.groups.map((group) => (
        <Group key={group.kind} group={group} />
      ))}
      {model.blocks.map((block, index) => (
        <MarkdownBlock key={index} block={block} />
      ))}
      {model.compare && <CompareLink compare={model.compare} />}
    </div>
  );
}
