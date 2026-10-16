import type { Lang } from '@/i18n';

const MONTHS: Record<Lang, string[]> = {
  uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const MONTHS_SHORT: Record<Lang, string[]> = {
  uz: ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'],
  ru: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
// index = Date.getDay() (0 = Sunday)
const WEEKDAYS: Record<Lang, string[]> = {
  uz: ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'],
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

export const monthName = (lang: Lang, m: number) => MONTHS[lang][m] ?? '';
export const monthShort = (lang: Lang, m: number) => MONTHS_SHORT[lang][m] ?? '';
export const weekdayName = (lang: Lang, d: number) => WEEKDAYS[lang][d] ?? '';

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** The last `n` calendar days ending today, oldest first (the date strip scrolls to the end = today). */
export function lastDays(n: number, today = new Date()): Date[] {
  const base = startOfDay(today);
  return Array.from({ length: n }, (_, i) => new Date(base.getFullYear(), base.getMonth(), base.getDate() - (n - 1 - i)));
}

/** Timestamp for an operation on `day`: right now when it is today, otherwise noon local time of that day. */
export function occurredAtFor(day: Date, now = new Date()): string {
  if (sameDay(day, now)) return now.toISOString();
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0).toISOString();
}

/** "16 октября 2026, пятница" */
export function longDay(lang: Lang, iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${d.getDate()} ${monthName(lang, d.getMonth())} ${d.getFullYear()}, ${weekdayName(lang, d.getDay())}`;
}

/** Inclusive first/last instant of the month containing `d`, as ISO strings. */
export function monthRange(d: Date): { from: string; to: string } {
  const from = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
