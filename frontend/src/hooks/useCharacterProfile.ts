import { useCallback, useEffect, useRef, useState } from 'react';
import { readBoard, readCharacterSheet, readItemDetail } from '../services/profile';
import type {
  Board,
  CharacterSheet,
  EquippedItem,
  ItemDetail,
  Lazy,
  ProfileError,
  ProfileSelection,
} from '../types/profile';

/** The detail key of an equipped item: the same ring in two slots is two details. */
export const itemKey = (item: Pick<EquippedItem, 'id' | 'slot' | 'enchant' | 'breakthrough'>) =>
  `${item.id}@${item.slot}+${item.enchant + item.breakthrough}`;

const failed = <T>(error: unknown, data: T | null): Lazy<T> => ({
  state: 'error',
  error: error as ProfileError,
  data,
});

/**
 * The details read for one sheet answer: whose they are, which are in flight or answered
 * (each is asked for once), and whether they follow a Refresh, which bypasses native's cache.
 */
interface DetailRun {
  owner: { selection: ProfileSelection; lang: string; id: string } | null;
  pending: Set<string>;
  answered: Set<string>;
  refresh: boolean;
}
const detailRun = (owner: DetailRun['owner'], refresh: boolean): DetailRun => ({
  owner,
  pending: new Set(),
  answered: new Set(),
  refresh,
});

/**
 * One character's official profile for the window's current selection. Requests run only
 * on open, refresh and when a detail is shown; answers for an earlier selection or language
 * are dropped, so a slow lookup can never replace a newer character.
 *
 * Every sheet answer starts a new detail run and new `loadItem`/`loadBoard` functions, so a
 * view that reads its shown detail in an effect keyed on the loader reads it again, from
 * the service, after a Refresh. Until the refreshed sheet arrives the previous details stay.
 */
export function useCharacterProfile(selection: ProfileSelection | null, lang: string) {
  const [sheet, setSheet] = useState<Lazy<CharacterSheet> | null>(null);
  const [items, setItems] = useState<Record<string, Lazy<ItemDetail>>>({});
  const [boards, setBoards] = useState<Record<number, Lazy<Board>>>({});
  /** Identifies the selection and language every sheet answer must still belong to. */
  const generation = useRef(0);
  const [run, setRun] = useState<DetailRun>(() => detailRun(null, false));
  /** The run detail answers must still belong to; replaced before the state catches up. */
  const live = useRef(run);

  /** Reads the sheet; the caller has already shown its loading state. */
  const request = useCallback(
    (refresh: boolean) => {
      if (!selection) return;
      const mine = ++generation.current;
      readCharacterSheet(selection, lang, refresh).then(
        (next) => {
          if (generation.current !== mine) return;
          const fresh = detailRun({ selection, lang, id: next.identity.characterId }, refresh);
          live.current = fresh;
          setRun(fresh);
          setItems({});
          setBoards({});
          setSheet({ state: 'ready', data: next });
        },
        (error: unknown) => {
          if (generation.current !== mine) return;
          setSheet((previous) => failed(error, refresh ? (previous?.data ?? null) : null));
        },
      );
    },
    [selection, lang],
  );

  // A new selection (or language) starts from nothing: no detail of the last one survives.
  const key = selection
    ? `${selection.revision}|${selection.server_id}|${selection.name}|${lang}`
    : null;
  const [shown, setShown] = useState<string | null>(null);
  if (shown !== key) {
    setShown(key);
    setItems({});
    setBoards({});
    setSheet(key ? { state: 'loading', data: null } : null);
  }
  useEffect(() => {
    // Loaders of the previous selection go quiet until this one's sheet starts a new run.
    live.current = detailRun(null, false);
    if (selection) request(false);
    else generation.current++;
  }, [selection, request]);

  const reload = (refresh: boolean) => {
    setSheet((previous) => ({
      state: 'loading',
      data: refresh ? (previous?.data ?? null) : null,
    }));
    request(refresh);
  };

  /**
   * Starts one detail request of this run unless it is in flight or answered (`again`
   * asks once more). The answer lands only while this run is still the live one; its own
   * bookkeeping is the run's, so an older run's answer never clears a newer request.
   */
  const begin = useCallback(
    (tag: string, again: boolean) => {
      const { owner, pending, answered } = run;
      if (live.current !== run || !owner || pending.has(tag) || (!again && answered.has(tag)))
        return null;
      pending.add(tag);
      return {
        owner,
        refresh: again || run.refresh,
        settle: (ok: boolean) => {
          pending.delete(tag);
          if (ok) answered.add(tag);
          return live.current === run;
        },
      };
    },
    [run],
  );

  const loadItem = useCallback(
    (item: EquippedItem, again = false) => {
      const key = itemKey(item);
      const started = begin(`i${key}`, again);
      if (!started) return;
      const { owner, settle } = started;
      setItems((all) => ({ ...all, [key]: { state: 'loading', data: all[key]?.data ?? null } }));
      readItemDetail(owner.selection, owner.lang, owner.id, item, started.refresh).then(
        (detail) => {
          if (settle(true))
            setItems((all) => ({ ...all, [key]: { state: 'ready', data: detail } }));
        },
        (error: unknown) => {
          if (settle(false))
            setItems((all) => ({ ...all, [key]: failed(error, all[key]?.data ?? null) }));
        },
      );
    },
    [begin],
  );

  const loadBoard = useCallback(
    (boardId: number, again = false) => {
      const started = begin(`b${boardId}`, again);
      if (!started) return;
      const { owner, settle } = started;
      setBoards((all) => ({
        ...all,
        [boardId]: { state: 'loading', data: all[boardId]?.data ?? null },
      }));
      readBoard(owner.selection, owner.lang, owner.id, boardId, started.refresh).then(
        (board) => {
          if (settle(true))
            setBoards((all) => ({ ...all, [boardId]: { state: 'ready', data: board } }));
        },
        (error: unknown) => {
          if (settle(false))
            setBoards((all) => ({ ...all, [boardId]: failed(error, all[boardId]?.data ?? null) }));
        },
      );
    },
    [begin],
  );

  return {
    sheet,
    items,
    boards,
    refresh: () => reload(true),
    retry: () => reload(false),
    loadItem,
    loadBoard,
  };
}

export type CharacterProfile = ReturnType<typeof useCharacterProfile>;
