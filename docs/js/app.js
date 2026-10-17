import { Store, ls, COLORS, uid } from './store.js';
import { Sync, TOKEN_URL } from './sync.js';
import * as F from './format.js';
import { bars, donut, stack } from './charts.js';
import { icon } from './icons.js';
import { cachedRate, isStale, fetchRate } from './rates.js';

const VERSION = '1.2';
const CURRENCIES = [
  ['₽', 'российский рубль', 'RUB'],
  ['Rp', 'индонезийская рупия', 'IDR'],
  ['$', 'доллар', 'USD'],
  ['€', 'евро', 'EUR'],
  ['₸', 'тенге', 'KZT'],
  ['₴', 'гривна', 'UAH'],
  ['₾', 'лари', 'GEL'],
  ['฿', 'тайский бат', 'THB'],
  ['Br', 'белорусский рубль', 'BYN'],
  ['֏', 'драм', 'AMD'],
  ['сум', 'узбекский сум', 'UZS'],
  ['₺', 'турецкая лира', 'TRY'],
  ['₫', 'вьетнамский донг', 'VND'],
  ['£', 'фунт', 'GBP'],
  ['zł', 'злотый', 'PLN'],
];
// у этих валют копейки не используют — на клавиатуре вместо запятой кнопка «000»
const NO_CENTS = new Set(['Rp', 'сум', '₫']);
const EMOJIS = ['🛒', '🍎', '🥖', '🍜', '🍔', '🍕', '☕️', '🍺', '🍷', '🚕', '🛵', '🚌', '🚗', '⛽️', '✈️', '🏝️', '🏠', '💡', '💧', '📱', '💻', '🛍️', '👕', '👟', '💄', '💅', '💊', '🦷', '🎬', '🎮', '🎁', '🎉', '📚', '👶', '🧸', '🐶', '🏋️', '⚽️', '🏨', '💼', '💳', '🧾', '🔧', '🧹', '🙏', '💰', '📦', '🏷️'];

const store = new Store();
const sync = new Sync(store);

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const tabbar = $('#tabbar');
const sheetsRoot = $('#sheets');

const ui = {
  tab: ls.get('tab', 'home') === 'stats' ? 'stats' : 'home',
  month: F.ymOf(F.today()),
  mode: ['week', 'month', 'year'].includes(ls.get('mode')) ? ls.get('mode') : 'month',
  anchor: F.today(),
  bar: -1,
  seg: '',
  many: false, // траты записывают несколько человек
  inRub: ls.get('fxOn', false) === true, // статистика в рублях
};

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

const cur = () => store.cfg.currency || '₽';
const money = (c) => F.money(c, cur());
// для узких мест: миллионы сокращаем до «12,7 млн» (валюта видна в большой сумме рядом)
const moneyFit = (c) => (c >= 1e8 ? F.compact(c) : money(c));
const sum = (list) => list.reduce((a, e) => a + e.amount, 0);
const colorVar = (name) => `var(--c-${COLORS.includes(name) ? name : 'gray'})`;
const catOf = (id) => store.catMap[id] || { id, emoji: '❔', name: 'Без категории', color: 'gray' };
const dismissed = (key) => ls.get('dismiss.' + key, false);
// средние считаем с первой записанной траты, а не с начала периода
const firstDate = () => (store.expenses.length ? store.expenses[store.expenses.length - 1].date : F.today());
const later = (a, b) => (a > b ? a : b);

/* ───────────────── Пересчёт статистики в рубли ───────────────── */

const FX_TO = 'RUB';
const fx = { k: 1, cur: '₽' }; // множитель и валюта для сумм на экране статистики
let fxState = { loading: false, failed: false, asked: 0 };
const curCode = () => (CURRENCIES.find(([s]) => s === cur()) || [])[2];
const fxCents = (c) => (fx.k === 1 ? c : Math.round((c * fx.k) / 100) * 100);
const sm = (c) => F.money(fxCents(c), fx.cur);
const smFit = (c) => (fxCents(c) >= 1e8 ? F.compact(fxCents(c)) : sm(c));
const fmtRate = (v) => v.toLocaleString('ru-RU', { maximumFractionDigits: v >= 100 ? 1 : v >= 1 ? 2 : 4 });

// курс текущей валюты к рублю (из кэша; при необходимости подгружаем свежий)
function fxRate() {
  const code = curCode();
  if (!code || code === FX_TO) return null;
  const r = cachedRate(code, FX_TO);
  if (isStale(r) && !fxState.loading && Date.now() - fxState.asked > 60e3) {
    const asked = Date.now();
    fxState = { loading: true, failed: false, asked };
    fetchRate(code, FX_TO).then((res) => {
      fxState = { loading: false, failed: !res, asked };
      if (ui.tab === 'stats') render();
    });
  }
  return { code, r };
}

function fxChip(total, conv) {
  if (!conv) return '';
  const { r } = conv;
  if (!r) {
    return fxState.failed
      ? `<button class="fx-chip" data-act="fx-retry"><span>Курс рубля не загрузился — нажмите, чтобы повторить</span></button>`
      : `<div class="fx-chip"><span>Загружаем курс рубля…</span></div>`;
  }
  const other = ui.inRub ? money(total) : F.money(Math.round((total * r.rate) / 100) * 100, '₽');
  const rateText = r.rate < 1 ? `1 ₽ = ${fmtRate(1 / r.rate)} ${cur()}` : `1 ${cur()} = ${fmtRate(r.rate)} ₽`;
  return `<button class="fx-chip" data-act="fx"><b>≈ ${other}</b><span>${ui.inRub ? `показать в ${F.esc(cur())}` : 'показать всё в рублях'}</span></button>
    <div class="fx-note">курс ${F.esc(rateText)} на ${F.shortDate(r.date)}</div>`;
}

/* ───────────────────────── Главный экран ───────────────────────── */

function syncBadge() {
  if (!sync.connected) return { name: 'cloudOff', cls: 'off', label: 'Синхронизация выключена' };
  if (sync.state === 'busy') return { name: 'sync', cls: 'spin', label: 'Синхронизация…' };
  if (sync.state === 'error') return { name: 'cloudAlert', cls: 'err', label: sync.error };
  if (sync.state === 'offline') return { name: 'cloudOff', cls: 'warn', label: 'Нет связи' };
  if (store.pendingCount) return { name: 'cloud', cls: 'warn', label: 'Есть несинхронизированные траты' };
  return { name: 'cloudOk', cls: '', label: 'Всё синхронизировано' };
}

function syncButton() {
  const b = syncBadge();
  return `<button class="icon-btn sync-btn ${b.cls}" data-act="sync" aria-label="${F.esc(b.label)}">${icon(b.name, 22)}</button>`;
}

function topActions() {
  return `${syncButton()}<button class="icon-btn" data-act="settings" aria-label="Настройки">${icon('sliders', 22)}</button>`;
}

