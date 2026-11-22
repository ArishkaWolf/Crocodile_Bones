const STORE = 'crocodile-room-v2';
export const normalizeCode = value => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const API = (import.meta.env.VITE_ROOM_SERVER || '').replace(/\/$/, '');

export class RoomConnection {
  constructor(callbacks) { Object.assign(this, callbacks); this.stopped = false; this.state = null; this.signature = null; this.polling = false; }
  static saved() { try { return JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch { return null; } }
  static discard() { try { sessionStorage.removeItem(STORE); } catch {} }
  save() { try { sessionStorage.setItem(STORE, JSON.stringify({ code: this.code, identity: this.identity, role: this.role })); } catch {} }
  async request(path = '', method = 'GET', body) {
    let response;
    try {
      response = await fetch(`${API}/api/rooms${path}`, {
        method, cache: 'no-store', signal: AbortSignal.timeout(12000),
        headers: { 'Content-Type': 'application/json', ...(this.identity?.token ? { Authorization: `Bearer ${this.identity.token}`, 'X-Player-Id': this.identity.id } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error('Не удалось связаться с комнатой. Проверьте интернет.'); }
    let data;
    try { data = await response.json(); } catch { throw new Error('Сервер комнат не настроен. Для GitHub Pages укажите VITE_ROOM_SERVER при сборке.'); }
    if (!response.ok) { const err = new Error(data.error || 'Комната не ответила.'); err.status = response.status; throw err; }
    return data;
  }
  receive(data) {
    if (this.stopped) return;
    if (this.state && data.state.version < this.state.version) return;
    if (this.state && data.state.version === this.state.version && (data.state.social?.revision || 0) < (this.state.social?.revision || 0)) return;
    const previous = this.state; this.state = data.state;
    this.role = data.state.hostId === this.identity.id ? 'host' : 'guest';
    this.onStatus('online'); this.save();
    const signature = `${data.state.version}:${data.state.phase === 'lobby' ? data.state.players.map(p => `${p.id}:${p.online}`).join(',') : ''}`;
    if (!previous || signature !== this.signature) { this.signature = signature; this.onState(data.state, this.identity.id); }
    else this.onSocial?.(data.state.social);
  }
  async create(profile, capacity) {
    this.onStatus('connecting');
    const result = await this.request('', 'POST', { profile, capacity });
    this.identity = result.identity; this.code = result.state.code; this.receive(result); this.schedulePoll();
    return this.code;
  }
  async join(profile, code) {
    this.code = normalizeCode(code); this.onStatus('connecting');
    const result = await this.request(`/${this.code}/join`, 'POST', { profile });
    this.identity = result.identity; this.receive(result); this.schedulePoll();
  }
  async restore(saved) {
    this.code = saved.code; this.identity = saved.identity; this.role = saved.role; this.onStatus('connecting');
    this.receive(await this.request(`/${this.code}`)); this.schedulePoll();
  }
  schedulePoll(delay) {
    clearTimeout(this.timer); if (this.stopped) return;
    this.timer = setTimeout(() => this.poll(), delay ?? (document.hidden ? 5000 : 550));
  }
  async poll() {
    if (this.stopped || this.polling) return; this.polling = true;
    try { this.receive(await this.request(`/${this.code}`)); }
    catch (err) {
      if ([401, 403, 404, 410].includes(err.status)) { this.stopped = true; RoomConnection.discard(); this.onClosed(err.message); }
      else this.onStatus('reconnecting');
    } finally { this.polling = false; this.schedulePoll(); }
  }
  async action(action) {
    if (this.stopped) throw new Error('Соединение с комнатой закрыто.');
    const result = await this.request(`/${this.code}/action`, 'POST', { action, requestId: crypto.randomUUID() });
    this.receive(result);
  }
  async signal(signal) {
    if (this.stopped) return;
    this.receive(await this.request(`/${this.code}/signal`, 'POST', { signal, requestId: crypto.randomUUID() }));
  }
  kick(id) { return this.action({ type: 'remove', playerId: id }); }
  close(clear = true) {
    if (this.stopped) return;
    this.stopped = true; clearTimeout(this.timer);
    if (clear) { this.request(`/${this.code}/leave`, 'POST', {}).catch(() => {}); RoomConnection.discard(); }
  }
}
