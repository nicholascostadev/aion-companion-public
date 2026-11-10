import { describe, expect, it } from 'vitest';
import {
  begin,
  CHAPTERS,
  decide,
  finish,
  finishBlocks,
  homeOffers,
  languageSaved,
  neighbours,
  opensByItself,
  parseProgress,
  quiet,
  resumeAt,
  serializeProgress,
  stepState,
  visit,
  type Decisions,
  type SetupFacts,
} from './model';

const ready: SetupFacts = { captureReady: true, alertsOn: true, petsOn: true, exploreOn: true };
const allDone: Decisions = {
  language: 'done',
  capture: 'done',
  meter: 'done',
  inspect: 'done',
  profiles: 'done',
  alerts: 'done',
  pets: 'done',
  explore: 'done',
  updates: 'done',
};

describe('guide progress', () => {
  it('starts with the language, then resumes where the reader left off', () => {
    expect(CHAPTERS[0]).toBe('language');
    expect(begin(null)).toEqual({
      chapter: 'language',
      seen: ['language'],
      decisions: {},
      finished: false,
      quiet: false,
    });
    let p = decide(begin(null), 'language', 'done');
    expect(p.chapter).toBe('capture');
    p = visit(p, 'alerts');
    expect(begin(p).chapter).toBe('alerts');
    expect(begin(p, 'meter').chapter).toBe('meter');
    expect(visit(p, 'alerts')).toBe(p);
  });

  it('records only the decisions a step allows, then moves on', () => {
    const p = decide(begin(null), 'capture', 'later');
    expect(p.decisions.capture).toBe('later');
    expect(p.chapter).toBe('meter');
    // Required steps cannot be skipped, and only capture can wait for later.
    expect(decide(p, 'language', 'skipped')).toBe(p);
    expect(decide(p, 'alerts', 'later')).toBe(p);
    expect(decide(p, 'updates', 'done').chapter).toBe('review');
  });

  it('survives a round trip through storage and ignores what it cannot trust', () => {
    const p = finish(decide(decide(begin(null), 'language', 'done'), 'pets', 'skipped'));
    expect(parseProgress(serializeProgress(p))).toEqual(p);
    expect(parseProgress(null)).toBeNull();
    expect(parseProgress('not json')).toBeNull();
    expect(parseProgress(JSON.stringify({ version: 3, chapter: 'meter' }))).toBeNull();
    expect(parseProgress(JSON.stringify({ version: 2, chapter: 'nowhere' }))).toBeNull();
    expect(
      parseProgress(
        JSON.stringify({
          version: 2,
          chapter: 'pets',
          seen: ['gone'],
          decisions: { pets: 'skipped', language: 'skipped', bogus: 'done' },
        }),
      )?.decisions,
    ).toEqual({ pets: 'skipped' });
  });

  it('keeps progress from before the language step, and asks for the language once', () => {
    const v1 = (finished: boolean) =>
      parseProgress(
        JSON.stringify({
          version: 1,
          chapter: 'alerts',
          seen: ['capture'],
          finished,
          quiet: false,
        }),
      );
    const kept = v1(false)!;
    expect(kept).toEqual({
      chapter: 'alerts',
      seen: ['capture', 'alerts'],
      decisions: {},
      finished: false,
      quiet: false,
    });
    // Home names the step Resume opens: Language, every time until one is chosen.
    expect(resumeAt(kept)).toBe('language');
    const opened = begin(kept);
    expect(opened.chapter).toBe('language');
    expect(resumeAt(visit(opened, 'meter'))).toBe('language');
    // Once chosen, it is not asked again.
    expect(begin(visit(decide(opened, 'language', 'done'), 'pets')).chapter).toBe('pets');
    // A guide finished before is never sent back to it, and stays finished.
    const done = v1(true)!;
    expect(done.finished).toBe(true);
    expect(begin(done).chapter).toBe('alerts');
    expect(resumeAt(done)).toBe('alerts');
    expect(homeOffers(done)).toBe(false);
  });

  it('opens by itself only on a first run with no saved fights, once known', () => {
    expect(opensByItself(null, 0)).toBe(true);
    expect(opensByItself(null, null)).toBe(false);
    expect(opensByItself(null, 3)).toBe(false);
    expect(opensByItself(begin(null), 0)).toBe(false);
  });

  it('is offered on Home until finished or put away', () => {
    expect(homeOffers(null)).toBe(true);
    expect(homeOffers(begin(null))).toBe(true);
    expect(homeOffers(quiet(begin(null)))).toBe(false);
    expect(homeOffers(finish(begin(null)))).toBe(false);
    expect(quiet(null)).toEqual({
      chapter: 'language',
      seen: [],
      decisions: {},
      finished: false,
      quiet: true,
    });
  });

  it('knows each step’s neighbours', () => {
    expect(neighbours('language')).toEqual({ index: 0, previous: null, next: 'capture' });
    expect(neighbours('review')).toEqual({
      index: CHAPTERS.length - 1,
      previous: 'updates',
      next: null,
    });
  });
});

