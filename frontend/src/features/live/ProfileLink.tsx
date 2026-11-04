import type { MouseEvent } from 'react';
import { Button, type ButtonSize } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import type { ShugoProfile } from '../../lib/shugo';

/** Opens a character's profile in the in-game profile window; native owns the window. */
export type OpenProfile = (profile: ShugoProfile) => void;

/**
 * The inspect-character mark beside a character: an icon-only ghost pebble, quiet until
 * hovered. Its label names the character, as the icon alone does not. The person glyph
 * stands as tall as the boxed name tags (14 px), larger than the button's own glyph size.
 */
export function ProfileLink({
  profile,
  label,
  onOpen,
  size = 'xs',
  className,
  hit = false,
}: {
  profile: ShugoProfile;
  label: string;
  onOpen: OpenProfile;
  size?: ButtonSize;
  className?: string;
  /** Clickable on a locked, click-through overlay. */
  hit?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size={size}
      iconOnly
      className={cn('text-ink-3 enabled:hover:text-accent [&_svg.icon]:size-3.5', className)}
      aria-label={label}
      title={label}
      data-hit={hit || undefined}
      onClick={(event: MouseEvent) => {
        // Never also selects the row it sits on.
        event.stopPropagation();
        onOpen(profile);
      }}
    >
      <Icon name="inspect" />
    </Button>
  );
}
