import { useEffect, useRef, useState } from 'react';
import { AlertPopup } from '../features/alerts/AlertPopup';
import { useClock } from '../features/alerts/useClock';
import { useNativeEvent } from '../hooks/useNativeEvent';
import { useNativePoll } from '../hooks/useNativePoll';
import {
  dismissPopup,
  markPopupReady,
  onPopupDeliveries,
  readAlertsStatus,
  runAlertAction,
} from '../services/alerts';
import { isNative, startWindowDrag } from '../services/companion';
import type { AlertDelivery } from '../types/alerts';

/**
 * Borderless no-activate popup over the game. Native decides what is on screen (fresh
 * popup deliveries, AION focused) and pushes changes; this renders them, expires them
 * on the native clock and sends Dismiss to the engine before clearing the card.
 */
export default function AlertPopupApp() {
  const native = isNative();
  const [items, setItems] = useState<AlertDelivery[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** Native clock minus this PC's clock. */
  const [offset, setOffset] = useState(0);
  const showing = items.length > 0;
  const clock = useClock(1000, showing);

  // Every push carries the whole list and any later change is pushed again, so once one
  // arrived the ready answer, which may have been read before it, is never applied over it.
  const pushed = useRef(false);
  useNativeEvent(
    onPopupDeliveries,
    (next: AlertDelivery[]) => {
      pushed.current = true;
      setItems(next);
    },
    { enabled: native, onError: setError },
  );
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    void markPopupReady().then(
      (next) => !cancelled && !pushed.current && setItems(next),
      (cause: unknown) => !cancelled && setError(String(cause)),
    );
    return () => {
      cancelled = true;
    };
  }, [native]);

  // The lightweight status supplies the native clock, polled only while a card is up.
  useNativePoll(readAlertsStatus, {
    enabled: native && showing,
    intervalMs: 1000,
    onData: (status) => setOffset(status.now_ms - Date.now()),
    onError: () => undefined,
  });

  const drop = async (ids: string[]) => {
    setItems((current) => current.filter((d) => !ids.includes(d.id)));
    await Promise.all(ids.map((id) => dismissPopup(id).catch(() => undefined)));
  };

  const act = async (engine: () => Promise<unknown>, ids: string[]) => {
    if (busy) return;
    setBusy(true);
    try {
      await engine();
      setError('');
      await drop(ids);
    } catch (cause) {
      setError(String(cause));
      await drop(ids);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertPopup
      items={items}
      nowMs={clock + offset}
      busy={busy}
      error={error}
      onDismiss={(d) => void act(() => runAlertAction('dismiss', d.id), [d.id])}
      onDrag={
        native
          ? () => void startWindowDrag().catch((cause: unknown) => setError(String(cause)))
          : undefined
      }
    />
  );
}