function itemRow(e, { showDate = false, fmt = money } = {}) {
  const c = catOf(e.cat);
  const sub = [e.note, showDate ? F.shortDate(e.date) : '', ui.many ? e.who : ''].filter(Boolean).join(' · ');
  const unsynced = sync.connected && store.pending[e.id] ? '<i class="unsynced" aria-label="не синхронизировано"></i>' : '';
  return `<button class="item" data-act="edit" data-id="${e.id}">
    <span class="ico" style="--c:${colorVar(c.color)}">${F.esc(c.emoji)}</span>
    <span class="meta"><b>${F.esc(c.name)}</b>${sub ? `<small>${F.esc(sub)}</small>` : ''}</span>
    <span class="amt">${fmt(e.amount)}${unsynced}</span>
  </button>`;
}

function budgetBlock(total, ym, isCur) {
  const b = store.cfg.budget;
  if (!b) return '';
  const pct = Math.min(total / b, 1) * 100;
  const over = total > b;
  let text;
  if (over) text = `Перерасход ${money(total - b)} · бюджет ${money(b)}`;
  else text = `Осталось ${money(b - total)} из ${money(b)}`;
  let hint = '';
  if (isCur && !over) {
    const daysLeft = F.daysInMonth(ym) - Number(F.today().slice(8)) + 1;
    hint = `<small>≈ ${money(Math.floor((b - total) / daysLeft / 100) * 100)} в день до конца месяца</small>`;
  }
  return `<div class="budget ${over ? 'over' : ''}">
    <div class="budget-bar"><i style="width:${pct}%"></i></div>
    <div class="budget-text"><span>${text}</span>${hint}</div>
  </div>`;
}

function banners() {
  let out = '';
  if (isIOS && !standalone && !dismissed('install')) {
    out += `<div class="banner">
      <span class="banner-ico">📲</span>
      <span class="banner-text"><b>Установите как приложение</b>Нажмите ${icon('share', 15, 'inline')} «Поделиться» внизу Safari → «На экран „Домой“»</span>
      <button class="banner-x" data-act="dismiss" data-key="install" aria-label="Скрыть">${icon('x', 16)}</button>
    </div>`;
  }
  if (!sync.connected && !dismissed('sync')) {
    out += `<div class="banner" data-act="sync-setup" role="button">
      <span class="banner-ico">👫</span>
      <span class="banner-text"><b>Ведёте траты вдвоём?</b>Подключите синхронизацию — и оба телефона будут видеть одни и те же записи</span>
      <button class="banner-x" data-act="dismiss" data-key="sync" aria-label="Скрыть">${icon('x', 16)}</button>
    </div>`;
  }
  return out;
}

function homeView() {
  const ym = ui.month;
  const t = F.today();
  const isCur = ym === F.ymOf(t);
  const list = store.expenses.filter((e) => e.date.startsWith(ym));
  const total = sum(list);
  const from = later(ym + '-01', firstDate());
  const to = isCur ? t : `${ym}-${F.daysInMonth(ym)}`;
  const days = Math.max(1, F.diffDays(from, to) + 1);
  const monthIdx = Number(ym.slice(5)) - 1;

  const pills = [
    isCur ? ['Сегодня', moneyFit(sum(list.filter((e) => e.date === t)))] : null,
    ['Средний день', moneyFit(Math.round(total / days / 100) * 100)],
    [F.plural(list.length, ['Трата', 'Траты', 'Трат']), String(list.length)],
  ].filter(Boolean);

  let groups = '';
  let i = 0;
  while (i < list.length) {
    const date = list[i].date;
    const day = [];
    while (i < list.length && list[i].date === date) day.push(list[i++]);
    groups += `<div class="day-head"><span>${F.dayTitle(date)}</span><span>${money(sum(day))}</span></div>
      <div class="list">${day.map((e) => itemRow(e)).join('')}</div>`;
  }
  if (!list.length) {
    groups = `<div class="empty">
      <div class="empty-emoji">${isCur ? '🪙' : '🗓️'}</div>
      <b>${isCur ? 'Здесь пока пусто' : 'В этом месяце трат нет'}</b>
      ${isCur ? '<p>Нажмите <span class="plus-inline">+</span> внизу, чтобы записать первую трату</p>' : ''}
    </div>`;
  }

  return `
  <header class="top"><div class="top-row">
    <button class="icon-btn" data-act="month" data-d="-1" aria-label="Предыдущий месяц">${icon('left', 24)}</button>
    <button class="month-title" data-act="month-now">${F.monthTitle(ym, false)}</button>
    <button class="icon-btn" data-act="month" data-d="1" aria-label="Следующий месяц" ${isCur ? 'disabled' : ''}>${icon('right', 24)}</button>
    <span class="spacer"></span>
    ${topActions()}
  </div></header>
  <section class="hero">
    <div class="hero-in">
      <div class="hero-label">Потрачено в ${F.MONTHS_PREP[monthIdx]}</div>
      <div class="hero-amount${F.num(total).length > 9 ? ' long' : ''}">${F.num(total)}<span class="cur">${F.esc(cur())}</span></div>
      ${budgetBlock(total, ym, isCur)}
      <div class="pills">${pills.map(([k, v]) => `<div class="pill"><small>${k}</small><b>${v}</b></div>`).join('')}</div>
    </div>
  </section>
  <div class="content">
    ${isCur ? banners() : ''}
    ${groups}
  </div>`;
}

/* ───────────────────────── Статистика ───────────────────────── */

function period(anchor = ui.anchor, mode = ui.mode) {
  if (mode === 'week') {
    const start = F.mondayOf(anchor);
    const end = F.addDays(start, 6);
    const a = F.parseYmd(start);
    const b = F.parseYmd(end);
    const title =
      a.getMonth() === b.getMonth()
        ? `${a.getDate()} – ${b.getDate()} ${F.MONTHS_GEN[b.getMonth()]}`
        : `${a.getDate()} ${F.MONTHS_GEN[a.getMonth()]} – ${b.getDate()} ${F.MONTHS_GEN[b.getMonth()]}`;
    return { start, end, title };
  }
  if (mode === 'month') {
    const ym = F.ymOf(anchor);
    return { start: ym + '-01', end: `${ym}-${F.daysInMonth(ym)}`, title: F.monthTitle(ym) };
  }
  const y = anchor.slice(0, 4);
  return { start: y + '-01-01', end: y + '-12-31', title: y };
}

function shiftAnchor(anchor, d, mode = ui.mode) {
  if (mode === 'week') return F.addDays(anchor, 7 * d);
  if (mode === 'month') return F.addMonths(F.ymOf(anchor), d) + '-01';
  return Number(anchor.slice(0, 4)) + d + '-01-01';
}

function inRange(start, end) {
  return store.expenses.filter((e) => e.date >= start && e.date <= end);
}

