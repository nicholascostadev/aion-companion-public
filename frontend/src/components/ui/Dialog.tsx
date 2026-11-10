import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import type { ReactNode, RefObject } from 'react';
import { cn } from '../../lib/cn';

/*
 * Base UI's Dialog: a modal sheet over the workspace with its own focus trap, Escape and
 * outside-press dismissal, and focus returned to whatever opened it. Compose `Dialog` >
 * `DialogPopup` > content with a `DialogTitle` (and usually a `DialogDescription`).
 */

/** Holds the open state: `open` with `onOpenChange`. */
export function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root {...props} />;
}

export interface DialogPopupProps {
  children: ReactNode;
  className?: string;
  /** Element focused when the dialog opens; the first focusable one by default. */
  initialFocus?: RefObject<HTMLElement | null>;
}

/**
 * The sheet: a raised leaf on the workspace ground over a dim scrim. It fades in (opacity
 * only, so nothing moves under reduced motion) and keeps inside the window at every size.
 */
export function DialogPopup({ children, className, initialFocus }: DialogPopupProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-ui="dialog-backdrop"
        className="fixed inset-0 z-40 animate-sprout bg-scrim backdrop-blur-xs"
      />
      <DialogPrimitive.Viewport className="fixed inset-0 z-40 grid place-items-center overflow-y-auto p-6 max-[760px]:p-2">
        <DialogPrimitive.Popup
          data-ui="dialog"
          initialFocus={initialFocus}
          className={cn(
            'relative flex max-h-full w-full min-w-0 animate-sprout flex-col overflow-hidden',
            'rounded-xl border border-line bg-surface text-ink shadow-3 outline-none',
            className,
          )}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

/** The dialog's name; Base UI points `aria-labelledby` at it. */
export function DialogTitle(props: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-ui="dialog-title" {...props} />;
}

/** What the dialog is for; Base UI points `aria-describedby` at it. */
export function DialogDescription(props: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description data-ui="dialog-description" {...props} />;
}

/** Closes the dialog; `render={<Button … />}` keeps a primitive's look. */
export function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-ui="dialog-close" {...props} />;
}
