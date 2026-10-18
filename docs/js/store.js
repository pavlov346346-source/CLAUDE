// Хранилище записей. Всё, что есть в приложении (траты, категории, общие
// настройки), — это записи { id, kind, upd, dev, del?, ... }.
// При слиянии побеждает запись с бо́льшим upd (last-write-wins), поэтому
// изменения с двух телефонов складываются без конфликтов.

const PREFIX = 'traty.';

export const ls = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* хранилище недоступно — работаем в памяти */
    }
  },
  del(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  },
};

export function uid(len = 12) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

// true, если запись a новее b
export function newer(a, b) {
  if (!b) return true;
  if (!a) return false;
  if (a.upd !== b.upd) return a.upd > b.upd;
  return String(a.dev || '') > String(b.dev || '');
}

export function mergeInto(target, recs) {
  let changed = false;
  for (const r of recs) {
    if (!r || !r.id) continue;
    if (newer(r, target[r.id])) {
      target[r.id] = r;
      changed = true;
    }
  }
  return changed;
}

export const COLORS = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red', 'gray'];

const cat = (id, emoji, name, color, order) => ({ id: 'cat-' + id, kind: 'cat', emoji, name, color, order, upd: 0, dev: '' });

export const DEFAULT_CATS = [
  cat('food', '🛒', 'Продукты', 'blue', 1),
  cat('cafe', '☕️', 'Кафе', 'orange', 2),
  cat('transport', '🚕', 'Транспорт', 'aqua', 3),
  cat('home', '🏠', 'Дом', 'yellow', 4),
  cat('shopping', '🛍️', 'Покупки', 'magenta', 5),
  cat('fun', '🎬', 'Развлечения', 'violet', 6),
  cat('health', '💊', 'Здоровье', 'green', 7),
  cat('gifts', '🎁', 'Подарки', 'red', 8),
  cat('beauty', '💅', 'Красота', 'magenta', 9),
  cat('connection', '📱', 'Связь', 'violet', 10),
  cat('travel', '✈️', 'Путешествия', 'blue', 11),
  cat('subs', '📺', 'Подписки', 'red', 12),
  cat('matvey', '👦', 'Матвей', 'aqua', 13),
  cat('other', '📦', 'Другое', 'gray', 99),
];
const DEFAULT_IDS = new Set(DEFAULT_CATS.map((c) => c.id));
const normName = (s) => String(s || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

export const CFG_ID = 'cfg';
const DEFAULT_CFG = { id: CFG_ID, kind: 'cfg', currency: '₽', budget: 0, upd: 0, dev: '' };

export class Store {
  constructor() {
    let device = ls.get('device', null);
    if (!device || !device.id) {
      device = { id: uid(8), name: '' };
      ls.set('device', device);
    }
    this.device = device;
    this.remote = ls.get('remote', {}); // слитые записи из облака
    this.pending = ls.get('pending', {}); // локальные изменения, ещё не отправленные
    this.listeners = new Set();
    this.recompute();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(source) {
    for (const fn of this.listeners) fn(source);
  }

  recompute() {
    const all = {};
    mergeInto(all, DEFAULT_CATS);
    mergeInto(all, [DEFAULT_CFG]);
    mergeInto(all, Object.values(this.remote));
    mergeInto(all, Object.values(this.pending));
    this.all = all;

    const expenses = [];
    const cats = [];
    for (const r of Object.values(all)) {
      if (r.kind === 'exp' && !r.del) expenses.push(r);
      else if (r.kind === 'cat') cats.push(r);
    }
    expenses.sort((a, b) => (a.date === b.date ? b.created - a.created : a.date < b.date ? 1 : -1));
    cats.sort((a, b) => a.order - b.order);

    // Категории с одинаковым названием (созданные вручную на двух телефонах или
    // совпавшие со стандартной) считаем одной: главной — созданную вручную.
    this.alias = {};
    const byName = {};
    for (const c of cats) if (!c.del) (byName[normName(c.name)] ||= []).push(c);
    for (const group of Object.values(byName)) {
      if (group.length < 2) continue;
      group.sort((a, b) => DEFAULT_IDS.has(a.id) - DEFAULT_IDS.has(b.id) || (a.id < b.id ? -1 : 1));
      for (const c of group.slice(1)) this.alias[c.id] = group[0].id;
    }

    this.expenses = expenses;
    this.cats = cats.filter((c) => !this.alias[c.id]);
    this.catMap = Object.fromEntries(cats.map((c) => [c.id, c]));
    this.cfg = all[CFG_ID];
  }

  // id категории с учётом объединения одноимённых
  canon(id) {
    return this.alias[id] || id;
  }

  get pendingCount() {
    return Object.keys(this.pending).length;
  }

  // Сохранить (создать или обновить) запись локально
  put(rec) {
    const prev = this.all[rec.id];
    const upd = Math.max(Date.now(), (prev?.upd || 0) + 1);
    const next = { ...rec, upd, dev: this.device.id };
    this.pending[next.id] = next;
    ls.set('pending', this.pending);
    this.recompute();
    this.emit('local');
    return next;
  }

  remove(id) {
    const prev = this.all[id];
    if (!prev) return null;
    return this.put({ ...prev, del: 1 });
  }

  addExpense({ amount, cat, date, note, who }) {
    return this.put({
      id: uid(),
      kind: 'exp',
      amount,
      cat,
      date,
      note: note || '',
      who: who || this.device.name || '',
      created: Date.now(),
    });
  }

  setCfg(patch) {
    return this.put({ ...this.cfg, ...patch });
  }

  setDeviceName(name) {
    this.device.name = name;
    ls.set('device', this.device);
    this.emit('device');
  }

  // Данные пришли из облака
  applyRemote(recs) {
    const changed = mergeInto(this.remote, recs);
    if (!changed) return false;
    ls.set('remote', this.remote);
    this.recompute();
    this.emit('remote');
    return true;
  }

  // Записи из snapshot успешно отправлены: убираем их из очереди,
  // если они не успели измениться за время отправки.
  confirmPushed(snapshot) {
    const recs = Object.values(snapshot);
    for (const r of recs) {
      const cur = this.pending[r.id];
      if (cur && cur.upd === r.upd && cur.dev === r.dev) delete this.pending[r.id];
    }
    mergeInto(this.remote, recs);
    ls.set('pending', this.pending);
    ls.set('remote', this.remote);
    this.recompute();
    this.emit('pushed');
  }

  // Отключение синхронизации: всё, что было, становится локальным,
  // чтобы при повторном подключении снова уйти в облако.
  detachRemote() {
    mergeInto(this.pending, Object.values(this.remote));
    this.remote = {};
    ls.set('pending', this.pending);
    ls.set('remote', this.remote);
    this.recompute();
    this.emit('local');
  }

  people() {
    const count = {};
    for (const e of this.expenses) if (e.who) count[e.who] = (count[e.who] || 0) + 1;
    const me = this.device.name;
    if (me) count[me] = (count[me] || 0) + 1e9;
    return Object.keys(count).sort((a, b) => count[b] - count[a]);
  }
}