function comparison(p, total, isCurrent, elapsed) {
  const prevStart = shiftAnchor(p.start, -1);
  const prev = period(prevStart);
  let prevEnd = prev.end;
  if (isCurrent) {
    const e = F.addDays(prev.start, elapsed - 1);
    if (e < prevEnd) prevEnd = e;
  }
  // прошлый период записан не целиком — сравнение было бы нечестным
  if (prev.start < firstDate()) return '';
  const prevTotal = sum(inRange(prev.start, prevEnd));
  if (!prevTotal) return '';
  const delta = (total - prevTotal) / prevTotal;
  const pct = Math.round(Math.abs(delta) * 100);
  let when;
  if (ui.mode === 'week') when = isCurrent ? 'чем за те же дни прошлой недели' : 'чем на прошлой неделе';
  else if (ui.mode === 'month') {
    const m = F.MONTHS_PREP[Number(prev.start.slice(5, 7)) - 1];
    when = isCurrent ? `чем за то же время в ${m}` : `чем в ${m}`;
  } else when = isCurrent ? `чем за то же время в ${prev.title} году` : `чем в ${prev.title} году`;
  if (pct === 0) return `<div class="delta">≈ столько же, ${when}</div>`;
  return `<div class="delta"><span class="delta-badge">${delta > 0 ? '▲' : '▼'} ${pct}%</span> ${delta > 0 ? 'больше' : 'меньше'}, ${when}</div>`;
}

function chartWidth() {
  return Math.max(240, Math.min(view.clientWidth || window.innerWidth, 560) - 64);
}

function barsCard(p, list, total, avgDays) {
  const t = F.today();
  let items;
  let avg;
  let unit;
  if (ui.mode === 'year') {
    const y = p.start.slice(0, 4);
    items = F.MONTHS_SHORT.map((label, i) => {
      const ym = `${y}-${String(i + 1).padStart(2, '0')}`;
      return { v: sum(list.filter((e) => e.date.startsWith(ym))), label, strong: ym === F.ymOf(t), key: ym };
    });
    const first = Number(later(p.start, firstDate()).slice(5, 7));
    const last = t.slice(0, 4) === y ? Number(t.slice(5, 7)) : 12;
    avg = total / Math.max(1, last - first + 1);
    unit = 'в месяц';
  } else {
    const n = F.diffDays(p.start, p.end) + 1;
    items = Array.from({ length: n }, (_, i) => {
      const d = F.addDays(p.start, i);
      const dd = Number(d.slice(8));
      const label =
        ui.mode === 'week' ? F.WEEKDAYS_SHORT[F.parseYmd(d).getDay()] : dd === 1 || dd % 5 === 0 ? String(dd) : '';
      return { v: sum(list.filter((e) => e.date === d)), label, strong: d === t, key: d };
    });
    avg = total / avgDays;
    unit = 'в день';
  }
  const sel = ui.bar >= 0 && ui.bar < items.length ? ui.bar : -1;
  const keyTitle = (k) =>
    k.length === 7
      ? F.monthTitle(k).toLowerCase()
      : `${F.parseYmd(k).getDate()} ${F.MONTHS_GEN[F.parseYmd(k).getMonth()]}, ${F.WEEKDAYS[F.parseYmd(k).getDay()]}`;
  let caption;
  if (sel >= 0) {
    caption = `<span>${keyTitle(items[sel].key)}</span><b>${sm(items[sel].v)}</b>`;
  } else {
    const max = items.reduce((m, it, i) => (it.v > items[m].v ? i : m), 0);
    caption = items[max].v
      ? `<span>Больше всего — ${keyTitle(items[max].key)}</span><b>${sm(items[max].v)}</b>`
      : '<span>Нет трат</span>';
  }
  return `<div class="card">
    <div class="card-head"><h3>${ui.mode === 'year' ? 'По месяцам' : 'По дням'}</h3>
      ${avg > 0 ? `<span class="legend-avg"><i></i>в среднем ${sm(Math.round(avg / 100) * 100)} ${unit}</span>` : ''}</div>
    <div class="chart-caption">${caption}</div>
    <div class="chart-wrap">${bars(items, { width: chartWidth(), avg, selected: sel, tick: (v) => F.compact(v * fx.k) })}</div>
  </div>`;
}

function categoriesCard(list, total) {
  const by = {};
  for (const e of list) {
    by[e.cat] = by[e.cat] || { id: e.cat, v: 0, n: 0 };
    by[e.cat].v += e.amount;
    by[e.cat].n += 1;
  }
  const rows = Object.values(by).sort((a, b) => b.v - a.v);
  const top = rows.length > 6 ? rows.slice(0, 5) : rows;
  const rest = rows.slice(top.length);
  const segs = top.map((r) => ({ id: r.id, v: r.v, color: colorVar(catOf(r.id).color) }));
  if (rest.length) segs.push({ id: '_rest', v: sum(rest.map((r) => ({ amount: r.v }))), color: 'var(--c-gray)' });

  const sel = segs.find((s) => s.id === ui.seg);
  let center;
  if (sel) {
    const name = sel.id === '_rest' ? 'Остальное' : catOf(sel.id).name;
    const emoji = sel.id === '_rest' ? '•••' : catOf(sel.id).emoji;
    center = `<small>${F.esc(emoji)} ${F.esc(name)}</small><b>${smFit(sel.v)}</b><small>${Math.round((sel.v / total) * 100)}%</small>`;
  } else {
    center = `<small>Всего</small><b>${smFit(total)}</b><small>${rows.length} ${F.plural(rows.length, ['категория', 'категории', 'категорий'])}</small>`;
  }

  const rowsHtml = rows
    .map((r) => {
      const c = catOf(r.id);
      const pct = (r.v / total) * 100;
      return `<button class="cat-row" data-act="cat-detail" data-id="${r.id}">
        <span class="ico" style="--c:${colorVar(c.color)}">${F.esc(c.emoji)}</span>
        <span class="cat-row-main">
          <span class="cat-row-top"><b>${F.esc(c.name)}</b><span class="amt">${sm(r.v)}</span></span>
          <span class="meter"><i style="width:${Math.max(pct, 1)}%;background:${colorVar(c.color)}"></i></span>
          <span class="cat-row-sub"><span>${r.n} ${F.plural(r.n, ['трата', 'траты', 'трат'])}</span><span>${pct < 1 ? '<1' : Math.round(pct)}%</span></span>
        </span>
      </button>`;
    })
    .join('');

  return `<div class="card">
    <div class="card-head"><h3>По категориям</h3></div>
    <div class="donut-box">${donut(segs, { selected: sel ? sel.id : '' })}<div class="donut-center">${center}</div></div>
    <div class="cat-rows">${rowsHtml}</div>
  </div>`;
}

function peopleCard(list, total) {
  const by = {};
  for (const e of list) by[e.who || '—'] = (by[e.who || '—'] || 0) + e.amount;
  const names = Object.keys(by);
  if (names.length < 2) return '';
  const order = store.people();
  names.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const palette = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'];
  const segs = names.map((n, i) => ({ v: by[n], color: `var(--c-${palette[i % palette.length]})`, name: n }));
  return `<div class="card">
    <div class="card-head"><h3>Кто сколько</h3></div>
    ${stack(segs)}
    <div class="people">${segs
      .map(
        (s) => `<div class="person"><i style="background:${s.color}"></i><span>${F.esc(s.name)}</span>
          <b>${sm(s.v)}</b><small>${Math.round((s.v / total) * 100)}%</small></div>`,
      )
      .join('')}</div>
  </div>`;
}

