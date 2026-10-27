import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Field as FieldPrimitive } from '@base-ui/react/field';
import { Input as InputPrimitive } from '@base-ui/react/input';
import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/cn';
import { focusRing } from './Button';
import { Icon } from './Icon';

/** Shared look of every text-like control: a shallow well in the ground. */
export const controlClasses = cn(
  'min-w-0 rounded-md border border-line-strong bg-sunken text-sm text-ink',
  'inset-shadow-well transition-[border-color,box-shadow] duration-150 ease-grow',
  'placeholder:text-ink-4 enabled:hover:border-ink-4',
  'focus-visible:border-accent-line focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
  'aria-invalid:border-danger disabled:cursor-default disabled:opacity-50',
);

const heights = { sm: 'h-7 px-2 text-xs', md: 'h-8 px-2.5' } as const;

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: keyof typeof heights;
  ref?: Ref<HTMLInputElement>;
}

/**
 * Text, number, search, date and range-free inputs: Base UI's `Input`, a native `<input>`
 * (native `onChange` and `value` as ever) that a `Field` labels, describes and marks invalid.
 */
export function Input({ size = 'md', className, ref, ...props }: InputProps) {
  return (
    <InputPrimitive
      data-ui="input"
      ref={ref as Ref<HTMLElement> | undefined}
      className={cn(controlClasses, heights[size], className)}
      // An input named by its own aria-label (a search box beside a Field's select) keeps that
      // name; Base UI would otherwise label every input inside a Field by the Field's label.
      {...(props['aria-label'] ? { 'aria-labelledby': undefined } : {})}
      {...props}
    />
  );
}

/**
 * Search field led by a magnifier. Name it with `aria-label` (or a `<label>`); the
 * wrapper takes width and layout through `wrapperClassName`.
 */
export function SearchInput({
  wrapperClassName,
  className,
  ...props
}: Omit<InputProps, 'type'> & { wrapperClassName?: string }) {
  return (
    <span className={cn('relative flex min-w-0', wrapperClassName)}>
      <Icon
        name="search"
        size={14}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3"
      />
      <Input type="search" className={cn('w-full pl-8', className)} {...props} />
    </span>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      data-ui="textarea"
      className={cn(controlClasses, 'min-h-16 px-2.5 py-1.5 leading-snug', className)}
      {...props}
    />
  );
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: keyof typeof heights;
  /** Classes for the wrapper, which carries width and layout. */
  wrapperClassName?: string;
  ref?: Ref<HTMLSelectElement>;
}

/**
 * Native select with a quiet chevron, like shadcn's `NativeSelect`: the OS list keeps its
 * keyboard, type-ahead and accessibility, and it opens beyond the edges of a small in-game
 * window, where an in-page list would be cut off.
 */
export function Select({ size = 'md', className, wrapperClassName, ...props }: SelectProps) {
  return (
    <span className={cn('relative inline-flex min-w-0 max-w-full', wrapperClassName)}>
      <select
        data-ui="select"
        className={cn(
          controlClasses,
          heights[size],
          'w-full cursor-pointer appearance-none pr-7',
          className,
        )}
        {...props}
      />
      <Icon
        name="chevronDown"
        size={14}
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ink-3"
      />
    </span>
  );
}

export interface CheckboxProps extends Omit<
  CheckboxPrimitive.Root.Props,
  'className' | 'style' | 'render'
> {
  label?: ReactNode;
  hint?: ReactNode;
  className?: string;
}

/**
 * Checkbox with a written label; clicking the text toggles it. Base UI's `Checkbox`: a
 * `role="checkbox"` box (aria-checked, `mixed` while `indeterminate`) with a hidden native
 * input for forms. Read the choice from `onCheckedChange(checked)`.
 */
