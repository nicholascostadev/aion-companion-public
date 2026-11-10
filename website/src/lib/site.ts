/** Links and copy shared across the page. Facts mirror the repository README. */
export const REPO_URL = 'https://github.com/nicholascostadev/aion-companion-public';
export const DOWNLOAD_URL = `${REPO_URL}/releases/latest`;

/** Public asset path that respects the deploy base (GitHub Pages serves under a sub-path). */
export function asset(path: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}

/**
 * Full URL for social cards and alternate-language links, which must be absolute. The deploy sets
 * VITE_SITE_ORIGIN (such as https://owner.github.io); local builds fall back to the path alone.
 */
export function absoluteUrl(path: string) {
  const origin = (import.meta.env.VITE_SITE_ORIGIN as string | undefined) ?? '';
  return `${origin.replace(/\/$/, '')}${asset(path)}`;
}