function statsView() {
  const p = period();
  const t = F.today();
  const list = inRange(p.start, p.end);
  const total = sum(list);
  const isCurrent = t >= p.start && t <= p.end;
  const elapsed = (isCurrent ? F.diffDays(p.start, t) : F.diffDays(p.start, p.end)) + 1;
  const avgFrom = later(p.start, firstDate());
  const avgDays = Math.max(1, F.diffDays(avgFrom, isCurrent ? t : p.end) + 1);
  const canNext = p.end < t;
  const conv = fxRate();
  const inRub = !!(ui.inRub && conv && conv.r);
  fx.k = inRub ? conv.r.rate : 1;
  fx.cur = inRub ? '₽' : cur();
  const shown = F.num(fxCents(total));
  const modes = [
    ['week', 'Неделя'],
    ['month', 'Месяц'],
    ['year', 'Год'],
  ];

  let body;
  if (!list.length) {
    body = `<div class="empty"><div class="empty-emoji">📊</div><b>За этот период трат нет</b><p>Статистика появится, как только вы что-нибудь запишете</p></div>`;
  } else {
    const biggest = [...list].sort((a, b) => b.amount - a.amount).slice(0, 5);
    body = `
      ${categoriesCard(list, total)}
      ${barsCard(p, list, total, avgDays)}
      ${peopleCard(list, total)}
      <div class="card flush">
        <div class="card-head pad"><h3>Самые крупные</h3></div>
        <div class="list plain">${biggest.map((e) => itemRow(e, { showDate: true, fmt: sm })).join('')}</div>
      </div>`;
  }

  return `
  <header class="top">
    <div class="top-row"><h1 class="top-title">Статистика</h1><span class="spacer"></span>${topActions()}</div>
    <div class="segmented">${modes
      .map(([k, label]) => `<button class="${ui.mode === k ? 'on' : ''}" data-act="mode" data-m="${k}">${label}</button>`)
      .join('')}</div>
  </header>
  <section class="hero">
    <div class="hero-in">
      <div class="period-nav">
        <button class="icon-btn" data-act="period" data-d="-1" aria-label="Назад">${icon('left', 22)}</button>
        <button class="period-title" data-act="period-now">${p.title}</button>
        <button class="icon-btn" data-act="period" data-d="1" aria-label="Вперёд" ${canNext ? '' : 'disabled'}>${icon('right', 22)}</button>
      </div>
      <div class="hero-amount center${shown.length > 9 ? ' long' : ''}">${shown}<span class="cur">${F.esc(fx.cur)}</span></div>
      ${list.length ? fxChip(total, conv) : ''}
      ${comparison(p, total, isCurrent, elapsed)}
      <div class="pills">
        <div class="pill"><small>Средний день</small><b>${smFit(Math.round(total / avgDays / 100) * 100)}</b></div>
        <div class="pill"><small>${F.plural(list.length, ['Трата', 'Траты', 'Трат'])}</small><b>${list.length}</b></div>
      </div>
    </div>
  </section>
  <div class="content">${body}</div>`;
}

/* ───────────────────────── Рендер и навигация ───────────────────────── */

function render() {
  ui.many = store.people().length > 1;
  view.innerHTML = ui.tab === 'home' ? homeView() : statsView();
  for (const b of tabbar.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === ui.tab);
}

function updateSyncButtons() {
  const b = syncBadge();
  for (const el of document.querySelectorAll('.sync-btn')) {
    el.className = `icon-btn sync-btn ${b.cls}`;
    el.setAttribute('aria-label', b.label);
    el.innerHTML = icon(b.name, 22);
  }
}

function setTab(tab) {
  if (ui.tab === tab) {
    view.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  ui.tab = tab;
  ls.set('tab', tab);
  render();
  view.scrollTop = 0;
}

view.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'dismiss') {
    ev.stopPropagation();
    ls.set('dismiss.' + t.dataset.key, true);
    render();
    return;
  }
  switch (act) {
    case 'month':
      ui.month = F.addMonths(ui.month, Number(t.dataset.d));
      render();
      break;
    case 'month-now':
      ui.month = F.ymOf(F.today());
      render();
      break;
    case 'edit': {
      const e = store.all[t.dataset.id];
      if (e) openExpense(e);
      break;
    }
    case 'settings':
      openSettings();
      break;
    case 'sync':
      if (!sync.connected) openSyncSetup();
      else {
        sync.run().then(() => toast(sync.state === 'idle' ? 'Всё синхронизировано' : sync.error || 'Нет связи'));
      }
      break;
    case 'sync-setup':
      openSyncSetup();
      break;
    case 'mode':
      ui.mode = t.dataset.m;
      ls.set('mode', ui.mode);
      ui.bar = -1;
      ui.seg = '';
      render();
      break;
    case 'period':
      ui.anchor = shiftAnchor(ui.anchor, Number(t.dataset.d));
      ui.bar = -1;
      ui.seg = '';
      render();
      break;
    case 'period-now':
      ui.anchor = F.today();
      ui.bar = -1;
      ui.seg = '';
      render();
      break;
    case 'bar': {
      const i = Number(t.dataset.i);
      ui.bar = ui.bar === i ? -1 : i;
      render();
      break;
    }
    case 'seg':
      ui.seg = ui.seg === t.dataset.id ? '' : t.dataset.id;
      render();
      break;
    case 'cat-detail':
      openCategoryDetail(t.dataset.id);
      break;
    case 'fx':
      ui.inRub = !ui.inRub;
      ls.set('fxOn', ui.inRub);
      render();
      break;
    case 'fx-retry':
      fxState = { loading: false, failed: false, asked: 0 };
      render();
      break;
  }
});

tabbar.addEventListener('click', (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.tab) setTab(t.dataset.tab);
  else if (t.dataset.act === 'add') openExpense(null);
});

/* ───────────────────────── Нижние шторки ───────────────────────── */

const sheets = [];

function openSheet({ html, cls = '', onMount, refresh, dismissible = true }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.style.zIndex = String(50 + sheets.length * 2);
  wrap.innerHTML = `<div class="backdrop"></div><section class="sheet ${cls}" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</section>`;
  sheetsRoot.appendChild(wrap);
  const el = wrap.querySelector('.sheet');
  const api = { wrap, el, refresh, dismissible, onClose: null, close: () => closeSheet(api) };
  if (sheets.length) sheets[sheets.length - 1].wrap.classList.add('behind');
  sheets.push(api);
  void wrap.offsetHeight;
  wrap.classList.add('open');
  wrap.querySelector('.backdrop').addEventListener('click', () => api.dismissible && api.close());
  el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-act="close"]')) api.close();
  });
  enableDrag(api);
  if (onMount) onMount(api);
  return api;
}

