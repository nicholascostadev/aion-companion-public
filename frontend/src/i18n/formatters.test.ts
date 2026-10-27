import { describe, expect, it } from 'vitest';
import { clock, formattersFor, UNKNOWN } from './formatters';

const en = formattersFor('en');
const pt = formattersFor('pt-BR');
const AT = Date.UTC(2026, 9, 19, 14, 5, 9);

describe('locale formatters', () => {
  it('are created once per language', () => {
    expect(formattersFor('en')).toBe(en);
    expect(formattersFor('pt-BR')).toBe(pt);
    expect(en.numberWith({ maximumFractionDigits: 3 })).toBe(
      en.numberWith({ maximumFractionDigits: 3 }),
    );
  });

  it('formats numbers with each language’s separators', () => {
    expect(en.number.format(12345.67)).toBe('12,345.7');
    expect(pt.number.format(12345.67)).toBe('12.345,7');
    expect(en.integer.format(1234567)).toBe('1,234,567');
    expect(pt.integer.format(1234567)).toBe('1.234.567');
    expect(en.compact.format(12300)).toBe('12.3K');
  });

  it('formats compact numbers in English notation for every language', () => {
    const cases: [number, string][] = [
      [0, '0'],
      [999, '999'],
      [1000, '1K'],
      [1500, '1.5K'],
      [12_340, '12.3K'],
      [999_499, '999.5K'],
      [1_250_000, '1.3M'],
      [4_000_000_000, '4B'],
      [7_100_000_000_000, '7.1T'],
      [-2_500, '-2.5K'],
    ];
    for (const [value, text] of cases) {
      expect(en.compact.format(value)).toBe(text);
      expect(pt.compact.format(value)).toBe(text);
    }
    // Every compact formatter, not only the shared one; standard notation stays localised.
    const signed = pt.numberWith({
      notation: 'compact',
      maximumFractionDigits: 1,
      signDisplay: 'exceptZero',
    });
    expect(signed.format(2500)).toBe('+2.5K');
    expect(pt.numberWith({ notation: 'standard', maximumFractionDigits: 2 }).format(9876.5)).toBe(
      '9.876,5',
    );
  });

  it('formats percentages, seconds and unknown values', () => {
    expect(en.pct(0.421)).toBe('42.1%');
    expect(pt.pct(0.421)).toBe('42,1%');
    expect(en.pct(null)).toBe(UNKNOWN);
    expect(en.seconds(3250)).toBe('3.25s');
    expect(pt.seconds(3250)).toBe('3,25s');
    expect(pt.seconds(12_500)).toBe('12,5s');
    expect(en.maybe(undefined)).toBe(UNKNOWN);
    expect(pt.maybe(1500, pt.compact)).toBe('1.5K');
    expect(pt.maybe(null, pt.compact)).toBe(UNKNOWN);
  });

  it('keeps m:ss clocks and localises only the decimal and units', () => {
    expect(clock(64_300)).toBe('1:04');
    expect(en.preciseClock(64_300)).toBe('1:04.3');
    expect(pt.preciseClock(64_300)).toBe('1:04,3');
    expect(en.countdown(3_400)).toBe('3.4s');
    expect(pt.countdown(3_400)).toBe('3,4s');
    expect(en.countdown(42_000)).toBe('42s');
    expect(en.countdown(65_000)).toBe('1:05');
    expect(en.countdown(2 * 3_600_000 + 5 * 60_000)).toBe('2h 05m');
    expect(pt.countdown(2 * 3_600_000 + 5 * 60_000)).toBe('2h 05min');
    expect(en.countdown(-1)).toBe('0s');
  });

  it('formats dates in the language, keeping an explicit time zone', () => {
    const utc = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' } as const;
    expect(en.dateTimeWith(utc).format(AT)).toBe('Oct 19, 2026, 2:05 PM');
    expect(pt.dateTimeWith(utc).format(AT)).toBe('19 de out. de 2026, 14:05');
    expect(en.dateTime(null)).toBe(UNKNOWN);
    expect(en.list(['a', 'b', 'c'])).toBe('a, b, and c');
    expect(pt.list(['a', 'b', 'c'])).toBe('a, b e c');
  });
});
