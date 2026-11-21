import { createRoom, reduceGame, publicView, randomInt, AVATAR_COUNT } from '../src/engine.js';
const TTL = 24 * 60 * 60 * 1000;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Player-Id', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
function problem(message, status = 400) { const err = new Error(message); err.status = status; throw err; }
async function hash(token) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)); return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join(''); }
function validateProfile(profile) {
  if (!profile || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.trim().length > 20 || !Number.isInteger(profile.avatar) || profile.avatar < 1 || profile.avatar > AVATAR_COUNT) problem('Введите имя до 20 символов и выберите персонажа.');
  return { name: profile.name.trim(), avatar: profile.avatar };
}
function snapshot(data, id) {
  const s = publicView(data.state, id);
  for (const p of s.players) p.online = Date.now() - (data.seen[p.id] || 0) < 45000;
  return { state: s };
}
async function authenticate(data, req) {
  const id = req.headers.get('X-Player-Id'), bearer = req.headers.get('Authorization') || '';
  if (!id || !bearer.startsWith('Bearer ') || data.tokens[id] !== await hash(bearer.slice(7))) problem('Ваше место в комнате недоступно. Войдите снова.', 401);
  return id;
}
async function read(DB, code) {
  const row = await DB.prepare('SELECT data, rev, expires FROM rooms WHERE code = ?').bind(code).first();
  if (!row || row.expires < Date.now()) problem('Комната закрыта или срок её хранения истёк.', 404);
  return { data: JSON.parse(row.data), rev: row.rev };
}
async function write(DB, code, data, rev) {
  const result = await DB.prepare('UPDATE rooms SET data = ?, rev = rev + 1, expires = ? WHERE code = ? AND rev = ?').bind(JSON.stringify(data), Date.now() + TTL, code, rev).run();
  return result.meta.changes === 1;
}
async function body(req) {
  const text = await req.text(); if (text.length > 12000) problem('Слишком большой запрос.', 413);
  try { return JSON.parse(text || '{}'); } catch { problem('Некорректный запрос.'); }
}
export async function handleAPI(req, env) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (url.pathname === '/api/health') return json({ ok: true });
  if (!env.DB) return json({ error: 'Сервер комнат ещё не подключён к базе данных.' }, 503);
  try {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api' || parts[1] !== 'rooms') problem('Не найдено.', 404);
    if (parts.length === 2 && req.method === 'POST') {
      const { profile, capacity } = await body(req), clean = validateProfile(profile);
      const identity = { id: crypto.randomUUID(), token: crypto.randomUUID() + crypto.randomUUID(), ...clean };
      const tokenHash = await hash(identity.token);
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('');
        const state = createRoom({ code, capacity, player: { id: identity.id, ...clean } });
        const data = { state, tokens: { [identity.id]: tokenHash }, seen: { [identity.id]: Date.now() }, requests: [] };
        const inserted = await env.DB.prepare('INSERT OR IGNORE INTO rooms(code,data,rev,expires) VALUES (?,?,1,?)').bind(code, JSON.stringify(data), Date.now() + TTL).run();
        if (inserted.meta.changes) {
          await env.DB.prepare('DELETE FROM rooms WHERE code IN (SELECT code FROM rooms WHERE expires < ? LIMIT 20)').bind(Date.now()).run();
          return json({ ...snapshot(data, identity.id), identity }, 201);
        }
      }
      problem('Не удалось подобрать код комнаты. Повторите попытку.', 503);
    }
    const code = parts[2];
    if (!/^[A-Z0-9]{6}$/.test(code || '')) problem('Код комнаты состоит из 6 символов.');
    const operation = parts[3] || '';
    const payload = req.method === 'POST' ? await body(req) : {};
    const newIdentity = operation === 'join' ? { id: crypto.randomUUID(), token: crypto.randomUUID() + crypto.randomUUID(), ...validateProfile(payload.profile) } : null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data, rev } = await read(env.DB, code);
      if (req.method === 'POST' && operation === 'join') {
        const p = { id: newIdentity.id, name: newIdentity.name, avatar: newIdentity.avatar };
        data.state = reduceGame(data.state, data.state.hostId, { type: 'join', player: p });
        data.tokens[p.id] = await hash(newIdentity.token); data.seen[p.id] = Date.now();
        if (await write(env.DB, code, data, rev)) return json({ ...snapshot(data, p.id), identity: newIdentity });
        continue;
      }
      const id = await authenticate(data, req);
      if (req.method === 'GET' && !operation) {
        if (Date.now() - (data.seen[id] || 0) > 12000) {
          data.seen[id] = Date.now();
          if (!await write(env.DB, code, data, rev)) continue;
        }
        return json(snapshot(data, id));
      }
      if (req.method === 'POST' && operation === 'leave') {
        if (id === data.state.hostId) {
          const removed = await env.DB.prepare('DELETE FROM rooms WHERE code = ? AND rev = ?').bind(code, rev).run();
          if (!removed.meta.changes) continue;
          return json({ ok: true });
        }
        data.seen[id] = 0;
        if (data.state.phase === 'lobby') { data.state = reduceGame(data.state, data.state.hostId, { type: 'remove', playerId: id }); delete data.tokens[id]; }
        if (await write(env.DB, code, data, rev)) return json({ ok: true });
        continue;
      }
      if (req.method === 'POST' && operation === 'action') {
        if (typeof payload.requestId !== 'string' || payload.requestId.length > 100) problem('Нет идентификатора действия.');
        if (data.requests.includes(`${id}:${payload.requestId}`)) return json(snapshot(data, id));
        const type = payload.action?.type;
        if (!['ready', 'configure', 'start', 'roll', 'bid', 'take', 'claim', 'next', 'rematch', 'remove'].includes(type)) problem('Неизвестное действие.');
        if (id !== data.state.hostId && !['ready', 'roll', 'bid', 'take', 'claim', 'next'].includes(type)) problem('Действие доступно только создателю.', 403);
        for (const p of data.state.players) p.online = Date.now() - (data.seen[p.id] || 0) < 45000;
        data.seen[id] = Date.now();
        data.state = reduceGame(data.state, id, payload.action);
        if (type === 'remove') { delete data.tokens[payload.action.playerId]; delete data.seen[payload.action.playerId]; }
        data.requests.push(`${id}:${payload.requestId}`); data.requests = data.requests.slice(-100);
        if (await write(env.DB, code, data, rev)) return json(snapshot(data, id));
        continue;
      }
      problem('Не найдено.', 404);
    }
    problem('Комната обновляется. Повторите действие.', 409);
  } catch (error) {
    if (!error.status && /D1|SQLITE|no such table|database/i.test(error.message)) { console.error('Room database:', error.message); return json({ error: 'Сервер комнат временно недоступен.' }, 503); }
    return json({ error: error.message || 'Не удалось обработать действие.' }, error.status || 400);
  }
}