function closeSheet(api) {
  const i = sheets.indexOf(api);
  if (i < 0) return;
  sheets.splice(i, 1);
  if (sheets.length) sheets[sheets.length - 1].wrap.classList.remove('behind');
  if (document.activeElement && api.el.contains(document.activeElement)) document.activeElement.blur();
  api.el.style.transform = '';
  api.wrap.classList.remove('open');
  setTimeout(() => api.wrap.remove(), 380);
  if (api.onClose) api.onClose();
}

function enableDrag(api) {
  const el = api.el;
  let startY = 0;
  let dy = 0;
  let t0 = 0;
  let dragging = false;
  el.addEventListener(
    'touchstart',
    (ev) => {
      if (!api.dismissible) return;
      const zone = ev.target.closest('.grabber, .sheet-head');
      if (!zone || ev.target.closest('button, input, select, a, label')) return;
      dragging = true;
      startY = ev.touches[0].clientY;
      dy = 0;
      t0 = Date.now();
      el.style.transition = 'none';
    },
    { passive: true },
  );
  el.addEventListener(
    'touchmove',
    (ev) => {
      if (!dragging) return;
      dy = Math.max(0, ev.touches[0].clientY - startY);
      el.style.transform = `translateY(${dy}px)`;
    },
    { passive: true },
  );
  el.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    el.style.transition = '';
    const fast = dy / Math.max(1, Date.now() - t0) > 0.6;
    if (dy > 120 || (fast && dy > 30)) api.close();
    else el.style.transform = '';
  });
}

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && sheets.length) {
    const top = sheets[sheets.length - 1];
    if (top.dismissible) top.close();
  }
});

function head(left, title, right) {
  return `<div class="sheet-head">${left || '<span class="link-ph"></span>'}<b class="title">${title}</b>${right || '<span class="link-ph"></span>'}</div>`;
}

/* ───────────── Добавление / редактирование траты ───────────── */

function centsToStr(c) {
  const i = Math.floor(c / 100);
  const d = c % 100;
  return d ? `${i},${String(d).padStart(2, '0')}` : String(i);
}

function strToCents(s) {
  if (!s) return 0;
  const [i, d = ''] = s.split(',');
  return Number(i || 0) * 100 + Number((d + '00').slice(0, 2));
}

function dateChipLabel(d) {
  const t = F.today();
  if (d === t) return 'Сегодня';
  if (d === F.addDays(t, -1)) return 'Вчера';
  const x = F.parseYmd(d);
  const y = x.getFullYear() !== new Date().getFullYear() ? ' ' + x.getFullYear() : '';
  return `${x.getDate()} ${F.MONTHS_GEN[x.getMonth()]}${y}`;
}

function openExpense(existing) {
  const st = {
    amount: existing ? centsToStr(existing.amount) : '',
    cat: existing ? existing.cat : '',
    date: existing ? existing.date : F.today(),
    note: existing ? existing.note || '' : '',
    who: existing ? existing.who : store.device.name,
  };
  const people = store.people();
  if (st.who && !people.includes(st.who)) people.push(st.who);
  const catsKey = () => JSON.stringify(store.cats.map((c) => [c.id, c.name, c.emoji, c.color, c.del]));
  const catsHtml = () =>
    store.cats
      .filter((c) => !c.del || c.id === st.cat)
      .map(
        (c) => `<button class="cat" data-act="cat" data-id="${c.id}" style="--c:${colorVar(c.color)}">
          <span class="e">${F.esc(c.emoji)}</span><span class="l">${F.esc(c.name)}</span></button>`,
      )
      .join('') +
    `<button class="cat edit" data-act="edit-cats"><span class="e">${icon('note', 22)}</span><span class="l">Изменить</span></button>`;

  const sep = NO_CENTS.has(cur()) ? '000' : ',';
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', sep, '0', 'back'];
  const html = `
    ${head(
      '<button class="link" data-act="close">Отмена</button>',
      existing ? 'Трата' : 'Новая трата',
      existing ? '<button class="link danger" data-act="delete">Удалить</button>' : '',
    )}
    <div class="amount"><span class="num"></span><span class="cur">${F.esc(cur())}</span></div>
    <div class="meta-row">
      <label class="chip">${icon('calendar', 16)}<span class="date-label"></span>
        <input type="date" class="date-input" max="${F.today()}" value="${st.date}" aria-label="Дата"></label>
      ${people.length > 1 ? `<button class="chip" data-act="who">${icon('user', 16)}<span class="who-label"></span></button>` : ''}
      <label class="chip note-chip">${icon('note', 16)}<input class="note-input" placeholder="Комментарий" maxlength="80" enterkeyhint="done" value="${F.esc(st.note)}"></label>
    </div>
    <div class="cats">${catsHtml()}</div>
    <div class="keypad">${keys
      .map((k) =>
        k === 'back'
          ? `<button class="key fn" data-act="key" data-k="back" aria-label="Стереть">${icon('backspace', 26)}</button>`
          : `<button class="key${k === ',' ? ' fn' : k === '000' ? ' zeros' : ''}" data-act="key" data-k="${k}">${k}</button>`,
      )
      .join('')}</div>
    <div class="sheet-foot"><button class="save" data-act="save"></button></div>`;

  let shownCats = catsKey();
  let shownIds = new Set(store.cats.map((c) => c.id));
  openSheet({
    html,
    cls: 'expense-sheet',
    // категории поменяли (здесь или на другом телефоне) — перерисуем сетку,
    // а только что созданную категорию сразу выберем
    refresh(api) {
      const key = catsKey();
      if (key === shownCats) return;
      const added = store.cats.filter((c) => !c.del && !shownIds.has(c.id));
      if (added.length === 1) st.cat = added[0].id;
      shownCats = key;
      shownIds = new Set(store.cats.map((c) => c.id));
      $('.cats', api.el).innerHTML = catsHtml();
      api.update();
    },
    onMount(api) {
      const el = api.el;
      const numEl = $('.amount .num', el);
      const amountBox = $('.amount', el);
      const saveBtn = $('.save', el);
      const dateLabel = $('.date-label', el);
      const whoLabel = $('.who-label', el);
      const noteInput = $('.note-input', el);

      const update = () => {
        const cents = strToCents(st.amount);
        const [i, d] = st.amount.split(',');
        numEl.textContent = st.amount ? Number(i || 0).toLocaleString('ru-RU') + (d !== undefined ? ',' + d : '') : '0';
        amountBox.classList.toggle('empty', !cents);
        amountBox.classList.toggle('long', st.amount.length > 8);
        for (const b of el.querySelectorAll('.cat')) b.classList.toggle('sel', b.dataset.id === st.cat);
        dateLabel.textContent = dateChipLabel(st.date);
        if (whoLabel) whoLabel.textContent = st.who || '—';
        saveBtn.disabled = !cents || !st.cat;
        if (!cents) saveBtn.textContent = 'Введите сумму';
        else if (!st.cat) saveBtn.textContent = 'Выберите категорию';
        else saveBtn.textContent = existing ? 'Сохранить' : `Добавить ${money(cents)}`;
      };

      const press = (k) => {
        let s = st.amount;
        if (k === 'back') s = s.slice(0, -1);
        else if (k === '000') {
          if (!s || s === '0' || s.includes(',') || s.length + 3 > 9) return;
          s += '000';
        } else if (k === ',') {
          if (!s.includes(',')) s = (s || '0') + ',';
        } else {
          const [i, d] = s.split(',');
          if (d !== undefined) {
            if (d.length >= 2) return;
            s += k;
          } else {
            if (i.length >= 9) return;
            s = s === '0' ? k : s + k;
          }
        }
        st.amount = s;
        update();
      };

      el.addEventListener('click', (ev) => {
        const t = ev.target.closest('[data-act]');
        if (!t) return;
        switch (t.dataset.act) {
          case 'key':
            press(t.dataset.k);
            break;
          case 'cat':
            st.cat = t.dataset.id;
            update();
            break;
          case 'edit-cats':
            openCategories();
            break;
          case 'who': {
            const i = people.indexOf(st.who);
            st.who = people[(i + 1) % people.length];
            update();
            break;
          }
          case 'save': {
            const cents = strToCents(st.amount);
            if (!cents || !st.cat) return;
            st.note = noteInput.value.trim();
            const c = catOf(st.cat);
            if (existing) {
              store.put({ ...store.all[existing.id], amount: cents, cat: st.cat, date: st.date, note: st.note, who: st.who });
              toast('Сохранено');
            } else {
              store.addExpense({ amount: cents, cat: st.cat, date: st.date, note: st.note, who: st.who });
              toast(`${c.emoji} ${money(cents)} · ${c.name}`);
              if (ui.tab === 'home' && ui.month !== F.ymOf(st.date)) {
                ui.month = F.ymOf(st.date);
                render();
              }
            }
            api.close();
            break;
          }
          case 'delete': {
            const prev = store.all[existing.id];
            store.remove(existing.id);
            api.close();
            toast('Трата удалена', {
              label: 'Вернуть',
              run: () => {
                const { del: _del, ...rest } = prev;
                store.put(rest);
              },
            });
            break;
          }
        }
      });
      $('.date-input', el).addEventListener('change', (ev) => {
        st.date = ev.target.value || F.today();
        update();
      });
      noteInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') noteInput.blur();
      });
      // физическая клавиатура (на компьютере)
      const onKey = (ev) => {
        if (sheets[sheets.length - 1] !== api || ev.target.tagName === 'INPUT') return;
        if (/^[0-9]$/.test(ev.key)) press(ev.key);
        else if (ev.key === ',' || ev.key === '.') press(',');
        else if (ev.key === 'Backspace') press('back');
        else if (ev.key === 'Enter') saveBtn.click();
      };
      document.addEventListener('keydown', onKey);
      api.onClose = () => document.removeEventListener('keydown', onKey);
      api.update = update;
      update();
    },
  });
}

