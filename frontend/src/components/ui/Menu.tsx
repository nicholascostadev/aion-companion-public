import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import type { RefObject } from 'react';
import { cn } from '../../lib/cn';

/*
 * Base UI's Menu: a trigger button (aria-haspopup, aria-expanded) and a floating list with
 * arrow-key and type-ahead navigation, Escape and outside presses to close, and focus
 * returned to the trigger. Compose `Menu` > `MenuTrigger` + `MenuPopup` > items.
 */

/** Holds the open state: `open` with `onOpenChange`, or uncontrolled. */
export function Menu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root {...props} />;
}

/** The button that opens the menu; `render={<Button … />}` keeps a primitive's look. */
export function MenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-ui="menu-trigger" {...props} />;
}

export interface MenuPopupProps extends Omit<MenuPrimitive.Popup.Props, 'className'> {
  className?: string;
  /**
   * Where the popup is mounted (default `document.body`). An in-game window passes an
   * element inside its root, so the popup keeps the window's zoom and opacity and its
   * `data-hit` items are reported as clickable regions.
   */
  container?: RefObject<HTMLElement | null>;
  /** What the popup is placed against; the trigger by default. */
  anchor?: RefObject<Element | null>;
  side?: MenuPrimitive.Positioner.Props['side'];
  align?: MenuPrimitive.Positioner.Props['align'];
  sideOffset?: number;
  alignOffset?: number;
}

/**
 * The floating list: a dark leaf of deep glass with an accent edge, placed beside its
 * anchor, flipped and shifted to stay inside the window.
 */
export function MenuPopup({
  container,
  anchor,
  side = 'bottom',
  align = 'end',
  sideOffset = 2,
  alignOffset = 0,
  className,
  ...props
}: MenuPopupProps) {
  return (
    // `contents`: mounted inside a window's root, the portal adds no box to its layout.
    <MenuPrimitive.Portal container={container} className="contents">
      <MenuPrimitive.Positioner
        className="z-10"
        anchor={anchor}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <MenuPrimitive.Popup
          data-ui="menu"
          className={cn(
            'flex animate-sprout flex-col overflow-auto rounded-lg border border-accent-line bg-shade/95 p-0.75 shadow-3',
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

/** One choice of a set (`MenuRadioItem`s); `value` names the checked item. */
export function MenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-ui="menu-group" {...props} />;
}

export interface MenuRadioItemProps extends Omit<MenuPrimitive.RadioItem.Props, 'className'> {
  className?: string;
}

/**
 * A `menuitemradio` (aria-checked); it closes the menu when chosen. Highlighted (pointer or
 * keyboard) items take the hover wash, the checked one the accent; the caller lays out the
 * content.
 */
export function MenuRadioItem({ className, closeOnClick = true, ...props }: MenuRadioItemProps) {
  return (
    <MenuPrimitive.RadioItem
      data-ui="menu-item"
      closeOnClick={closeOnClick}
      className={cn(
        'cursor-pointer select-none data-highlighted:bg-surface-hover',
        'aria-checked:bg-accent-soft aria-checked:text-accent data-disabled:cursor-default data-disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
}
