// Presentation messages never change bids, dice, turn order or other game rules.
export const STICKER_COUNT = 25;
export const REACTION_LIFETIME = 4800;

export function socialView(data, now = Date.now()) {
  const social = data.social || {}, s = data.state, pick = social.selection;
  const active = s.phase === 'collect' && pick?.playerId === s.order[s.turn]
    && pick.rollId === s.rollId && pick.turn === s.turn;
  return {
    revision: social.revision || 0,
    selection: active ? { playerId: pick.playerId, ids: pick.ids } : null,
    reactions: (social.reactions || []).filter(r => now - r.at < REACTION_LIFETIME),
    slammed: Object.keys(social.slams || {}).filter(id => social.slams[id] === s.round),
  };
}

export function applySignal(data, id, signal, now = Date.now()) {
  const fail = message => { throw new Error(message); };
  const s = data.state;
  if (!s.players.some(p => p.id === id)) fail('Игрок не в этой комнате.');
  const social = data.social ||= { revision: 0, reactions: [], slams: {} };
  if (signal?.type === 'selection') {
    if (s.phase !== 'collect' || s.order[s.turn] !== id || signal.rollId !== s.rollId || signal.turn !== s.turn) fail('Выбирать кубики можно только в свой ход.');
    if (!Array.isArray(signal.ids) || signal.ids.length > 36 || new Set(signal.ids).size !== signal.ids.length || signal.ids.some(key => !s.table.some(d => d.id === key))) fail('Эти кубики уже недоступны.');
    social.selection = { playerId: id, ids: [...signal.ids], rollId: s.rollId, turn: s.turn, at: now };
  } else if (signal?.type === 'reaction') {
    if (!Number.isInteger(signal.sticker) || signal.sticker < 1 || signal.sticker > STICKER_COUNT) fail('Выберите стикер.');
    if ((social.reactions || []).some(r => r.playerId === id && now - r.at < 1000)) fail('Подождите секунду перед следующей эмоцией.');
    social.reactions = [...(social.reactions || []).filter(r => now - r.at < REACTION_LIFETIME), { id: crypto.randomUUID(), playerId: id, sticker: signal.sticker, kind: 'sticker', at: now }].slice(-20);
  } else if (signal?.type === 'slam') {
    if (!s.log.some(ev => ev.type === 'skip' && ev.round === s.round && ev.playerId === id) || social.slams?.[id] === s.round) fail('Ударить по столу можно, когда сгорела ваша ставка.');
    social.slams ||= {}; social.slams[id] = s.round;
    social.reactions = [...(social.reactions || []).filter(r => now - r.at < REACTION_LIFETIME), { id: crypto.randomUUID(), playerId: id, kind: 'slam', at: now }].slice(-20);
  } else fail('Неизвестная эмоция.');
  social.revision++;
}
