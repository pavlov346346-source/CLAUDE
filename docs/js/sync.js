// Синхронизация через приватный GitHub Gist.
// Каждый телефон пишет только в свои файлы d-<устройство>-<ГГГГ-ММ>.json,
// а читает все файлы. Поэтому два телефона никогда не перезаписывают
// данные друг друга, а итоговый список собирается слиянием по upd.

import { ls, mergeInto } from './store.js';

const API = 'https://api.github.com';
const MARKER = '_traty.json';
const FILE_RE = /^d-[a-z0-9]+-\d{4}-\d{2}\.json$/;
const POLL_MS = 20000;

export const TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=gist&description=' + encodeURIComponent('Деньги любят (приложение)');

class SyncError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class Sync {
  constructor(store) {
    this.store = store;
    this.cfg = ls.get('sync', null); // { token, login, gist, etag, last }
    this.own = ls.get('own', { name: '', recs: {} }); // наш текущий файл в gist
    this.state = this.connected ? 'idle' : 'off';
    this.error = '';
    this.running = false;
    this.again = false;
    this.useEtag = true;
    this.listeners = new Set();
    this.timer = null;

    store.on((source) => {
      if (source === 'local') this.schedule(400);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.run();
    });
    window.addEventListener('online', () => this.run());
    setInterval(() => {
      if (document.visibilityState === 'visible') this.run();
    }, POLL_MS);
  }

