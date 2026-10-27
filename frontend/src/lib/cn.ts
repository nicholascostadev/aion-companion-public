import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** Teaches tailwind-merge the design-system scales that are not stock Tailwind names. */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ['1', '2', '3', 'glow'],
      'inset-shadow': ['light', 'well'],
      radius: ['leaf'],
      ease: ['grow', 'spring', 'sway'],
      animate: ['breathe', 'sprout', 'spin', 'grow', 'ripple', 'alight'],
      tracking: ['caps'],
    },
    classGroups: {
      'bg-image': ['bg-hatch', 'bg-ruled', 'bg-parchment'],
      'text-shadow': ['text-halo', 'text-halo-strong'],
    },
  },
});

/**
 * Joins class names and lets later Tailwind utilities win over earlier conflicting ones,
 * so a primitive's defaults can be overridden with a `className` prop.
 */
export function cn(...values: ClassValue[]) {
  return merge(clsx(values));
}
