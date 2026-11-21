// Pure authoritative game rules. Only the room owner holds this complete state.
export const COLORS = ['blue', 'yellow', 'green'];
export const AVATAR_COUNT = 6;
export const CARD_DECK = [...COLORS.flatMap(color => [2, 3, 4].map(count => ({ id: `${count}${color}`, color, count }))), { id: 'change', color: 'wild', count: 0 }];
export const COLOR_NAMES = { blue: 'голубых', yellow: 'жёлтых', green: 'зелёных' };
export const WILD_RULE = { kind: 'mixed', counts: { blue: 2, yellow: 2, green: 2 } };

export function randomInt(max) {
  if (!Number.isInteger(max) || max < 1 || max > 4294967296) throw new Error('Invalid random range');
  const limit = Math.floor(4294967296 / max) * max;
  const sample = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(sample); } while (sample[0] >= limit);
  return sample[0] % max;
}

export function shuffle(items, rng = randomInt) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const fail = message => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
export const score = player => player.dice.reduce((sum, d) => sum + d.value * (d.card ? 2 : 1), 0);
export const clockwise = state => Array.from({ length: state.players.length }, (_, i) => state.players[(state.first + i) % state.players.length]);
export const totalRounds = state => state.capacity === 4 ? 4 : 6;
export const batchSize = state => state.capacity === 4 ? 9 : 6;

export function createRoom({ code, capacity, player }) {
  assert(capacity === 3 || capacity === 4, 'Комната рассчитана на 3 или 4 игроков.');
  return {
    version: 1, code, capacity, phase: 'lobby', hostId: player.id,
    players: [{ ...player, ready: false, online: true, dice: [], cards: [] }],
    first: 0, round: 0, bank: [], deck: [], active: null, table: [],
    bids: {}, submitted: [], order: [], turn: 0, pending: null,
    wildRule: structuredClone(WILD_RULE), log: [], rollId: 0,
  };
}

function event(s, text, type = 'info') {
  s.log.push({ id: s.log.length ? s.log.at(-1).id + 1 : 1, round: s.round, text, type });
  if (s.log.length > 80) s.log.shift();
}

export function canMakeSum(dice, target) {
  if (!Number.isSafeInteger(target) || target <= 0) return false;
  const sum = dice.reduce((n, d) => n + d.value, 0);
  if (target > sum) return false;
  const possible = new Uint8Array(target + 1);
  possible[0] = 1;
  for (const { value } of dice) for (let n = target; n >= value; n--) possible[n] ||= possible[n - value];
  return possible[target] === 1;
}

export function validWildRule(rule) {
  if (!rule || !['same', 'any', 'mixed'].includes(rule.kind)) return false;
  if (rule.kind === 'mixed') return COLORS.every(c => Number.isInteger(rule.counts?.[c]) && rule.counts[c] >= 0 && rule.counts[c] <= 12) && COLORS.reduce((n, c) => n + rule.counts[c], 0) > 0;
  return Number.isInteger(rule.count) && rule.count > 0 && rule.count <= (rule.kind === 'same' ? 12 : 36);
}

// Used only to detect eligibility and a forced, unique assignment. Stop after two
// solutions to avoid enumerating large collections for the configurable wild card.
export function claimOptions(player, card, wildRule) {
  const free = player.dice.filter(d => !d.card);
  if (!card) return [];
  if (card.color !== 'wild') {
    const candidates = free.filter(d => d.color === card.color);
    if (candidates.length < card.count) return [];
    if (candidates.length === card.count) return [candidates.map(d => d.id)];
    return [candidates.slice(0, card.count).map(d => d.id), candidates.slice(1, card.count + 1).map(d => d.id)];
  }
  if (!validWildRule(wildRule)) return [];
  if (wildRule.kind === 'any') {
    if (free.length < wildRule.count) return [];
    if (free.length === wildRule.count) return [free.map(d => d.id)];
    return [free.slice(0, wildRule.count).map(d => d.id), free.slice(1, wildRule.count + 1).map(d => d.id)];
  }
  if (wildRule.kind === 'same') {
    return COLORS.flatMap(color => claimOptions(player, { color, count: wildRule.count }, null)).slice(0, 2);
  }
  const candidates = COLORS.map(c => free.filter(d => d.color === c));
  if (candidates.some((list, i) => list.length < wildRule.counts[COLORS[i]])) return [];
  const first = candidates.flatMap((list, i) => list.slice(0, wildRule.counts[COLORS[i]]).map(d => d.id));
  const extra = candidates.findIndex((list, i) => wildRule.counts[COLORS[i]] > 0 && list.length > wildRule.counts[COLORS[i]]);
  if (extra < 0) return [first];
  const second = candidates.flatMap((list, i) => list.slice(i === extra ? 1 : 0, wildRule.counts[COLORS[i]] + (i === extra ? 1 : 0)).map(d => d.id));
  return [first, second];
}

