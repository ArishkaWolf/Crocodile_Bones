import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAPI } from '../server/api.js';
import { localDatabase } from '../server/local-db.js';

function fixture() {
  const DB = localDatabase(':memory:');
  return {
    DB,
    async call(path = '', { method = 'GET', data, identity } = {}) {
      const request = new Request(`https://game.example/api/rooms${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(identity ? { Authorization: `Bearer ${identity.token}`, 'X-Player-Id': identity.id } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      const response = await handleAPI(request, { DB });
      return { status: response.status, ...await response.json() };
    },
  };
}
test('room creation, concurrent joins, authorization and private snapshots', async () => {
  const f = fixture();
  try {
    const host = await f.call('', { method: 'POST', data: { capacity: 3, profile: { name: 'Арина', avatar: 6 } } });
    assert.equal(host.status, 201); const code = host.state.code;
    const [a, b] = await Promise.all([5, 4].map(avatar => f.call(`/${code}/join`, { method: 'POST', data: { profile: { name: `Игрок ${avatar}`, avatar } } })));
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    const read = await f.call(`/${code}`, { identity: host.identity });
    assert.equal(read.state.players.length, 3);
    assert.equal((await f.call(`/${code}`)).status, 401);
    assert.equal('bank' in read.state, false); assert.equal('deck' in read.state, false); assert.equal('tokens' in read, false);
    assert.equal(JSON.stringify(read).includes(host.identity.token), false);
    assert.equal((await f.call(`/${code}/join`, { method: 'POST', data: { profile: { name: 'Лишний', avatar: 2 } } })).status, 400);
    for (const p of [host, a, b]) await f.call(`/${code}/action`, { method: 'POST', identity: p.identity, data: { action: { type: 'ready', value: true }, requestId: crypto.randomUUID() } });
    const action = (p, action, requestId = crypto.randomUUID()) => f.call(`/${code}/action`, { method: 'POST', identity: p.identity, data: { action, requestId } });
    assert.equal((await action(a, { type: 'start' })).status, 403);
    assert.equal((await action(host, { type: 'start' })).state.phase, 'roll');
    const rolled = await action(host, { type: 'roll' }); assert.equal(rolled.state.table.length, 6);
    const requestId = crypto.randomUUID();
    assert.equal((await action(a, { type: 'bid', value: 5 }, requestId)).status, 200);
    assert.equal((await action(a, { type: 'bid', value: 5 }, requestId)).status, 200);
    assert.deepEqual((await f.call(`/${code}`, { identity: host.identity })).state.bids, {});
    assert.deepEqual((await f.call(`/${code}`, { identity: a.identity })).state.bids, { [a.identity.id]: 5 });
    await action(host, { type: 'bid', value: 999 });
    const revealed = await action(b, { type: 'bid', value: 999 }); assert.equal(Object.keys(revealed.state.bids).length, 3);
    assert.equal((await action(a, { type: 'presence', playerId: host.identity.id, online: false })).status, 400);
    await f.call(`/${code}/leave`, { method: 'POST', identity: host.identity, data: {} });
    assert.equal((await f.call(`/${code}`, { identity: a.identity })).status, 404);
  } finally { f.DB.close(); }
});
test('concurrent bids survive compare-and-swap without lost actions', async () => {
  const f = fixture();
  try {
    const host = await f.call('', { method: 'POST', data: { capacity: 4, profile: { name: 'A', avatar: 1 } } });
    const code = host.state.code; const players = [host];
    for (const avatar of [2, 3, 4]) players.push(await f.call(`/${code}/join`, { method: 'POST', data: { profile: { name: String(avatar), avatar } } }));
    const action = (p, a) => f.call(`/${code}/action`, { method: 'POST', identity: p.identity, data: { action: a, requestId: crypto.randomUUID() } });
    await Promise.all(players.map(p => action(p, { type: 'ready', value: true })));
    await action(host, { type: 'start' }); await action(host, { type: 'roll' });
    const bids = await Promise.all(players.map(p => action(p, { type: 'bid', value: 999 })));
    assert.equal(bids.every(r => r.status === 200), true);
    const final = await f.call(`/${code}`, { identity: host.identity });
    assert.equal(final.state.submitted.length, 4); assert.equal(final.state.phase, 'roundEnd');
    const next = await action(host, { type: 'next' });
    const guestRoll = await action(players[1], { type: 'roll' });
    assert.equal(next.state.first, 1); assert.equal(guestRoll.status, 200); assert.equal(guestRoll.state.table.length, 18);
  } finally { f.DB.close(); }
});

test('room signals authenticate participants, deduplicate reactions and reach other players', async () => {
  const f=fixture();
  try {
    const host=await f.call('',{method:'POST',data:{capacity:3,profile:{name:'A',avatar:1}}}), code=host.state.code;
    const guest=await f.call(`/${code}/join`,{method:'POST',data:{profile:{name:'B',avatar:2}}});
    const payload={signal:{type:'reaction',sticker:25},requestId:crypto.randomUUID()};
    assert.equal((await f.call(`/${code}/signal`,{method:'POST',data:payload})).status,401);
    const sent=await f.call(`/${code}/signal`,{method:'POST',identity:guest.identity,data:payload});
    assert.equal(sent.status,200);
    const again=await f.call(`/${code}/signal`,{method:'POST',identity:guest.identity,data:payload});
    assert.equal(again.state.social.reactions.length,1);
    const received=await f.call(`/${code}`,{identity:host.identity});
    assert.equal(received.state.social.reactions[0].playerId,guest.identity.id);
    assert.equal(received.state.social.reactions[0].sticker,25);
    assert.equal(received.state.version,sent.state.version);
    assert.equal((await f.call(`/${code}/signal`,{method:'POST',identity:guest.identity,data:{signal:{type:'selection',ids:[],rollId:0,turn:0},requestId:crypto.randomUUID()}})).status,400);
  } finally {f.DB.close();}
});