describe('readiness', () => {
  it('judges capture by the app, never by the decision alone', () => {
    const off = { ...ready, captureReady: false };
    expect(stepState('capture', { capture: 'done' }, off)).toBe('todo');
    expect(stepState('capture', { capture: 'later' }, off)).toBe('deferred');
    expect(stepState('capture', {}, ready)).toBe('ready');
  });

  it('counts an optional feature as set up only while it is really on', () => {
    expect(stepState('alerts', { alerts: 'done' }, ready)).toBe('ready');
    expect(stepState('alerts', { alerts: 'done' }, { ...ready, alertsOn: false })).toBe('todo');
    expect(stepState('pets', { pets: 'done' }, { ...ready, petsOn: null })).toBe('todo');
    expect(stepState('pets', { pets: 'done' }, { ...ready, petsOn: false })).toBe('todo');
    expect(stepState('explore', { explore: 'skipped' }, { ...ready, exploreOn: false })).toBe(
      'skipped',
    );
    expect(stepState('alerts', {}, ready)).toBe('todo');
  });

  it('finishes only with every step resolved, nothing saving and no error', () => {
    expect(finishBlocks(allDone, ready)).toEqual([]);
    const skipped: Decisions = { ...allDone, alerts: 'skipped', pets: 'skipped' };
    expect(finishBlocks(skipped, { ...ready, alertsOn: false, petsOn: null })).toEqual([]);
    expect(
      finishBlocks(allDone, ready, {
        meter: { pending: true, problem: false },
        alerts: { pending: false, problem: true },
      }),
    ).toEqual([
      { kind: 'saving', steps: ['meter'] },
      { kind: 'problem', steps: ['alerts'] },
    ]);
    expect(
      finishBlocks({ ...allDone, capture: 'later' }, { ...ready, captureReady: false }),
    ).toEqual([{ kind: 'deferred', steps: ['capture'] }]);
    const undecided: Decisions = { ...allDone };
    delete undecided.meter;
    delete undecided.pets;
    expect(finishBlocks(undecided, ready)).toEqual([
      { kind: 'undecided', steps: ['meter', 'pets'] },
    ]);
  });

  it('keeps a problem on its own step, and not once an optional feature is skipped', () => {
    const failing = { pending: false, problem: true };
    const skipped: Decisions = { ...allDone, pets: 'skipped', explore: 'skipped' };
    // A skipped feature's read error stays on its step and never holds the guide back.
    expect(stepState('pets', skipped, ready, { pets: failing })).toBe('skipped');
    expect(finishBlocks(skipped, ready, { pets: failing, explore: failing })).toEqual([]);
    // Used, the same error blocks, on that step only.
    expect(stepState('pets', allDone, ready, { pets: failing })).toBe('problem');
    expect(stepState('alerts', allDone, ready, { pets: failing })).toBe('ready');
    // A required or settings step cannot be skipped past its problem.
    expect(finishBlocks(allDone, ready, { inspect: failing })).toEqual([
      { kind: 'problem', steps: ['inspect'] },
    ]);
  });

  it('claims nothing while a change is in flight, even on a skipped step', () => {
    const saving = { pending: true, problem: false };
    expect(stepState('alerts', allDone, ready, { alerts: saving })).toBe('saving');
    const skipped: Decisions = { ...allDone, explore: 'skipped' };
    expect(stepState('explore', skipped, ready, { explore: saving })).toBe('saving');
    expect(finishBlocks(skipped, ready, { explore: saving })).toEqual([
      { kind: 'saving', steps: ['explore'] },
    ]);
  });

  it('knows when the chosen language is already the saved one', () => {
    expect(languageSaved('pt-BR', 'pt-BR')).toBe(true);
    expect(languageSaved('pt', 'pt-BR')).toBe(true);
    expect(languageSaved('de', 'en')).toBe(false);
    expect(languageSaved('en', 'pt-BR')).toBe(false);
  });
});
