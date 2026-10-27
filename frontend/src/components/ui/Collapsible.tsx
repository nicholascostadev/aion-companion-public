import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';

/*
 * Base UI's Collapsible: a trigger button (aria-expanded, aria-controls) that shows and
 * hides a panel. These parts carry no look of their own; `Disclosure` is the styled one.
 * Use them when the trigger and its panel already have a look in the screen they live in
 * (a map's boss list, a row's options). Every part takes Base UI's props: `render` to keep
 * the element the screen already uses, and the `data-open` / `data-panel-open` states.
 */

/** Holds the open state: `defaultOpen`, or `open` with `onOpenChange`. */
export function Collapsible(props: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-ui="collapsible" {...props} />;
}

/** The button that opens and closes the panel; `data-panel-open` while open. */
export function CollapsibleTrigger(props: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-ui="collapsible-trigger" {...props} />;
}

/** The content; unmounted while closed unless `keepMounted` or `hiddenUntilFound`. */
export function CollapsiblePanel(props: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePrimitive.Panel data-ui="collapsible-panel" {...props} />;
}
