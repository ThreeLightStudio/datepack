import { describe, expect, it } from 'vitest';
import {
  addMinutes,
  floorTo5,
  formatTime,
  isValidDateISO,
  isValidTime,
  minutesOfDay,
  parseTime,
  todayISO,
} from '../src/utils/time';

describe('time utils', () => {
  it('parses HH:mm', () => {
    expect(parseTime('09:34')).toBe(9 * 60 + 34);
    expect(parseTime('22:42')).toBe(22 * 60 + 42);
    expect(parseTime('0:00')).toBe(0);
  });

  it('rejects invalid times', () => {
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('12:60')).toBeNull();
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('12')).toBeNull();
    expect(parseTime('')).toBeNull();
    expect(isValidTime('12:30')).toBe(true);
    expect(isValidTime('25:00')).toBe(false);
  });

  it('formats minutes as HH:mm and wraps a day', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(574)).toBe('09:34');
    expect(formatTime(1440 + 574)).toBe('09:34');
  });

  it('adds minutes across midnight', () => {
    expect(addMinutes('23:50', 20)).toBe('00:10');
    expect(addMinutes('15:30', -9)).toBe('15:21');
  });

  it('floors to 5-minute boundaries (15:21 → 15:20)', () => {
    expect(floorTo5(parseTime('15:21')!)).toBe(parseTime('15:20')!);
    expect(floorTo5(parseTime('15:25')!)).toBe(parseTime('15:25')!);
  });

  it('validates ISO dates', () => {
    expect(isValidDateISO('2026-09-28')).toBe(true);
    expect(isValidDateISO('2026-02-30')).toBe(false);
    expect(isValidDateISO('2026-9-8')).toBe(false);
    expect(isValidDateISO('hello')).toBe(false);
  });

  it('gives local today', () => {
    const now = new Date(2026, 8, 28, 14, 42);
    expect(todayISO(now)).toBe('2026-09-28');
    expect(minutesOfDay(now)).toBe(14 * 60 + 42);
  });
});