/* ───────────────────────── Категория: список трат ───────────────────────── */

function openCategoryDetail(catId) {
  const p = period();
  const body = () => {
    const list = inRange(p.start, p.end).filter((e) => e.cat === catId);
    const c = catOf(catId);
    return `${head('', `${F.esc(c.emoji)} ${F.esc(c.name)}`, '<button class="link" data-act="close">Готово</button>')}
      <div class="sheet-scroll">
        <div class="detail-sum"><b>${sm(sum(list))}</b><small>${p.title} · ${list.length} ${F.plural(list.length, ['трата', 'траты', 'трат'])}</small></div>
        <div class="list">${list.map((e) => itemRow(e, { showDate: true, fmt: sm })).join('') || '<p class="muted pad">Нет трат</p>'}</div>
      </div>`;
  };
  openSheet({
    html: `<div class="sheet-inner">${body()}</div>`,
    cls: 'tall',
    refresh(api) {
      $('.sheet-inner', api.el).innerHTML = body();
    },
    onMount(api) {
      api.el.addEventListener('click', (ev) => {
        const t = ev.target.closest('[data-act="edit"]');
        if (t && store.all[t.dataset.id]) openExpense(store.all[t.dataset.id]);
      });
    },
  });
}

/* ───────────────────────── Настройки ───────────────────────── */

function timeAgo(ts) {
  if (!ts) return 'ещё не синхронизировано';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(ts).toLocaleDateString('ru-RU');
}

function syncGroup() {
  if (!sync.connected) {
    return `<div class="row static"><span class="row-ico off">${icon('cloudOff', 20)}</span>
        <span class="row-main"><b>Не подключена</b><small>Траты хранятся только на этом телефоне</small></span></div>
      <button class="row accent" data-act="sync-setup">Подключить синхронизацию${icon('right', 18, 'chev')}</button>`;
  }
  const b = syncBadge();
  const pending = store.pendingCount;
  return `<div class="row static"><span class="row-ico ${b.cls || 'ok'}">${icon(b.name, 20)}</span>
      <span class="row-main"><b>${sync.state === 'error' || sync.state === 'offline' ? F.esc(b.label) : 'Подключено'}</b>
      <small>GitHub @${F.esc(sync.cfg.login || '')} · ${sync.state === 'busy' ? 'синхронизация…' : timeAgo(sync.cfg.last)}${pending ? ` · ждут отправки: ${pending}` : ''}</small></span></div>
    <button class="row" data-act="sync-now">${icon('sync', 18, 'lead')}Синхронизировать сейчас</button>
    <button class="row" data-act="copy-token">${icon('copy', 18, 'lead')}Скопировать токен для второго телефона</button>
    <button class="row danger" data-act="disconnect">Отключить на этом телефоне</button>`;
}

function catsGroup() {
  const visible = store.cats.filter((c) => !c.del);
  const hidden = store.cats.filter((c) => c.del);
  const row = (c) => `<button class="row" data-act="cat-edit" data-id="${c.id}">
      <span class="ico sm" style="--c:${colorVar(c.color)}">${F.esc(c.emoji)}</span>
      <span class="row-main"><b>${F.esc(c.name)}</b></span>${c.del ? '<small class="muted">удалена</small>' : ''}${icon('right', 18, 'chev')}</button>`;
  return visible.map(row).join('') + hidden.map(row).join('') + `<button class="row accent" data-act="cat-new">${icon('plus', 18, 'lead')}Новая категория</button>`;
}

