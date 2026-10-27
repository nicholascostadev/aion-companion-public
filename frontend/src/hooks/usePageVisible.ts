import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};
const read = () => document.visibilityState !== 'hidden';

/**
 * False while the page is hidden (e.g. the workspace minimised), so polls that only feed
 * the screen can stop; they read again at once when it shows. Where the webview never
 * reports hidden this stays true and nothing changes.
 */
export function usePageVisible() {
  return useSyncExternalStore(subscribe, read, () => true);
}
