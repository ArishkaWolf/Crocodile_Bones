import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, reduceGame, publicView, score, claimOptions, validClaim, canMakeSum, WILD_RULE, CARD_DECK, randomInt, totalRounds } from '../src/engine.js';

const die = (id, color, value, card = null) => ({ id, color, value, card });
function lobby(n = 3) {
  let s = createRoom({ code: 'ABC234', capacity: n, player: { id: 'p0', name: 'Игрок 1', avatar: 1 } });
  for (let i = 1; i < n; i++) s = reduceGame(s, 'p0', { type: 'join', player: { id: `p${i}`, name: `Игрок ${i + 1}`, avatar: i + 1 } });
  for (let i = 0; i < n; i++) s = reduceGame(s, `p${i}`, { type: 'ready', value: true });
  return s;
}
function start(n = 3) { return reduceGame(lobby(n), 'p0', { type: 'start' }); }
function collection(table, bids, first = 0) {
  let s = start(); s.first = first; s.phase = 'bidding'; s.table = table; s.active = null; s.deck = [];
  for (let i = 0; i < 3; i++) s = reduceGame(s, `p${i}`, { type: 'bid', value: bids[i] });
  return s;
}
function conserve(s) {
  const dice = [...s.bank, ...s.table, ...s.players.flatMap(p => p.dice)];
  assert.equal(dice.length, 36); assert.equal(new Set(dice.map(d => d.id)).size, 36);
  for (const c of ['blue', 'yellow', 'green']) assert.equal(dice.filter(d => d.color === c).length, 12);
  const cards = [s.active, ...s.deck, ...s.players.flatMap(p => p.cards)].filter(Boolean);
  assert.equal(cards.length, 10); assert.equal(new Set(cards.map(c => c.id)).size, 10);
}

