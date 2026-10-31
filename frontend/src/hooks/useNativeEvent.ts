import { useEffect, useRef } from 'react';

/** Starts a native event subscription; resolves to its unsubscribe once it is registered. */
export type Subscribe<T> = (handler: (payload: T) => void) => Promise<() => void>;

interface Options {
  /** Subscribes only while true. */
  enabled: boolean;
  /** A subscription that could not be registered. */
  onError?: (message: string) => void;
  /**
   * The subscription is registered: events from here on are delivered, so a read started now
   * misses nothing (native does not replay what was sent before).
   */
  onReady?: () => void;
}

/**
 * Keeps one native event subscription for as long as the component is mounted and
 * `enabled`. Registration is asynchronous, so an unmount that happens first still removes
 * the listener once it arrives, and no event is delivered after cleanup. `subscribe` must
 * be stable (a service function); `handler` and `onError` may change on every render.
 */
export function useNativeEvent<T>(
  subscribe: Subscribe<T>,
  handler: (payload: T) => void,
  { enabled, onError, onReady }: Options,
) {
  const handlers = useRef({ handler, onError, onReady });
  useEffect(() => {
    handlers.current = { handler, onError, onReady };
  });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void subscribe((payload) => {
      if (active) handlers.current.handler(payload);
    }).then(
      (stop) => {
        if (!active) {
          stop();
          return;
        }
        unsubscribe = stop;
        handlers.current.onReady?.();
      },
      (cause: unknown) => {
        if (active) handlers.current.onError?.(String(cause));
      },
    );
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [enabled, subscribe]);
}
