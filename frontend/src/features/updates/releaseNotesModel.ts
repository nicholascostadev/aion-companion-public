/**
 * Release notes as a display model. GitHub writes a release body as Markdown, usually its
 * generated "What's Changed" list of pull request titles. This repository titles every pull
 * request as a Conventional Commit, so those entries are grouped by kind (features, fixes …)
 * with their scope and pull request split out. Everything else stays in order as plain
 * Markdown blocks, so no line of the notes is ever dropped. Nothing here produces HTML: the
 * view renders the model as React elements, and raw HTML in the notes stays literal text.
 */

export type ChangeKind =
  | 'breaking'
  | 'feature'
  | 'fix'
  | 'performance'
  | 'improvement'
  | 'docs'
  | 'revert'
  | 'maintenance';

/** The order the groups are read in: what can break first, then what is new. */
export const CHANGE_KINDS: readonly ChangeKind[] = [
  'breaking',
  'feature',
  'fix',
  'performance',
  'improvement',
  'docs',
  'revert',
  'maintenance',
];

const TYPE_KINDS: Record<string, Exclude<ChangeKind, 'breaking'>> = {
  feat: 'feature',
  feature: 'feature',
  fix: 'fix',
  perf: 'performance',
  refactor: 'improvement',
  style: 'improvement',
  docs: 'docs',
  revert: 'revert',
  build: 'maintenance',
  ci: 'maintenance',
  chore: 'maintenance',
  test: 'maintenance',
};

export interface PullRef {
  number: number;
  /** Absolute https URL, or null when the notes only say `#30`. */
  url: string | null;
}

export interface Change {
  /** The commit type as written, lowercased (`feat`). */
  type: string;
  /** The kind of its type; a breaking change is still a feature or a fix underneath. */
  kind: Exclude<ChangeKind, 'breaking'>;
  scopes: string[];
  breaking: boolean;
  /** The description, capitalised and without a trailing full stop; may hold inline Markdown. */
  description: string;
  author: string | null;
  pull: PullRef | null;
  /** Indented notes written under the entry, in order; may hold inline Markdown. */
  details: string[];
}

export interface ChangeGroup {
  kind: ChangeKind;
  changes: Change[];
}

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' };

export interface ListItem {
  text: string;
  /** 0 for a top-level item, 1 for anything indented under one. */
  depth: number;
}

export interface Compare {
  url: string;
  from: string | null;
  to: string | null;
}

export interface ReleaseNotes {
  groups: ChangeGroup[];
  /** Everything that is not a grouped change, in its original order. */
  blocks: Block[];
  /** The "Full Changelog" comparison link, shown apart from the rest. */
  compare: Compare | null;
}