export function validClaim(dice, card, rule) {
  if (!dice.length || dice.some(d => d.card)) return false;
  if (card.color !== 'wild') return dice.length === card.count && dice.every(d => d.color === card.color);
  if (!validWildRule(rule)) return false;
  if (rule.kind === 'any') return dice.length === rule.count;
  if (rule.kind === 'same') return dice.length === rule.count && dice.every(d => d.color === dice[0].color);
  return dice.length === COLORS.reduce((n, c) => n + rule.counts[c], 0) && COLORS.every(c => dice.filter(d => d.color === c).length === rule.counts[c]);
}

function award(s, player, ids) {
  player.cards.push({ ...s.active });
  for (const die of player.dice) if (ids.includes(die.id)) die.card = s.active.id;
  event(s, `${player.name} получает карту ${cardLabel(s.active, s.wildRule)}. Кубики на ней приносят вдвое больше очков.`, 'card');
  s.active = s.deck.shift() || null;
}

function advance(s) {
  // Every new active card must be resolved, even outside its recipient's turn.
  while (s.active) {
    const eligible = clockwise(s).find(p => claimOptions(p, s.active, s.wildRule).length);
    if (!eligible) break;
    const options = claimOptions(eligible, s.active, s.wildRule);
    if (options.length === 1) { award(s, eligible, options[0]); continue; }
    s.pending = { playerId: eligible.id, cardId: s.active.id };
    s.phase = 'claim';
    return;
  }
  s.pending = null;
  while (s.turn < s.order.length) {
    const id = s.order[s.turn];
    if (canMakeSum(s.table, s.bids[id])) { s.phase = 'collect'; return; }
    event(s, `${s.players.find(p => p.id === id).name}: ставку ${s.bids[id]} уже не собрать — пропуск.`, 'skip');
    s.turn++;
  }
  s.phase = 'roundEnd';
  if (s.bank.length === 0) {
    s.phase = 'finished';
    event(s, 'Последний раунд завершён. Кубики на картах посчитаны вдвойне.', 'finish');
  } else event(s, 'Раунд завершён. Оставшиеся кубики будут переброшены вместе с новой порцией.');
}

function selectedDice(dice, ids) {
  assert(Array.isArray(ids) && ids.length && ids.length <= 36 && new Set(ids).size === ids.length, 'Выберите кубики.');
  const selected = ids.map(id => dice.find(d => d.id === id));
  assert(selected.every(Boolean), 'Эти кубики уже недоступны.');
  return selected;
}