export function Checkbox({ label, hint, className, disabled, ...props }: CheckboxProps) {
  const box = (
    <CheckboxPrimitive.Root
      data-ui="checkbox"
      disabled={disabled}
      className={cn(
        'relative inline-grid size-4 shrink-0 cursor-pointer place-items-center rounded-xs border border-line-strong bg-sunken',
        'transition-[background-color,border-color] duration-150 ease-grow',
        'data-checked:border-accent data-checked:bg-accent not-data-disabled:hover:border-ink-4',
        focusRing,
        'data-disabled:cursor-default data-disabled:opacity-50',
        !label && className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        keepMounted
        className="pointer-events-none flex scale-50 text-accent-ink opacity-0 transition-[opacity,scale] duration-200 ease-spring data-checked:scale-100 data-checked:opacity-100"
      >
        <Icon name="check" size={12} strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (!label) return box;
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-start gap-2 text-sm text-ink-2',
        disabled && 'cursor-default opacity-60',
        className,
      )}
    >
      <span className="mt-0.5">{box}</span>
      <span className="flex flex-col gap-px">
        <span className="text-ink">{label}</span>
        {hint && <small className="text-2xs text-ink-3">{hint}</small>}
      </span>
    </label>
  );
}

const track = cn(
  'relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border border-line-strong bg-surface-hover',
  'transition-[background-color,border-color] duration-200 ease-grow',
);
const thumb = cn(
  'absolute left-0.5 size-3 rounded-full bg-ink-2 shadow-1',
  'transition-[translate,background-color] duration-300 ease-spring',
);

/**
 * The visual track and thumb of a switch; `on` drives it. Decorative, for a control that
 * already is the switch (`WindowSwitch`).
 */
export function SwitchTrack({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-on={on || undefined}
      className={cn(track, 'data-on:border-accent data-on:bg-accent', className)}
    >
      <span className={cn(thumb, on && 'translate-x-3.5 bg-accent-ink')} />
    </span>
  );
}

export interface SwitchProps extends Omit<
  SwitchPrimitive.Root.Props,
  'className' | 'style' | 'render' | 'checked' | 'onCheckedChange' | 'defaultChecked'
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Written label. Omit only for a bare switch in a row that names it, with an aria-label. */
  label?: ReactNode;
  hint?: ReactNode;
  className?: string;
}

/**
 * On/off setting that applies immediately: Base UI's `Switch` (`role="switch"`,
 * aria-checked) drawn as the track itself. Without a `label` only the track shows (pass an
 * `aria-label`), e.g. leading a list row.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled,
  className,
  ...props
}: SwitchProps) {
  return (
    <label
      className={cn(
        'group/switch inline-flex min-w-0 max-w-full cursor-pointer items-start gap-2.5',
        disabled && 'cursor-default',
        className,
      )}
    >
      <SwitchPrimitive.Root
        data-ui="switch"
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next)}
        disabled={disabled}
        className={cn(
          'peer mt-px',
          track,
          'data-checked:border-accent data-checked:bg-accent data-disabled:opacity-45',
          focusRing,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(thumb, 'data-checked:translate-x-3.5 data-checked:bg-accent-ink')}
        />
      </SwitchPrimitive.Root>
      {(label || hint) && (
        <span className="flex min-w-0 flex-col gap-px text-sm break-words text-ink peer-data-disabled:opacity-60">
          {label}
          {hint && <small className="text-2xs text-ink-3">{hint}</small>}
        </span>
      )}
    </label>
  );
}

/**
 * Label, control, then a hint or an error: Base UI's `Field`. The control is rendered by
 * `children(id)` so the label is wired to it; a Base UI control inside (`Input`, `Checkbox`,
 * `Switch`) is also described by the hint or error and marked `aria-invalid`. An error
 * replaces the hint and is announced.
 */
export function Field({
  label,
  hint,
  error,
  children,
  wide = false,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  children: (id: string) => ReactNode;
  /** Span every column of a form grid. */
  wide?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <FieldPrimitive.Root
      data-ui="field"
      invalid={Boolean(error)}
      className={cn(
        'flex min-w-0 flex-col gap-1.5',
        'data-invalid:[&_input]:border-danger data-invalid:[&_select]:border-danger',
        wide && 'col-span-full',
        className,
      )}
    >
      <FieldPrimitive.Label htmlFor={id} className="text-xs font-semibold text-ink-2">
        {label}
      </FieldPrimitive.Label>
      {children(id)}
      {error ? (
        <FieldPrimitive.Error
          match
          render={<small />}
          className="text-2xs text-danger"
          role="alert"
        >
          {error}
        </FieldPrimitive.Error>
      ) : (
        hint && (
          <FieldPrimitive.Description render={<small />} className="text-2xs text-ink-3">
            {hint}
          </FieldPrimitive.Description>
        )
      )}
    </FieldPrimitive.Root>
  );
}