test('deck, bank, random integer and exact sums', () => {
  assert.equal(CARD_DECK.length, 10); assert.equal(new Set(CARD_DECK.map(c => c.id)).size, 10);
  const s = start(); conserve(s);
  const range = new Set(Array.from({ length: 600 }, () => randomInt(6)));
  assert.deepEqual([...range].sort(), [0, 1, 2, 3, 4, 5]);
  assert.throws(() => randomInt(0));
  assert.equal(canMakeSum([die('a', 'blue', 4), die('b', 'blue', 2)], 6), true);
  assert.equal(canMakeSum([die('a', 'blue', 4), die('b', 'blue', 2)], 5), false);
  assert.equal(canMakeSum([], 0), false);
});
test('3 players draw 6, 4 players draw 9; only first player rolls', () => {
  for (const [n, batch] of [[3, 6], [4, 9]]) {
    const s = start(n); assert.throws(() => reduceGame(s, 'p1', { type: 'roll' }));
    const rolled = reduceGame(s, 'p0', { type: 'roll' }, () => 5);
    assert.equal(rolled.table.length, batch); assert.equal(rolled.bank.length, 36 - batch);
    assert.equal(rolled.table.every(d => d.value === 6), true); conserve(rolled);
  }
});
test('hidden bids are not sent to opponents before the simultaneous reveal', () => {
  let s = reduceGame(start(), 'p0', { type: 'roll' });
  s = reduceGame(s, 'p1', { type: 'bid', value: 7 });
  assert.deepEqual(publicView(s, 'p0').bids, {});
  assert.deepEqual(publicView(s, 'p1').bids, { p1: 7 });
  assert.equal('bank' in publicView(s, 'p1'), false); assert.equal('deck' in publicView(s, 'p1'), false);
  assert.deepEqual(publicView(s, 'p1').nextCard, s.deck[0]);
  assert.throws(() => reduceGame(s, 'p1', { type: 'bid', value: 2 }));
});
test('equal bids follow clockwise priority starting with the cup holder', () => {
  const s = collection([die('a', 'blue', 4), die('b', 'green', 4), die('c', 'yellow', 4)], [4, 4, 4], 1);
  assert.deepEqual(s.order, ['p1', 'p2', 'p0']); assert.equal(s.phase, 'collect');
});
test('take exact amount, cannot take wrong or repeated dice; input stays immutable', () => {
  const s = collection([die('a', 'blue', 4), die('b', 'green', 2), die('c', 'yellow', 6)], [6, 6, 6]);
  const snapshot = JSON.stringify(s);
  assert.throws(() => reduceGame(s, 'p1', { type: 'take', ids: ['c'] }));
  assert.throws(() => reduceGame(s, 'p0', { type: 'take', ids: ['a'] }));
  assert.throws(() => reduceGame(s, 'p0', { type: 'take', ids: ['c', 'c'] }));
  assert.equal(JSON.stringify(s), snapshot);
  const next = reduceGame(s, 'p0', { type: 'take', ids: ['a', 'b'] });
  assert.equal(next.players[0].dice.length, 2); assert.equal(next.table.length, 1); assert.equal(next.turn, 1);
});
test('unmakeable bids automatically skip instead of collecting a smaller amount', () => {
  let s = collection([die('a', 'blue', 3), die('b', 'green', 2)], [1, 3, 5]);
  assert.equal(s.order[s.turn], 'p1');
  s = reduceGame(s, 'p1', { type: 'take', ids: ['a'] });
  assert.equal(s.phase, 'roundEnd'); assert.equal(s.players[2].dice.length, 0); assert.equal(s.table[0].value, 2);
});
test('zero bids skip because at least one positive die is required', () => {
  const s = collection([die('a', 'blue', 1)], [0, 0, 1]);
  assert.equal(s.order[s.turn], 'p2');
});
test('cards force a manual choice when more matching dice are owned', () => {
  let s = collection([die('a', 'green', 2), die('b', 'green', 3), die('c', 'green', 5)], [10, 20, 21]);
  s.active = { id: '2green', color: 'green', count: 2 };
  s = reduceGame(s, 'p0', { type: 'take', ids: ['a', 'b', 'c'] });
  assert.equal(s.phase, 'claim'); assert.equal(s.pending.playerId, 'p0');
  assert.throws(() => reduceGame(s, 'p1', { type: 'claim', ids: ['a', 'b'] }));
  s = reduceGame(s, 'p0', { type: 'claim', ids: ['b', 'c'] });
  assert.equal(score(s.players[0]), 18); assert.equal(s.players[0].dice.find(d => d.id === 'a').card, null);
  assert.equal(s.players[0].dice.find(d => d.id === 'b').card, '2green');
});
test('new active card chains outside turn, resolving competitors from first player', () => {
  let s = collection([die('a', 'green', 1)], [1, 99, 99], 1);
  s.players[0].dice = [die('g', 'green', 2)];
  s.players[1].dice = [die('b1', 'blue', 2), die('b2', 'blue', 4)];
  s.players[2].dice = [die('b3', 'blue', 5), die('b4', 'blue', 6)];
  s.active = { id: '2green', color: 'green', count: 2 };
  s.deck = [{ id: '2blue', color: 'blue', count: 2 }];
  s = reduceGame(s, 'p0', { type: 'take', ids: ['a'] });
  assert.deepEqual(s.players[0].cards.map(c => c.id), ['2green']);
  assert.deepEqual(s.players[1].cards.map(c => c.id), ['2blue']);
  assert.equal(s.players[2].cards.length, 0); assert.equal(s.active, null); assert.equal(s.phase, 'roundEnd');
});
test('locked dice cannot be used for a new card and values never change', () => {
  const player = { dice: [die('a', 'green', 6, '2green'), die('b', 'green', 5, '2green'), die('c', 'green', 1)] };
  assert.equal(claimOptions(player, { color: 'green', count: 2 }, WILD_RULE).length, 0);
  assert.equal(validClaim(player.dice.slice(0, 2), { color: 'green', count: 2 }, WILD_RULE), false);
});
test('wild card is exactly two of each color and doubles all six values', () => {
  const dice = ['blue', 'yellow', 'green'].flatMap((c, i) => [die(`${i}a`, c, 5), die(`${i}b`, c, 6)]);
  assert.equal(validClaim(dice, { color: 'wild' }, WILD_RULE), true);
  assert.equal(validClaim(dice.slice(1), { color: 'wild' }, WILD_RULE), false);
  assert.equal(claimOptions({ dice }, { color: 'wild' }, WILD_RULE).length, 1);
  dice[0].color = 'green';
  assert.equal(validClaim(dice, { color: 'wild' }, WILD_RULE), false);
});
test('leftovers are rerolled with the next batch; first player rotates', () => {
  let s = reduceGame(start(), 'p0', { type: 'roll' }, () => 0);
  const oldIds = s.table.map(d => d.id);
  for (const p of s.players) s = reduceGame(s, p.id, { type: 'bid', value: 999 });
  assert.equal(s.phase, 'roundEnd'); s = reduceGame(s, 'p0', { type: 'next' });
  assert.equal(s.first, 1); assert.equal(s.round, 2);
  s = reduceGame(s, 'p1', { type: 'roll' }, () => 5);
  assert.equal(s.table.length, 12); assert.equal(s.table.every(d => d.value === 6), true);
  assert.equal(oldIds.every(id => s.table.some(d => d.id === id)), true); conserve(s);
});
test('no early finish before last round is collected; ties stay ties', () => {
  let s = start(4);
  for (let round = 1; round <= 4; round++) {
    s = reduceGame(s, s.players[s.first].id, { type: 'roll' });
    assert.equal(s.phase, 'bidding');
    for (const p of s.players) s = reduceGame(s, p.id, { type: 'bid', value: 999 });
    assert.equal(s.phase, round === 4 ? 'finished' : 'roundEnd'); conserve(s);
    if (round < 4) s = reduceGame(s, s.players[s.first].id, { type: 'next' });
  }
  assert.equal(s.players.every(p => score(p) === 0), true); assert.equal(s.table.length, 36);
});
test('lobby permissions, readiness, duplicate avatars and rematch', () => {
  let s = lobby();
  assert.throws(() => reduceGame(s, 'p1', { type: 'start' }));
  s = reduceGame(s, 'p0', { type: 'configure', first: 2 }); assert.equal(s.players.every(p => !p.ready), true);
  assert.throws(() => reduceGame(s, 'p0', { type: 'start' }));
  assert.throws(() => reduceGame(createRoom({ code: 'ABC234', capacity: 3, player: { id: 'a', name: 'a', avatar: 1 } }), 'a', { type: 'join', player: { id: 'b', name: 'b', avatar: 7 } }));
});
test('100 complete games conserve 36 dice and 10 cards through all choices', () => {
  for (let game = 0; game < 100; game++) {
    let s = start(game % 2 ? 3 : 4), guard = 0;
    while (s.phase !== 'finished') {
      assert.ok(++guard < 300);
      if (s.phase === 'roll') s = reduceGame(s, s.players[s.first].id, { type: 'roll' });
      else if (s.phase === 'bidding') {
        const player = s.players.find(p => !s.submitted.includes(p.id));
        const sample = s.table.filter(() => Math.random() > 0.65);
        s = reduceGame(s, player.id, { type: 'bid', value: sample.reduce((n, d) => n + d.value, 0) });
      } else if (s.phase === 'collect') {
        const id = s.order[s.turn], target = s.bids[id];
        const reachable = new Map([[0, []]]);
        for (const d of s.table) for (const [value, picked] of [...reachable]) if (value + d.value <= target && !reachable.has(value + d.value)) reachable.set(value + d.value, [...picked, d.id]);
        s = reduceGame(s, id, { type: 'take', ids: reachable.get(target) });
      } else if (s.phase === 'claim') {
        const p = s.players.find(p => p.id === s.pending.playerId);
        s = reduceGame(s, p.id, { type: 'claim', ids: claimOptions(p, s.active, s.wildRule)[0] });
      } else if (s.phase === 'roundEnd') s = reduceGame(s, s.players[s.first].id, { type: 'next' });
      else assert.fail(`unexpected ${s.phase}`);
      conserve(s);
    }
    assert.equal(s.round, totalRounds(s));
    const rematch = reduceGame(s, 'p0', { type: 'rematch' });
    assert.equal(rematch.phase, 'lobby'); assert.equal(rematch.players.every(p => !p.dice.length && !p.cards.length), true);
  }
});