export function reduceGame(state, actorId, action, rng = randomInt) {
  const s = structuredClone(state);
  assert(action && typeof action.type === 'string', 'Некорректное действие.');
  const actor = s.players.find(p => p.id === actorId);
  assert(actor, 'Игрок не в этой комнате.');
  switch (action.type) {
    case 'join': {
      assert(actorId === s.hostId, 'Только создатель управляет комнатой.');
      assert(s.phase === 'lobby', 'Игра уже началась.');
      assert(s.players.length < s.capacity, 'В комнате нет свободных мест.');
      const p = action.player;
      assert(p && typeof p.id === 'string' && p.id.length <= 80 && !s.players.some(x => x.id === p.id), 'Некорректный игрок.');
      assert(typeof p.name === 'string' && p.name.trim().length > 0 && p.name.trim().length <= 20, 'Введите имя до 20 символов.');
      assert(Number.isInteger(p.avatar) && p.avatar >= 1 && p.avatar <= AVATAR_COUNT, 'Выберите аватарку крокодила.');
      s.players.push({ id: p.id, name: p.name.trim(), avatar: p.avatar, online: true, ready: false, dice: [], cards: [] });
      break;
    }
    case 'remove': {
      assert(s.phase === 'lobby', 'Во время партии место сохраняется для переподключения.');
      assert(action.playerId !== s.hostId && (actorId === s.hostId || actorId === action.playerId), 'Нельзя удалить этого игрока.');
      s.players = s.players.filter(p => p.id !== action.playerId);
      s.first = Math.min(s.first, s.players.length - 1);
      break;
    }
    case 'presence':
      assert(actorId === s.hostId, 'Недостаточно прав.');
      { const p = s.players.find(p => p.id === action.playerId); if (p) p.online = !!action.online; }
      break;
    case 'ready':
      assert(s.phase === 'lobby', 'Игра уже началась.');
      actor.ready = !!action.value;
      break;
    case 'configure':
      assert(actorId === s.hostId && s.phase === 'lobby', 'Настройки доступны создателю до начала партии.');
      assert(Number.isInteger(action.first) && action.first >= 0 && action.first < s.players.length, 'Выберите первого игрока.');
      s.first = action.first;
      s.players.forEach(p => { p.ready = false; });
      break;
    case 'start':
      assert(actorId === s.hostId && s.phase === 'lobby', 'Начать игру может создатель комнаты.');
      assert(s.players.length === s.capacity && s.players.every(p => p.online && p.ready), 'Дождитесь всех игроков и их готовности.');
      s.bank = shuffle(COLORS.flatMap(color => Array.from({ length: 12 }, (_, i) => ({ id: `${color}-${i}`, color, value: 1, card: null }))), rng);
      s.deck = shuffle(CARD_DECK, rng); s.active = s.deck.shift();
      s.round = 1; s.phase = 'roll';
      event(s, 'Партия началась. Удача любит смелых!');
      break;
    case 'roll':
      assert(s.phase === 'roll' && actorId === s.players[s.first].id, 'Кубики бросает первый игрок этого раунда.');
      s.table.push(...s.bank.splice(0, batchSize(s)));
      s.table.forEach(d => { d.value = rng(6) + 1; });
      s.rollId++; s.bids = {}; s.submitted = []; s.order = []; s.turn = 0;
      s.phase = 'bidding';
      event(s, `Раунд ${s.round}: брошено ${s.table.length} кубиков. Сделайте тайные ставки.`, 'roll');
      break;
    case 'bid':
      assert(s.phase === 'bidding' && !s.submitted.includes(actorId), 'Ставка уже принята.');
      assert(Number.isSafeInteger(action.value) && action.value >= 0 && action.value <= 1000000, 'Введите целое неотрицательное число до 1 000 000.');
      s.bids[actorId] = action.value; s.submitted.push(actorId);
      if (s.submitted.length === s.players.length) {
        const priority = clockwise(s).map(p => p.id);
        s.order = [...priority].sort((a, b) => s.bids[a] - s.bids[b] || priority.indexOf(a) - priority.indexOf(b));
        event(s, `Ставки раскрыты: ${s.order.map(id => `${s.players.find(p => p.id === id).name} — ${s.bids[id]}`).join(', ')}.`, 'reveal');
        advance(s);
      }
      break;
    case 'take': {
      assert(s.phase === 'collect' && s.order[s.turn] === actorId, 'Сейчас ход другого игрока.');
      const dice = selectedDice(s.table, action.ids);
      assert(dice.reduce((sum, d) => sum + d.value, 0) === s.bids[actorId], 'Сумма выбранных кубиков должна точно совпасть со ставкой.');
      actor.dice.push(...dice); s.table = s.table.filter(d => !action.ids.includes(d.id));
      event(s, `${actor.name} забирает ${dice.length} куб. на ${s.bids[actorId]} очк.`, 'take');
      s.turn++; advance(s);
      break;
    }
    case 'claim': {
      assert(s.phase === 'claim' && s.pending?.playerId === actorId, 'Карту получает другой игрок.');
      const dice = selectedDice(actor.dice, action.ids);
      assert(validClaim(dice, s.active, s.wildRule), 'Выбранные кубики не подходят для этой карты.');
      award(s, actor, action.ids); advance(s);
      break;
    }
    case 'next':
      assert(s.phase === 'roundEnd' && actorId === s.players[s.first].id, 'Следующий раунд начинает игрок со стаканчиком.');
      s.first = (s.first + 1) % s.players.length; s.round++; s.phase = 'roll';
      s.bids = {}; s.submitted = []; s.order = []; s.turn = 0;
      break;
    case 'rematch':
      assert(s.phase === 'finished' && actorId === s.hostId, 'Новую партию создаёт хозяин комнаты.');
      s.phase = 'lobby'; s.round = 0; s.bank = []; s.table = []; s.deck = []; s.active = null;
      s.bids = {}; s.submitted = []; s.order = []; s.turn = 0; s.pending = null; s.log = []; s.rollId = 0;
      s.players.forEach(p => { p.ready = false; p.dice = []; p.cards = []; });
      break;
    default: fail('Неизвестное действие.');
  }
  s.version++;
  return s;
}

export function publicView(state, viewerId) {
  const s = structuredClone(state);
  // No future card order, bank composition or other players' unrevealed bids.
  s.nextCard = s.deck[0] || null; s.deckCount = s.deck.length;
  delete s.deck; delete s.bank;
  if (s.phase === 'bidding') s.bids = Object.hasOwn(s.bids, viewerId) ? { [viewerId]: s.bids[viewerId] } : {};
  return s;
}

export function cardLabel(card, rule) {
  if (!card) return 'Колода разобрана';
  if (card.color !== 'wild') return `${card.count} ${COLOR_NAMES[card.color]}`;
  if (!rule) return 'Четырёхцветная карта';
  if (rule.kind === 'same') return `${rule.count} одного цвета`;
  if (rule.kind === 'any') return `${rule.count} любых кубиков`;
  return COLORS.filter(c => rule.counts[c]).map(c => `${rule.counts[c]} ${COLOR_NAMES[c]}`).join(' + ');
}
