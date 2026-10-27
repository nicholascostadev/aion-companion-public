import { act, cleanup, renderHook } from '@testing-library/react';
import { getI18n } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../services/companion';
import type { Recording, Snapshot } from '../types/companion';
import { useRecording } from './useRecording';

vi.mock('../services/companion', () => ({
  loadRecording: vi.fn<typeof api.loadRecording>(),
  readSnapshot: vi.fn<typeof api.readSnapshot>(),
  saveRecording: vi.fn<typeof api.saveRecording>(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const recording = (source: string): Recording => ({
  schema_version: 1,
  source,
  duration_ms: 10_000,
  events: [],
});
const snapshot = (at_ms: number): Snapshot => ({
  at_ms,
  players: {},
  positions: {},
  counters: [],
  pets: [],
  gaps: [],
});

/** Answers snapshot reads only when the test says so, in the order they were asked. */
function pendingSnapshots() {
  const reads: {
    atMs: number;
    answer: ReturnType<typeof deferred<Snapshot>>;
  }[] = [];
  vi.mocked(api.readSnapshot).mockImplementation((atMs) => {
    const answer = deferred<Snapshot>();
    reads.push({ atMs, answer });
    return answer.promise;
  });
  return reads;
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'],
  });
  vi.mocked(api.loadRecording).mockResolvedValue(recording('demo'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

async function loaded(reads: ReturnType<typeof pendingSnapshots>) {
  const hook = renderHook(() => useRecording(true));
  let done!: Promise<void>;
  act(() => {
    done = hook.result.current.load({ kind: 'demo' });
  });
  await act(async () => {});
  reads[0]!.answer.resolve(snapshot(0));
  await act(async () => {
    await done;
  });
  return hook;
}

describe('recording playback', () => {
  it('keeps one snapshot read in flight and reads the newest position next', async () => {
    const reads = pendingSnapshots();
    const { result } = await loaded(reads);
    expect(result.current.snapshot.at_ms).toBe(0);
    act(() => result.current.togglePlayback());
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(reads).toHaveLength(2);
    // A slow engine: playback moves on, but no read queues behind the one in flight.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.atMs).toBe(600);
    expect(reads).toHaveLength(2);
    await act(async () => {
      reads[1]!.answer.resolve(snapshot(100));
    });
    expect(result.current.snapshot.at_ms).toBe(100);
    expect(reads).toHaveLength(3);
    expect(reads[2]!.atMs).toBe(600);
  });

  it('ends on the position scrubbed to, never an earlier one', async () => {
    const reads = pendingSnapshots();
    const { result } = await loaded(reads);
    act(() => result.current.scrub(5000));
    act(() => result.current.scrub(7000));
    act(() => result.current.scrub(2000));
    expect(reads.map((r) => r.atMs)).toEqual([0, 5000]);
    await act(async () => {
      reads[1]!.answer.resolve(snapshot(5000));
    });
    expect(reads.map((r) => r.atMs)).toEqual([0, 5000, 2000]);
    await act(async () => {
      reads[2]!.answer.resolve(snapshot(2000));
    });
    expect(result.current.atMs).toBe(2000);
    expect(result.current.snapshot.at_ms).toBe(2000);
    expect(reads).toHaveLength(3);
  });

  it('drops a snapshot of the previous recording and an overtaken failure', async () => {
    const reads = pendingSnapshots();
    const { result } = await loaded(reads);
    act(() => result.current.scrub(4000));
    vi.mocked(api.loadRecording).mockResolvedValue(recording('import'));
    let done!: Promise<void>;
    act(() => {
      done = result.current.load({ kind: 'import', json: '{}' });
    });
    await act(async () => {});
    expect(result.current.status).toBe('0 events loaded. Replay mode.');
    // The new recording's first read waits for the old one, which is never shown.
    expect(reads).toHaveLength(2);
    await act(async () => {
      reads[1]!.answer.reject(new Error('old recording'));
    });
    expect(reads.map((r) => r.atMs)).toEqual([0, 4000, 0]);
    await act(async () => {
      reads[2]!.answer.resolve(snapshot(1));
      await done;
    });
    expect(result.current.snapshot.at_ms).toBe(1);
    expect(result.current.status).toBe('0 events loaded. Replay mode.');
    expect(result.current.loading).toBe(false);

    // A failure of the newest read is shown and stops playback.
    act(() => result.current.togglePlayback());
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.playing).toBe(true);
    await act(async () => {
      reads[3]!.answer.reject(new Error('engine gone'));
    });
    expect(result.current.playing).toBe(false);
    expect(result.current.status).toBe('Error: engine gone');
  });
});

describe('recording status in Brazilian Portuguese', () => {
  const events = (count: number): Recording => ({
    ...recording('demo'),
    events: Array.from({ length: count }, (_, at_ms) => ({ kind: 'position', at_ms }) as never),
  });

  it('words and pluralises the status, then rewords it in place on a language switch', async () => {
    await act(async () => {
      await getI18n().changeLanguage('pt-BR');
    });
    vi.mocked(api.readSnapshot).mockResolvedValue(snapshot(0));
    const { result } = renderHook(() => useRecording(true));
    expect(result.current.status).toBe(
      'Nenhuma gravação aberta. Carregue a demonstração, importe uma gravação ou repita um confronto ao vivo.',
    );
    for (const [count, text] of [
      // Brazilian Portuguese counts zero as singular (CLDR "one" covers 0 and 1).
      [0, '0 evento carregado. Modo replay.'],
      [1, '1 evento carregado. Modo replay.'],
      [2, '2 eventos carregados. Modo replay.'],
      [1234, '1.234 eventos carregados. Modo replay.'],
    ] as const) {
      vi.mocked(api.loadRecording).mockResolvedValue(events(count));
      await act(async () => {
        await result.current.load({ kind: 'demo' });
      });
      expect(result.current.status).toBe(text);
    }
    const loaded = result.current.recording;
    await act(async () => {
      await getI18n().changeLanguage('en');
    });
    expect(result.current.status).toBe('1,234 events loaded. Replay mode.');
    expect(result.current.recording).toBe(loaded);
  });

  it('frames the size limit and keeps raw engine errors verbatim', async () => {
    await act(async () => {
      await getI18n().changeLanguage('pt-BR');
    });
    const { result } = renderHook(() => useRecording(true));
    await act(async () => {
      await result.current.importFile({ size: 129 * 1024 * 1024 } as File);
    });
    expect(result.current.status).toBe('Erro: a gravação passa de 128 MiB');
    vi.mocked(api.saveRecording).mockRejectedValue('engine: disk full');
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status).toBe('engine: disk full');
  });
});
