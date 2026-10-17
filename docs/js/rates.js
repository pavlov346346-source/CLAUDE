// Курсы валют из открытых бесплатных источников (без ключей).
// Источники пробуем по очереди, ответ храним на телефоне — так пересчёт
// работает и без интернета (по последнему известному курсу).

import { ls } from './store.js';

const TTL = 6 * 3600e3; // обновляем не чаще раза в 6 часов
const TIMEOUT = 8000;

const fawaz = (d, from, to) => ({ rate: d?.[from.toLowerCase()]?.[to.toLowerCase()], date: d?.date });

const SOURCES = [
  {
    name: 'currency-api',
    url: (from) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from.toLowerCase()}.json`,
    parse: fawaz,
  },
  {
    name: 'currency-api',
    url: (from) => `https://latest.currency-api.pages.dev/v1/currencies/${from.toLowerCase()}.json`,
    parse: fawaz,
  },
  {
    name: 'exchangerate-api',
    url: (from) => `https://open.er-api.com/v6/latest/${from}`,
    parse: (d, from, to) => ({
      rate: d?.rates?.[to],
      date: d?.time_last_update_unix ? new Date(d.time_last_update_unix * 1000).toISOString().slice(0, 10) : '',
    }),
  },
  {
    // ЦБ РФ: Value рублей за Nominal единиц валюты
    name: 'ЦБ РФ',
    url: () => 'https://www.cbr-xml-daily.ru/daily_json.js',
    parse: (d, from, to) => {
      const rub = (code) => {
        if (code === 'RUB') return 1;
        const v = d?.Valute?.[code];
        return v ? v.Value / v.Nominal : NaN;
      };
      return { rate: rub(from) / rub(to), date: String(d?.Date || '').slice(0, 10) };
    },
  },
];

const key = (from, to) => `fx.${from}.${to}`;
const inflight = {};

// { rate, date, fetched, src } или null
export function cachedRate(from, to) {
  return ls.get(key(from, to), null);
}

export function isStale(r) {
  return !r || Date.now() - r.fetched > TTL;
}

export function fetchRate(from, to) {
  const k = key(from, to);
  if (inflight[k]) return inflight[k];
  inflight[k] = (async () => {
    for (const src of SOURCES) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
      try {
        const res = await fetch(src.url(from), { cache: 'no-store', signal: ctrl.signal });
        if (!res.ok) continue;
        const { rate, date } = src.parse(await res.json(), from, to);
        if (Number.isFinite(rate) && rate > 0) {
          const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
          const r = { rate, date: day, fetched: Date.now(), src: src.name };
          ls.set(k, r);
          return r;
        }
      } catch {
        /* пробуем следующий источник */
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  })().finally(() => delete inflight[k]);
  return inflight[k];
}
