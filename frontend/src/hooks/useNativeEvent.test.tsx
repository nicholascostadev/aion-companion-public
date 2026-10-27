import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNativeEvent, type Subscribe } from './useNativeEvent';

afterEach(cleanup);

/** A subscription whose registration completes only when the test says so. */
function controlledSubscription() {
  let emit: (payload: string) => void = () => undefined;
  let register!: () => void;
  let fail!: (cause: unknown) => void;
  const unsubscribe = vi.fn<() => void>();
  const subscribe = vi.fn<Subscribe<string>>(
    (handler) =>
      new Promise((resolve, reject) => {
        emit = handler;
        register = () => resolve(unsubscribe);
        fail = reject;
      }),
  );
  return {
    subscribe,
    unsubscribe,
    emit: (payload: string) => emit(payload),
    register: () => register(),
    fail: (cause: unknown) => fail(cause),
  };
}

describe('native event subscription', () => {
  it('delivers events to the newest handler and unsubscribes on unmount', async () => {
    const sub = controlledSubscription();
    const first = vi.fn<(payload: string) => void>();
    const second = vi.fn<(payload: string) => void>();
    const { rerender, unmount } = renderHook(
      ({ handler }) => useNativeEvent(sub.subscribe, handler, { enabled: true }),
      { initialProps: { handler: first } },
    );
    await act(async () => sub.register());
    rerender({ handler: second });
    sub.emit('alerts');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('alerts');
    expect(sub.subscribe).toHaveBeenCalledOnce();
    unmount();
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
    sub.emit('late');
    expect(second).toHaveBeenCalledOnce();
  });

  it('removes a listener that registers only after the component is gone', async () => {
    const sub = controlledSubscription();
    const handler = vi.fn<(payload: string) => void>();
    const { unmount } = renderHook(() => useNativeEvent(sub.subscribe, handler, { enabled: true }));
    unmount();
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    await act(async () => sub.register());
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
    sub.emit('after unmount');
    expect(handler).not.toHaveBeenCalled();
  });

  it('subscribes only while enabled and reports a failed registration', async () => {
    const sub = controlledSubscription();
    const onError = vi.fn<(message: string) => void>();
    const { rerender } = renderHook(
      ({ enabled }) => useNativeEvent(sub.subscribe, () => undefined, { enabled, onError }),
      { initialProps: { enabled: false } },
    );
    expect(sub.subscribe).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await act(async () => sub.fail(new Error('denied')));
    expect(onError).toHaveBeenCalledWith('Error: denied');
  });
});