  get connected() {
    return !!(this.cfg && this.cfg.token);
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setState(state, error = '') {
    this.state = state;
    this.error = error;
    for (const fn of this.listeners) fn();
  }

  save() {
    ls.set('sync', this.cfg);
  }

  schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), ms);
  }

  async api(path, { method = 'GET', body, headers = {}, token } = {}) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + (token || this.cfg.token),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new SyncError('offline', 'Нет связи с GitHub');
    }
    if (res.status === 401) throw new SyncError('auth', 'Токен недействителен или отозван');
    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      throw new SyncError('rate', 'GitHub временно ограничил запросы, попробуем позже');
    }
    return res;
  }

  async findOrCreateGist(token) {
    const found = [];
    for (let page = 1; page <= 10; page++) {
      const res = await this.api(`/gists?per_page=100&page=${page}`, { token });
      if (res.status === 403 || res.status === 404) {
        throw new SyncError('scope', 'У токена нет доступа к gist — при создании отметьте галочку «gist»');
      }
      if (!res.ok) throw new SyncError('http', `GitHub ответил ${res.status}`);
      const list = await res.json();
      for (const g of list) if (g.files && g.files[MARKER]) found.push(g);
      if (found.length || list.length < 100) break;
    }
    if (found.length) {
      found.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      return found[0].id;
    }
    const res = await this.api('/gists', {
      method: 'POST',
      token,
      body: {
        description: 'Деньги любят — данные приложения. Не удаляйте этот gist.',
        public: false,
        files: {
          [MARKER]: {
            content: JSON.stringify({ app: 'traty', version: 1, created: new Date().toISOString() }, null, 2),
          },
        },
      },
    });
    if (res.status === 403 || res.status === 404) {
      throw new SyncError('scope', 'У токена нет доступа к gist — при создании отметьте галочку «gist»');
    }
    if (!res.ok) throw new SyncError('http', `Не удалось создать gist (${res.status})`);
    return (await res.json()).id;
  }

  // Подключение по токену: проверяем токен, находим (или создаём) gist
  async connect(rawToken) {
    const token = rawToken.trim();
    if (!token) throw new SyncError('input', 'Вставьте токен');
    const res = await this.api('/user', { token });
    if (!res.ok) throw new SyncError('http', `GitHub ответил ${res.status}`);
    const user = await res.json();
    const gist = await this.findOrCreateGist(token);
    this.cfg = { token, login: user.login, gist, etag: '', last: 0 };
    this.own = { name: '', recs: {} };
    ls.set('own', this.own);
    this.save();
    this.setState('idle');
    await this.run();
  }

  disconnect() {
    this.cfg = null;
    ls.del('sync');
    this.own = { name: '', recs: {} };
    ls.set('own', this.own);
    this.store.detachRemote();
    this.setState('off');
  }

  ownFileName() {
    const d = new Date();
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return `d-${this.store.device.id}-${ym}.json`;
  }

  async run() {
    if (!this.connected) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.setState('busy');
    try {
      if (!navigator.onLine) throw new SyncError('offline', 'Нет интернета');
      if (!this.cfg.gist) {
        this.cfg.gist = await this.findOrCreateGist();
        this.save();
      }
      await this.pull();
      if (this.store.pendingCount) await this.push();
      this.cfg.last = Date.now();
      this.save();
      this.setState('idle');
    } catch (e) {
      const code = e.code || 'http';
      this.setState(code === 'offline' ? 'offline' : 'error', e.message || 'Ошибка синхронизации');
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.schedule(50);
      }
    }
  }

  // gist удалили: найдём или создадим новый и отправим туда всё, что знаем
  lostGist() {
    this.cfg.gist = '';
    this.cfg.etag = '';
    this.save();
    this.own = { name: '', recs: {} };
    ls.set('own', this.own);
    this.store.detachRemote();
    this.again = true;
    throw new SyncError('http', 'Хранилище не найдено, создаём заново…');
  }

  async pull() {
    const headers = {};
    if (this.useEtag && this.cfg.etag) headers['If-None-Match'] = this.cfg.etag;
    let res;
    try {
      res = await this.api(`/gists/${this.cfg.gist}`, { headers });
    } catch (e) {
      // если браузер не пропустил условный запрос — повторяем без него
      if (e.code === 'offline' && headers['If-None-Match']) {
        this.useEtag = false;
        res = await this.api(`/gists/${this.cfg.gist}`);
      } else throw e;
    }
    if (res.status === 304) return;
    if (res.status === 404) this.lostGist();
    if (!res.ok) throw new SyncError('http', `GitHub ответил ${res.status}`);
    const gist = await res.json();
    const ownName = this.ownFileName();
    const incoming = [];
    const devices = new Set([this.store.device.id]);
    for (const f of Object.values(gist.files || {})) {
      if (!FILE_RE.test(f.filename)) continue;
      devices.add(f.filename.split('-')[1]);
      let text = f.content;
      if (f.truncated || text == null) {
        const raw = await fetch(f.raw_url, { cache: 'no-store' });
        text = await raw.text();
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        continue;
      }
      const recs = Array.isArray(data.recs) ? data.recs : [];
      incoming.push(...recs);
      if (f.filename === ownName) {
        if (this.own.name !== ownName) this.own = { name: ownName, recs: {} };
        if (mergeInto(this.own.recs, recs)) ls.set('own', this.own);
      }
    }
    this.store.applyRemote(incoming);
    this.cfg.cloud = { devices: devices.size, recs: incoming.length };
    this.cfg.etag = res.headers.get('ETag') || '';
    this.save();
  }

  async push() {
    const name = this.ownFileName();
    if (this.own.name !== name) this.own = { name, recs: {} };
    const snapshot = { ...this.store.pending };
    const recs = { ...this.own.recs };
    mergeInto(recs, Object.values(snapshot));
    const list = Object.values(recs).sort((a, b) => a.upd - b.upd);
    const content =
      `{"v":1,"dev":${JSON.stringify(this.store.device.id)},"who":${JSON.stringify(this.store.device.name || '')},"recs":[\n` +
      list.map((r) => JSON.stringify(r)).join(',\n') +
      '\n]}\n';
    const res = await this.api(`/gists/${this.cfg.gist}`, {
      method: 'PATCH',
      body: { files: { [name]: { content } } },
    });
    if (res.status === 404) this.lostGist();
    if (!res.ok) throw new SyncError('http', `Не удалось сохранить (${res.status})`);
    this.own = { name, recs };
    ls.set('own', this.own);
    this.store.confirmPushed(snapshot);
  }
}
