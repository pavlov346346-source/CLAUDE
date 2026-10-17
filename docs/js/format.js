// Даты, деньги и русские склонения

export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const pad = (n) => String(n).padStart(2, '0');

export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
export const today = () => ymd(new Date());
export const ymOf = (s) => s.slice(0, 7);
export const addDays = (s, n) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1, 12);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
export const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};
export const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
export const mondayOf = (s) => {
  const d = parseYmd(s);
  return addDays(s, -((d.getDay() + 6) % 7));
};

export function monthTitle(ym, withYear = true) {
  const [y, m] = ym.split('-').map(Number);
  const cur = new Date().getFullYear();
  return MONTHS[m - 1] + (withYear || y !== cur ? ' ' + y : '');
}

export function dayTitle(s) {
  const t = today();
  if (s === t) return 'Сегодня';
  if (s === addDays(t, -1)) return 'Вчера';
  const d = parseYmd(s);
  const year = d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '';
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${year}, ${WEEKDAYS[d.getDay()]}`;
}

export function shortDate(s) {
  const d = parseYmd(s);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// суммы храним в копейках (целое число)
export function num(cents) {
  return cents % 100 === 0 ? nf0.format(cents / 100) : nf2.format(cents / 100);
}

export function money(cents, cur) {
  return num(cents) + ' ' + cur;
}

export function compact(cents) {
  const v = cents / 100;
  if (v >= 1e6) return (v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн';
  if (v >= 1e3) return (v / 1e3).toLocaleString('ru-RU', { maximumFractionDigits: v >= 1e4 ? 0 : 1 }) + ' тыс';
  return nf0.format(v);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function firstGrapheme(s) {
  const str = String(s || '').trim();
  if (!str) return '';
  if (typeof Intl.Segmenter === 'function') {
    for (const { segment } of new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(str)) return segment;
  }
  return Array.from(str)[0];
}