function settingsHtml() {
  const budget = store.cfg.budget ? F.num(store.cfg.budget) : '';
  return `${head('', 'Настройки', '<button class="link" data-act="close">Готово</button>')}
  <div class="sheet-scroll">
    <div class="group-title">Синхронизация</div>
    <div class="group" id="g-sync">${syncGroup()}</div>

    <div class="group-title">Этот телефон</div>
    <div class="group">
      <label class="row field"><span class="row-label">Ваше имя</span>
        <input class="row-input" data-field="name" value="${F.esc(store.device.name)}" placeholder="Например, Саша" maxlength="20" autocomplete="off" enterkeyhint="done"></label>
    </div>
    <p class="group-note">Под этим именем будут записываться траты с этого телефона.</p>

    <div class="group-title">Общие настройки</div>
    <div class="group">
      <label class="row field"><span class="row-label">Валюта</span>
        <select class="row-input" data-field="currency">${CURRENCIES.map(
          ([c, name]) => `<option value="${c}" ${c === cur() ? 'selected' : ''}>${c} — ${name}</option>`,
        ).join('')}</select></label>
      <label class="row field"><span class="row-label">Бюджет на месяц</span>
        <input class="row-input" data-field="budget" inputmode="numeric" value="${budget}" placeholder="не задан" enterkeyhint="done"></label>
    </div>
    <p class="group-note">Валюта, бюджет и категории общие для обоих телефонов.</p>

    <div class="group-title">Категории</div>
    <div class="group" id="g-cats">${catsGroup()}</div>

    <div class="group-title">Данные</div>
    <div class="group">
      <button class="row" data-act="export">${icon('share', 18, 'lead')}Выгрузить в Excel (CSV)</button>
    </div>
    <p class="foot">Траты ${VERSION} · ${store.expenses.length} ${F.plural(store.expenses.length, ['запись', 'записи', 'записей'])}</p>
  </div>`;
}

function openSettings() {
  openSheet({
    html: settingsHtml(),
    cls: 'tall',
    refresh(api) {
      const g = $('#g-sync', api.el);
      if (g) g.innerHTML = syncGroup();
      const c = $('#g-cats', api.el);
      if (c) c.innerHTML = catsGroup();
    },
    onMount(api) {
      const el = api.el;
      el.addEventListener('click', async (ev) => {
        const t = ev.target.closest('[data-act]');
        if (!t) return;
        switch (t.dataset.act) {
          case 'sync-setup':
            openSyncSetup();
            break;
          case 'sync-now':
            await sync.run();
            toast(sync.state === 'idle' ? 'Всё синхронизировано' : sync.error || 'Нет связи');
            break;
          case 'copy-token':
            try {
              await navigator.clipboard.writeText(sync.cfg.token);
              toast('Токен скопирован — отправьте его на второй телефон');
            } catch {
              prompt('Скопируйте токен:', sync.cfg.token);
            }
            break;
          case 'disconnect':
            if (confirm('Отключить синхронизацию на этом телефоне? Траты останутся на телефоне и в облаке.')) {
              sync.disconnect();
              toast('Синхронизация отключена');
            }
            break;
          case 'cat-edit':
            openCategoryEdit(store.catMap[t.dataset.id]);
            break;
          case 'cat-new':
            openCategoryEdit(null);
            break;
          case 'export':
            exportCsv();
            break;
        }
      });
      el.addEventListener('change', (ev) => {
        const f = ev.target.dataset.field;
        if (f === 'name') {
          store.setDeviceName(ev.target.value.trim());
          toast('Имя сохранено');
        } else if (f === 'currency') {
          store.setCfg({ currency: ev.target.value });
        } else if (f === 'budget') {
          const v = Math.round(parseFloat(ev.target.value.replace(/\s/g, '').replace(',', '.')) * 100);
          store.setCfg({ budget: v > 0 ? v : 0 });
          ev.target.value = v > 0 ? F.num(v) : '';
          toast(v > 0 ? `Бюджет: ${money(v)} в месяц` : 'Бюджет убран');
        }
      });
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') ev.target.blur();
      });
    },
  });
}

function openSyncSetup() {
  const html = `${head('<button class="link" data-act="close">Отмена</button>', 'Синхронизация', '')}
  <div class="sheet-scroll pad">
    <p class="lead">Траты будут храниться в вашем аккаунте GitHub, в приватном хранилище (gist). Чтобы оба телефона видели одни и те же записи, на обоих нужно ввести <b>один и тот же токен</b>.</p>
    <div class="step"><span class="step-n">1</span><div class="step-body">
      <b>Создайте токен</b>
      <p>Это нужно сделать один раз, на первом телефоне. На GitHub в поле <i>Expiration</i> выберите <i>No expiration</i>, убедитесь, что стоит галочка <i>gist</i>, нажмите внизу <i>Generate token</i> и скопируйте токен.</p>
      <a class="btn ghost" href="${TOKEN_URL}" target="_blank" rel="noopener">Открыть GitHub ${icon('external', 16)}</a>
    </div></div>
    <div class="step"><span class="step-n">2</span><div class="step-body">
      <b>Вставьте токен</b>
      <p>На втором телефоне начинайте сразу отсюда — токен можно скопировать в настройках первого телефона.</p>
      <div class="token-row">
        <input class="text-input token-input" placeholder="ghp_…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
        <button class="btn small" data-act="paste">Вставить</button>
      </div>
    </div></div>
    <p class="err" hidden></p>
    <button class="save" data-act="connect">Подключить</button>
    <p class="hint">Токен хранится только на ваших телефонах и даёт доступ лишь к gist-заметкам.</p>
  </div>`;
  openSheet({
    html,
    cls: 'tall',
    onMount(api) {
      const el = api.el;
      const input = $('.token-input', el);
      const err = $('.err', el);
      const btn = $('[data-act="connect"]', el);
      el.addEventListener('click', async (ev) => {
        const t = ev.target.closest('[data-act]');
        if (!t) return;
        if (t.dataset.act === 'paste') {
          try {
            input.value = (await navigator.clipboard.readText()).trim();
          } catch {
            input.focus();
          }
        } else if (t.dataset.act === 'connect') {
          err.hidden = true;
          btn.disabled = true;
          btn.textContent = 'Подключаем…';
          try {
            await sync.connect(input.value);
            api.close();
            toast('Синхронизация включена ✨');
          } catch (e) {
            err.textContent = e.message || 'Не получилось подключиться';
            err.hidden = false;
          } finally {
            btn.disabled = false;
            btn.textContent = 'Подключить';
          }
        }
      });
    },
  });
}

function openCategories() {
  openSheet({
    html: `${head('', 'Категории', '<button class="link" data-act="close">Готово</button>')}
      <div class="sheet-scroll">
        <p class="group-note top">Нажмите на категорию, чтобы переименовать её или сменить значок. Категории общие для обоих телефонов.</p>
        <div class="group" id="g-cats">${catsGroup()}</div>
      </div>`,
    cls: 'tall',
    refresh(api) {
      $('#g-cats', api.el).innerHTML = catsGroup();
    },
    onMount(api) {
      api.el.addEventListener('click', (ev) => {
        const t = ev.target.closest('[data-act]');
        if (!t) return;
        if (t.dataset.act === 'cat-edit') openCategoryEdit(store.catMap[t.dataset.id]);
        else if (t.dataset.act === 'cat-new') openCategoryEdit(null);
      });
    },
  });
}