/** Only absolute http(s) URLs become links; anything else stays text. */
export function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** decodeURIComponent that keeps the text as written when it is not valid percent-encoding. */
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const CONVENTIONAL = /^([a-z]+)(?:\(([^()]*)\))?(!)?:\s+(\S[\s\S]*)$/i;
// GitHub's generated suffix: "by @user in https://github.com/owner/repo/pull/30" (or "in #30").
const GITHUB_SUFFIX =
  /\s+by\s+@([A-Za-z0-9][A-Za-z0-9-]*(?:\[bot\])?)\s+in\s+(?:(https?:\/\/\S+?\/pull\/(\d+))|#(\d+))\s*$/;
const BREAKING_NOTE = /^BREAKING[ -]CHANGE:?\s*/;

/** A Conventional Commit pull request title, or null for any other list item. */
export function parseChange(text: string): Change | null {
  let rest = text.trim();
  let author: string | null = null;
  let pull: PullRef | null = null;
  const suffix = GITHUB_SUFFIX.exec(rest);
  if (suffix) {
    author = suffix[1] ?? null;
    const url = suffix[2] ? safeUrl(suffix[2]) : null;
    pull = { number: Number(suffix[3] ?? suffix[4]), url };
    rest = rest.slice(0, suffix.index);
  } else {
    const trailing = /\s+\(#(\d+)\)\s*$/.exec(rest);
    if (trailing) {
      pull = { number: Number(trailing[1]), url: null };
      rest = rest.slice(0, trailing.index);
    }
  }

  const match = CONVENTIONAL.exec(rest);
  if (!match) return null;
  const type = match[1]!.toLowerCase();
  const kind = TYPE_KINDS[type];
  if (!kind) return null;

  let description = match[4]!.trim();
  const breakingNote = BREAKING_NOTE.test(description);
  if (breakingNote) description = description.replace(BREAKING_NOTE, '');
  description = description.replace(/(?<!\.)\.$/, '');
  if (!description) return null;
  description = description.charAt(0).toUpperCase() + description.slice(1);

  return {
    type,
    kind,
    scopes: (match[2] ?? '')
      .split(/[,/]/)
      .map((scope) => scope.trim())
      .filter(Boolean),
    breaking: match[3] === '!' || breakingNote,
    description,
    author,
    pull,
    details: [],
  };
}

const FULL_CHANGELOG = /^\*\*Full Changelog\*\*:?\s*(\S+)\s*$/i;

function parseCompare(line: string): Compare | null {
  const match = FULL_CHANGELOG.exec(line.trim());
  const url = match ? safeUrl(match[1]!) : null;
  if (!url) return null;
  const range = /\/compare\/(.+?)\.{2,3}(.+?)\/?$/.exec(url);
  return {
    url,
    from: range ? decode(range[1]!) : null,
    to: range ? decode(range[2]!) : null,
  };
}

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([*+-]|\d{1,9}[.)])\s+(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const QUOTE = /^ {0,3}>\s?(.*)$/;

export function parseReleaseNotes(source: string): ReleaseNotes {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  const changes: Change[] = [];
  let compare: Compare | null = null;
  // Headings whose section gave changes to the groups; dropped below if nothing else remains.
  const absorbed = new Set<Block>();
  let heading: Block | null = null;
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: ListItem[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ kind: 'quote', text: quote.join('\n') });
    quote = [];
  };
  const flushList = () => {
    if (!list) return;
    const kept: ListItem[] = [];
    let parent: Change | null = null;
    for (const item of list.items) {
      // An indented note under a grouped change travels with it.
      if (parent && item.depth > 0) {
        parent.details.push(item.text);
        continue;
      }
      const change = item.depth === 0 ? parseChange(item.text) : null;
      parent = change;
      if (change) {
        changes.push(change);
        if (heading) absorbed.add(heading);
        continue;
      }
      kept.push(item);
    }
    if (kept.length) blocks.push({ kind: 'list', ordered: list.ordered, items: kept });
    list = null;
  };
  const flush = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const close = fence[1]!;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trimStart().startsWith(close)) {
        body.push(lines[index]!);
        index += 1;
      }
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushQuote();
      // A blank line between items keeps one list; anything else after it ends the list.
      continue;
    }

    const headingMatch = HEADING.exec(line);
    if (headingMatch) {
      flush();
      heading = { kind: 'heading', level: headingMatch[1]!.length, text: headingMatch[2]! };
      blocks.push(heading);
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const quoteMatch = QUOTE.exec(line);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quote.push(quoteMatch[1]!);
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      flushParagraph();
      flushQuote();
      const ordered = /\d/.test(item[2]!);
      if (list && list.ordered !== ordered && item[1]!.length === 0) flushList();
      list ??= { ordered, items: [] };
      list.items.push({ text: item[3]!.trim(), depth: item[1]!.length >= 2 ? 1 : 0 });
      continue;
    }

    const found = parseCompare(line);
    if (found && !compare) {
      flush();
      compare = found;
      continue;
    }

    // A wrapped line continues the item above it, unless a blank line came between.
    const previous = lines[index - 1] ?? '';
    if (list && previous.trim() && list.items.length) {
      const last = list.items[list.items.length - 1]!;
      last.text = `${last.text} ${line.trim()}`;
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  flush();

  // Drop a heading such as "What's Changed" once every line under it became a group.
  const kept = blocks.filter((block, index) => {
    if (block.kind !== 'heading' || !absorbed.has(block)) return true;
    const next = blocks[index + 1];
    return next !== undefined && !(next.kind === 'heading' && next.level <= block.level);
  });

  const groups = CHANGE_KINDS.map((kind) => ({
    kind,
    changes: changes.filter((change) =>
      kind === 'breaking' ? change.breaking : !change.breaking && change.kind === kind,
    ),
  })).filter((group) => group.changes.length > 0);

  return { groups, blocks: kept, compare };
}

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] };

const INLINE = new RegExp(
  [
    /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/.source, // 1,2 code
    /\*\*(\S|\S[\s\S]*?\S)\*\*/.source, // 3 strong
    /(?<![\w])__(\S|\S[\s\S]*?\S)__(?![\w])/.source, // 4 strong
    /\[([^\]\n]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/.source, // 5,6 link
    /(https?:\/\/[^\s<>]*[^\s<>().,;:!?'"*_\]])/.source, // 7 bare URL
    /(?<![\w*])\*([^\s*]|[^\s*][^*\n]*?[^\s*])\*(?![\w*])/.source, // 8 emphasis
    /(?<![\w])_([^\s_]|[^\s_][^_\n]*?[^\s_])_(?![\w])/.source, // 9 emphasis
  ].join('|'),
  'g',
);

/** A short, readable label for a GitHub URL, as GitHub itself shows them. */
export function linkLabel(href: string): string {
  const url = safeUrl(href);
  if (!url) return href;
  const github =
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(pull|issues|commit|compare)\/([^/?#]+)/.exec(url);
  if (!github) return href;
  const [, , section, id] = github;
  if (section === 'commit') return id!.slice(0, 7);
  if (section === 'compare') return decode(id!);
  return `#${id}`;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const previous = out[out.length - 1];
    if (previous?.kind === 'text') previous.text += value;
    else out.push({ kind: 'text', text: value });
  };
  for (const match of text.matchAll(INLINE)) {
    const start = match.index;
    pushText(text.slice(last, start));
    last = start + match[0].length;
    if (match[2] !== undefined) out.push({ kind: 'code', text: match[2].trim() || match[2] });
    else if (match[3] !== undefined || match[4] !== undefined)
      out.push({ kind: 'strong', children: parseInline(match[3] ?? match[4]!) });
    else if (match[5] !== undefined) {
      const href = safeUrl(match[6]!);
      const children = parseInline(match[5]);
      if (href) out.push({ kind: 'link', href, children });
      else
        for (const child of children) {
          if (child.kind === 'text') pushText(child.text);
          else out.push(child);
        }
    } else if (match[7] !== undefined) {
      const href = safeUrl(match[7]);
      if (href)
        out.push({ kind: 'link', href, children: [{ kind: 'text', text: linkLabel(href) }] });
      else pushText(match[7]);
    } else if (match[8] !== undefined || match[9] !== undefined)
      out.push({ kind: 'em', children: parseInline(match[8] ?? match[9]!) });
  }
  pushText(text.slice(last));
  return out;
}
