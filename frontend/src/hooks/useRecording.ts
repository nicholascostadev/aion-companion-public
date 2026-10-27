import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormat, useTranslation } from '../i18n/provider';
import { loadRecording, readSnapshot, saveRecording } from '../services/companion';
import type { Recording, RecordingSource, Snapshot } from '../types/companion';

/**
 * What the recording status line says, kept as facts and worded at render so a language
 * change rewords it. `message` is raw text (an engine error or another feature's message).
 */
type RecordingStatus =
  | { kind: 'idle' }
  | { kind: 'preview' }
  | { kind: 'loaded'; events: number }
  | { kind: 'saved'; path: string }
  | { kind: 'tooLarge' }
  | { kind: 'message'; text: string };

/** The import size limit, also named in the too-large message. */
const MAX_IMPORT_MIB = 128;

const emptySnapshot: Snapshot = {
  at_ms: 0,
  players: {},
  positions: {},
  counters: [],
  pets: [],
  gaps: [],
};
const MAX_IMPORT_BYTES = MAX_IMPORT_MIB * 1024 * 1024;
const failed = (error: unknown): RecordingStatus => ({ kind: 'message', text: String(error) });

export function useRecording(native: boolean) {
  const { t } = useTranslation('recordings');
  const fmt = useFormat();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [state, setState] = useState<RecordingStatus>({ kind: native ? 'idle' : 'preview' });
  /** Shows another feature's message (already worded, or raw native text) as the status. */
  const setStatus = useCallback((text: string) => setState({ kind: 'message', text }), []);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [atMs, setAtMs] = useState(0);
  const mounted = useRef(false);
  const loadingRef = useRef(false);
  /** Bumped by every load: snapshots read for an earlier recording are dropped. */
  const epoch = useRef(0);
  const currentTime = useRef(0);
  /** Newest position asked for; `request` numbers every seek. */
  const wanted = useRef<{ time: number; request: number } | null>(null);
  const requests = useRef(0);
  /** The snapshot read loop; `reading` is true while it runs. */
  const reader = useRef<Promise<void>>(Promise.resolve());
  const reading = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Reads one snapshot at a time, then the newest position asked for meanwhile, so playback
   * at 100 ms never queues reads behind a slow engine. Answers arrive in request order;
   * each is shown unless a load replaced the recording. Only the newest seek's failure stops
   * playback, an overtaken one is retried by the newer position.
   */
  const readWanted = useCallback(async () => {
    reading.current = true;
    let done = 0;
    try {
      while (mounted.current && wanted.current && wanted.current.request !== done) {
        const { time, request } = wanted.current;
        const era = epoch.current;
        done = request;
        try {
          const next = await readSnapshot(time);
          if (mounted.current && era === epoch.current) setSnapshot(next);
        } catch (error) {
          if (mounted.current && era === epoch.current && request === requests.current) {
            setPlaying(false);
            setState(failed(error));
          }
        }
      }
    } finally {
      // Cleared in the same turn the loop ends, so a seek right after starts a new one.
      reading.current = false;
    }
  }, []);

  /** Shows `time` at once; resolves once its snapshot (or a newer one) was read. */
  const seek = useCallback(
    (time: number) => {
      currentTime.current = time;
      setAtMs(time);
      wanted.current = { time, request: ++requests.current };
      if (!reading.current) reader.current = readWanted();
      return reader.current;
    },
    [readWanted],
  );

  const load = useCallback(
    async (source: RecordingSource) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setPlaying(false);
      ++epoch.current;
      wanted.current = null;
      try {
        const next = await loadRecording(source);
        if (!mounted.current) return;
        setRecording(next);
        setSnapshot(emptySnapshot);
        setState({ kind: 'loaded', events: next.events.length });
        await seek(0);
      } catch (error) {
        if (mounted.current) setState(failed(error));
      } finally {
        loadingRef.current = false;
        if (mounted.current) setLoading(false);
      }
    },
    [seek],
  );

  useEffect(() => {
    if (!playing || !recording) return;
    const start = performance.now() - currentTime.current;
    const timer = setInterval(() => {
      const time = Math.min(recording.duration_ms, Math.floor(performance.now() - start));
      void seek(time);
      if (time >= recording.duration_ms) setPlaying(false);
    }, 100);
    return () => clearInterval(timer);
  }, [playing, recording, seek]);

  function togglePlayback() {
    if (!recording) return;
    if (!playing && currentTime.current >= recording.duration_ms) void seek(0);
    setPlaying((value) => !value);
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setState({ kind: 'tooLarge' });
      return;
    }
    try {
      await load({ kind: 'import', json: await file.text() });
    } catch (error) {
      if (mounted.current) setState(failed(error));
    }
  }

  async function save() {
    try {
      const path = await saveRecording();
      if (mounted.current) setState({ kind: 'saved', path });
    } catch (error) {
      if (mounted.current) setState(failed(error));
    }
  }

  const status = (() => {
    switch (state.kind) {
      case 'idle':
        return t(($) => $.status.idle);
      case 'preview':
        return t(($) => $.status.preview);
      case 'loaded':
        return t(($) => $.status.loaded, { count: state.events });
      case 'saved':
        return t(($) => $.status.saved, { path: state.path });
      case 'tooLarge':
        return t(($) => $.status.tooLarge, { limit: fmt.integer.format(MAX_IMPORT_MIB) });
      case 'message':
        return state.text;
    }
  })();

  return {
    recording,
    snapshot,
    status,
    setStatus,
    loading,
    playing,
    atMs,
    load,
    togglePlayback,
    importFile,
    save,
    scrub: (time: number) => {
      setPlaying(false);
      void seek(time);
    },
  };
}