function openCategoryEdit(c) {
  const st = c ? { ...c } : { id: 'cat-' + uid(8), kind: 'cat', emoji: '🏷️', name: '', color: 'blue', order: Math.max(0, ...store.cats.map((x) => x.order)) + 1 };
  const html = `${head(
    '<button class="link" data-act="close">Отмена</button>',
    c ? 'Категория' : 'Новая категория',
    '<button class="link strong" data-act="save">Готово</button>',
  )}
  <div class="sheet-scroll pad">
    <div class="cat-preview" style="--c:${colorVar(st.color)}">
      <input class="emoji-input" value="${F.esc(st.emoji)}" maxlength="16" aria-label="Эмодзи" enterkeyhint="done">
    </div>
    <input class="text-input name-input" value="${F.esc(st.name)}" placeholder="Название" maxlength="24" enterkeyhint="done">
    <div class="field-label">Цвет</div>
    <div class="swatches">${COLORS.map(
      (k) => `<button class="sw ${k === st.color ? 'sel' : ''}" data-act="color" data-c="${k}" style="--c:var(--c-${k})" aria-label="${k}"></button>`,
    ).join('')}</div>
    <div class="field-label">Значок</div>
    <div class="emoji-grid">${EMOJIS.map(
      (e) => `<button class="em ${e === st.emoji ? 'sel' : ''}" data-act="emoji" data-e="${e}">${e}</button>`,
    ).join('')}</div>
    <p class="hint">Нужен другой — нажмите на большой значок вверху и выберите любой эмодзи на клавиатуре.</p>
    ${
      c
        ? `<button class="btn ghost wide ${c.del ? '' : 'danger'}" data-act="toggle">${c.del ? 'Вернуть категорию' : 'Удалить категорию'}</button>
           <p class="hint">${c.del ? 'Категория снова появится в списке при вводе трат.' : 'Категория пропадёт из списка, а уже записанные траты в ней сохранятся.'}</p>`
        : ''
    }
  </div>`;
  openSheet({
    html,
    cls: 'tall',
    onMount(api) {
      const el = api.el;
      const preview = $('.cat-preview', el);
      el.addEventListener('click', (ev) => {
        const t = ev.target.closest('[data-act]');
        if (!t) return;
        if (t.dataset.act === 'color') {
          st.color = t.dataset.c;
          preview.style.setProperty('--c', colorVar(st.color));
          for (const b of el.querySelectorAll('.sw')) b.classList.toggle('sel', b === t);
        } else if (t.dataset.act === 'emoji') {
          $('.emoji-input', el).value = t.dataset.e;
          for (const b of el.querySelectorAll('.em')) b.classList.toggle('sel', b === t);
        } else if (t.dataset.act === 'save') {
          const name = $('.name-input', el).value.trim();
          const emoji = F.firstGrapheme($('.emoji-input', el).value) || '🏷️';
          if (!name) {
            $('.name-input', el).focus();
            return;
          }
          store.put({ ...st, name, emoji });
          api.close();
          toast(c ? 'Категория сохранена' : `Категория «${name}» добавлена`);
        } else if (t.dataset.act === 'toggle') {
          store.put({ ...store.catMap[c.id], del: c.del ? 0 : 1 });
          api.close();
          toast(c.del ? 'Категория возвращена' : 'Категория удалена');
        }
      });
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') ev.target.blur();
      });
      if (!c) setTimeout(() => $('.name-input', el).focus(), 350);
    },
  });
}

function exportCsv() {
  const rows = [['Дата', 'Категория', 'Сумма', 'Валюта', 'Комментарий', 'Кто']];
  for (const e of [...store.expenses].reverse()) {
    rows.push([e.date, catOf(e.cat).name, (e.amount / 100).toFixed(2).replace('.', ','), cur(), e.note || '', e.who || '']);
  }
  const csv =
    '﻿' +
    rows.map((r) => r.map((v) => (/[";\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(';')).join('\r\n');
  const name = `traty-${F.today()}.csv`;
  const file = new File([csv], name, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: 'Траты' }).catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ───────────────────────── Первый запуск ───────────────────────── */

function openWelcome() {
  let currency = cur();
  const html = `<div class="sheet-scroll pad welcome">
    <img class="welcome-icon" src="icons/icon-192.png" alt="" width="84" height="84">
    <h2>Траты</h2>
    <p class="lead center">Простой учёт расходов — для одного или для двоих</p>
    <label class="field-label" for="w-name">Как вас зовут?</label>
    <input id="w-name" class="text-input" placeholder="Например, Саша" maxlength="20" autocomplete="given-name" enterkeyhint="done">
    <p class="hint">Имя нужно, чтобы было видно, кто что потратил.</p>
    <div class="field-label">Валюта</div>
    <div class="cur-chips">${CURRENCIES.slice(0, 8)
      .map(([c]) => `<button class="chip ${c === currency ? 'on' : ''}" data-act="cur" data-c="${c}">${c}</button>`)
      .join('')}</div>
    <p class="hint">Другие валюты — в настройках.</p>
    <button class="save" data-act="start">Начать</button>
  </div>`;
  openSheet({
    html,
    cls: 'tall',
    dismissible: false,
    onMount(api) {
      const el = api.el;
      el.addEventListener('click', (ev) => {
        const t = ev.target.closest('[data-act]');
        if (!t) return;
        if (t.dataset.act === 'cur') {
          currency = t.dataset.c;
          for (const b of el.querySelectorAll('.cur-chips .chip')) b.classList.toggle('on', b === t);
        } else if (t.dataset.act === 'start') {
          const name = $('#w-name', el).value.trim() || 'Я';
          store.setDeviceName(name);
          if (currency !== cur()) store.setCfg({ currency });
          api.close();
        }
      });
      $('#w-name', el).addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') ev.target.blur();
      });
    },
  });
}

/* ───────────────────────── Уведомления ───────────────────────── */

const toastEl = $('#toast');
let toastTimer;
function toast(text, action) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span>${F.esc(text)}</span>${action ? `<button>${F.esc(action.label)}</button>` : ''}`;
  if (action) {
    $('button', toastEl).onclick = () => {
      action.run();
      toastEl.classList.remove('show');
    };
  }
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), action ? 5000 : 2600);
}

/* ───────────────────────── Старт ───────────────────────── */

store.on(() => {
  render();
  for (const s of sheets) if (s.refresh) s.refresh(s);
});
sync.on(() => {
  updateSyncButtons();
  for (const s of sheets) if (s.refresh) s.refresh(s);
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => ui.tab === 'stats' && render(), 150);
});

// новый день — обновим «Сегодня»
let lastDay = F.today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && F.today() !== lastDay) {
    if (ui.month === F.ymOf(lastDay)) ui.month = F.ymOf(F.today());
    lastDay = F.today();
    render();
  }
});

render();
if (!store.device.name) openWelcome();
sync.run();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading || sheets.length) return;
    reloading = true;
    location.reload();
  });
}
