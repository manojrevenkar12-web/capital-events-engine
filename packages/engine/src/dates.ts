/**
 * Calendar dates as ISO strings (YYYY-MM-DD), arithmetic on day numbers, the TARGET2
 * business-day calendar and the anniversary rule used by the preferred return.
 */
import { EngineError } from "./errors.js";

export type IsoDate = string;

const MS_PER_DAY = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export const dayNumber = (d: IsoDate): number => {
  const m = ISO.exec(d);
  if (!m) throw new EngineError("INVALID_INPUT", `not a date: ${d}`);
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, da);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== da) {
    throw new EngineError("INVALID_INPUT", `not a date: ${d}`);
  }
  return Math.round(t / MS_PER_DAY);
};

export const fromDayNumber = (n: number): IsoDate => new Date(n * MS_PER_DAY).toISOString().slice(0, 10);

/** Calendar days from a to b (negative if b is before a). */
export const days = (a: IsoDate, b: IsoDate): number => dayNumber(b) - dayNumber(a);
export const addDays = (d: IsoDate, n: number): IsoDate => fromDayNumber(dayNumber(d) + n);
export const minDate = (a: IsoDate, b: IsoDate): IsoDate => (dayNumber(a) <= dayNumber(b) ? a : b);
export const maxDate = (a: IsoDate, b: IsoDate): IsoDate => (dayNumber(a) >= dayNumber(b) ? a : b);

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Same month and day n years later; 29 February becomes 28 February in a common year. */
export const addYears = (d: IsoDate, n: number): IsoDate => {
  const [y, m, da] = d.split("-").map(Number) as [number, number, number];
  const ny = y + n;
  const day = m === 2 && da === 29 && !isLeap(ny) ? 28 : da;
  return `${String(ny).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/** Easter Sunday, anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export const easterSunday = (year: number): IsoDate => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const holidayCache = new Map<number, Set<number>>();

const target2Holidays = (year: number): Set<number> => {
  let s = holidayCache.get(year);
  if (!s) {
    const easter = dayNumber(easterSunday(year));
    s = new Set([
      dayNumber(`${year}-01-01`),
      easter - 2,
      easter + 1,
      dayNumber(`${year}-05-01`),
      dayNumber(`${year}-12-25`),
      dayNumber(`${year}-12-26`),
    ]);
    holidayCache.set(year, s);
  }
  return s;
};

export const isBusinessDay = (d: IsoDate): boolean => {
  const n = dayNumber(d);
  const weekday = new Date(n * MS_PER_DAY).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !target2Holidays(Number(d.slice(0, 4))).has(n);
};

/** The date on which the nth business day strictly after d is reached; n = 0 returns d. */
export const addBusinessDays = (d: IsoDate, n: number): IsoDate => {
  if (!Number.isInteger(n) || n < 0) throw new EngineError("INVALID_INPUT", `bad business-day count ${n}`);
  let cur = dayNumber(d);
  let left = n;
  while (left > 0) {
    cur += 1;
    if (isBusinessDay(fromDayNumber(cur))) left -= 1;
  }
  return fromDayNumber(cur);
};

/** Mirror image of addBusinessDays, stepping backwards. */
export const subtractBusinessDays = (d: IsoDate, n: number): IsoDate => {
  if (!Number.isInteger(n) || n < 0) throw new EngineError("INVALID_INPUT", `bad business-day count ${n}`);
  let cur = dayNumber(d);
  let left = n;
  while (left > 0) {
    cur -= 1;
    if (isBusinessDay(fromDayNumber(cur))) left -= 1;
  }
  return fromDayNumber(cur);
};
