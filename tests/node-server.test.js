import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createGameServer } from '../server/node.js';
import { localDatabase } from '../server/local-db.js';

test('standalone online server serves the game and shares authenticated rooms over HTTP', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'croc-http-'));
  const clientRoot = path.join(temporary, 'client');
  await mkdir(clientRoot); await writeFile(path.join(clientRoot, 'index.html'), '<title>Кости Крокодила</title>');
  await writeFile(path.join(temporary, 'private.txt'), 'must not be served');
  const DB = localDatabase(':memory:');
  const server = createGameServer({ database: DB, clientRoot });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const homepage = await fetch(base); assert.equal(homepage.status, 200);
    assert.match(await homepage.text(), /Кости Крокодила/);
    assert.deepEqual(await fetch(base + '/api/health').then(r => r.json()), { ok: true });
    assert.equal((await fetch(base + '/%2e%2e%2fprivate.txt')).status, 404);
    assert.equal((await fetch(base + '/.env')).status, 404);
    const create = await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capacity: 3, profile: { name: 'Первый', avatar: 1 } }) }).then(r => r.json());
    const code = create.state.code;
    const join = await fetch(`${base}/api/rooms/${code}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { name: 'Второй', avatar: 6 } }) }).then(r => r.json());
    const headers = { Authorization: `Bearer ${create.identity.token}`, 'X-Player-Id': create.identity.id };
    const read = await fetch(`${base}/api/rooms/${code}`, { headers }).then(r => r.json());
    assert.equal(read.state.players.length, 2); assert.equal(read.state.players[1].name, 'Второй');
    assert.equal(join.state.players[1].avatar, 6);
    assert.equal(JSON.stringify(read).includes(join.identity.token), false);
    assert.equal((await fetch(`${base}/api/rooms/${code}`)).status, 401);
    const response = await fetch(base + '/api/rooms', { method: 'OPTIONS', headers: { Origin: 'https://example.github.io' } });
    assert.equal(response.status, 204); assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  } finally {
    const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; DB.close();
    const resolved = path.resolve(temporary);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir())); assert.ok(path.basename(resolved).startsWith('croc-http-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
