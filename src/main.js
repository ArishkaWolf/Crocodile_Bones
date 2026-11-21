import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/cyrillic-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/cyrillic-600.css';
import '@fontsource/manrope/latin-800.css';
import '@fontsource/manrope/cyrillic-800.css';
import '@fontsource/unbounded/latin-600.css';
import '@fontsource/unbounded/cyrillic-600.css';
import './style.css';
import { TableScene } from './scene.js';
import { RoomConnection, normalizeCode } from './connection.js';
import { score, cardLabel, validClaim, totalRounds, COLORS } from './engine.js';

const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const sceneEl = document.querySelector('#scene');
const asset = path => `${import.meta.env.BASE_URL}assets/${path}`;
const avatar = n => asset(`avatars/${n}.webp`);
const cardImage = id => asset(`cards/${id}.webp`);
const e = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const iconPaths = {
  arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-1 1-2 1-2 3m0 3h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  exit: '<path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4m6-14 5 5-5 5m-7-5h12"/>',
  cards: '<rect x="7" y="3" width="13" height="18" rx="3"/><path d="m7 6-3 1a2 2 0 0 0-1 3l4 10m5-12h3m-3 4h3"/>',
  cup: '<path d="m6 3 2 14h8l2-14zM9 21h6m-3-4v4M6 5H3v3a5 5 0 0 0 5 5m10-8h3v3a5 5 0 0 1-5 5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3 1 2h4l1-2 3 2-1 2 2 3 2 1v3l-2 1-2 3 1 2-3 2-1-2h-4l-1 2-3-2 1-2-2-3-2-1v-3l2-1 2-3-1-2z"/>',
  mute: '<path d="m11 4-6 5H2v6h3l6 5zM16 9l6 6m0-6-6 6"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || ''}</svg>`;
let profile;
try { profile = JSON.parse(localStorage.getItem('crocodile-profile') || 'null'); } catch { /* no storage */ }
profile ||= { name: '', avatar: 1 };
let mode = new URL(location.href).searchParams.has('room') ? 'join' : 'create';
let capacity = 3, codeInput = normalizeCode(new URL(location.href).searchParams.get('room') || '');
let connection = null, state = null, myId = null, status = 'offline', busy = false;
let selected = new Set(), claimSelected = new Set(), rollKey = null, rolling = false;
let modal = null, inspectId = null, sound = true, lastPhase = null, toastTimer, audio;
let sounds = { roll: true, turns: true, volume: 0.5 };
try { sounds = { ...sounds, ...JSON.parse(localStorage.getItem('crocodile-sound') || '{}') }; } catch {}
sound = sounds.roll || sounds.turns;
const scene = new TableScene(sceneEl, pickDie, () => { if (rolling) { rolling = false; if (state) render(); } });

function toast(message) {
  const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 4500);
}
function beep(kind = 'click') {
  if (!sound || (kind === 'roll' ? !sounds.roll : !sounds.turns)) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    if (kind === 'roll') {
      for (let i = 0; i < 14; i++) {
        const start = audio.currentTime + i * 0.055;
        const buffer = audio.createBuffer(1, audio.sampleRate * 0.05, audio.sampleRate);
        const values = buffer.getChannelData(0);
        for (let j = 0; j < values.length; j++) values[j] = (Math.random() * 2 - 1) * Math.exp(-j / (audio.sampleRate * 0.009));
        const source = audio.createBufferSource(); source.buffer = buffer;
        const filter = audio.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 800 + i % 4 * 350; filter.Q.value = 1;
        const gain = audio.createGain(); gain.gain.value = sounds.volume * 0.5;
        source.connect(filter); filter.connect(gain); gain.connect(audio.destination); source.start(start);
      }
      return;
    }
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(kind === 'reveal' ? 660 : kind === 'turn' ? 880 : 440, audio.currentTime);
    osc.frequency.exponentialRampToValueAtTime(kind === 'turn' ? 660 : 300, audio.currentTime + 0.13);
    gain.gain.setValueAtTime(0.09 * sounds.volume, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.16);
    osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(audio.currentTime + 0.17);
  } catch { /* audio optional */ }
}
function saveSounds() {
  sound = sounds.roll || sounds.turns;
  try { localStorage.setItem('crocodile-sound', JSON.stringify(sounds)); } catch {}
}
function updateProfile() {
  const nameInput = document.querySelector('#player-name');
  if (nameInput) profile.name = nameInput.value;
  const code = document.querySelector('#room-code-input'); if (code) codeInput = normalizeCode(code.value);
}
function saveProfile() { try { localStorage.setItem('crocodile-profile', JSON.stringify(profile)); } catch { /* optional */ } }
function inviteURL() { const url = new URL(location.href); url.search = ''; url.searchParams.set('room', state.code); url.hash = ''; return url.href; }
async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { showModal('copy', text); }
}
async function send(action) {
  try { await connection.action(action); beep(); return true; } catch (error) { toast(error.message); return false; }
}
function newConnection() {
  return new RoomConnection({
    onState: (next, id) => {
      const prev = state; state = next; myId = id;
      if (prev?.phase !== next.phase || prev?.order[prev.turn] !== next.order[next.turn]) selected.clear();
      if (prev?.pending?.cardId !== next.pending?.cardId || prev?.pending?.playerId !== next.pending?.playerId) claimSelected.clear();
      if (next.phase !== 'lobby') {
        const nextKey = String(next.rollId);
        if (next.rollId && next.phase !== 'roll' && nextKey !== rollKey) { rollKey = nextKey; rolling = true; beep('roll'); }
      }
      if (prev?.phase === 'bidding' && next.phase !== 'bidding') beep('reveal');
      if (next.phase === 'collect' && next.order[next.turn] === id && (prev?.phase !== 'collect' || prev?.order[prev.turn] !== id)) beep('turn');
      busy = false;
      document.title = next.phase === 'lobby' ? `Комната ${next.code} — Кости Крокодила` : `Раунд ${next.round} — Кости Крокодила`;
      render();
      if (modal === 'inventory') renderModal();
    },
    onStatus: value => { const previous = status; status = value; const el = document.querySelector('#connection-status'); if (el) el.outerHTML = statusHTML(); if (state && previous !== value) render(); },
    onError: message => { busy = false; toast(message); render(); },
    onClosed: message => { reset(); toast(message); },
  });
}
async function enterRoom() {
  updateProfile(); profile.name = profile.name.trim();
  if (!profile.name) { document.querySelector('#player-name')?.focus(); toast('Введите имя, за кого вы играете.'); return; }
  if (mode === 'join' && !/^[A-Z0-9]{6}$/.test(codeInput)) { document.querySelector('#room-code-input')?.focus(); toast('Введите шестизначный код комнаты.'); return; }
  busy = true; saveProfile(); connection = newConnection(); render();
  try {
    if (mode === 'create') await connection.create(profile, capacity);
    else await connection.join(profile, codeInput);
  } catch (error) { connection?.close(false); connection = null; busy = false; status = 'offline'; render(); toast(error.message); }
}
function reset() {
  connection?.close(); connection = null; state = null; myId = null; status = 'offline'; busy = false;
  selected.clear(); claimSelected.clear(); rollKey = null; rolling = false; modal = null; modalRoot.innerHTML = '';
  scene.setHero(); document.title = 'Кости Крокодила — игра с характером'; render();
}
function statusHTML() {
  const text = { connecting: 'Подключаемся', reconnecting: 'Восстанавливаем связь', online: 'На связи', offline: 'Игра в браузере' }[status];
  return `<span id="connection-status" class="connection-status ${status}"><i></i>${text}</span>`;
}
function brand() { return `<a class="brand" href="./" aria-label="Кости Крокодила, главная" data-action="home"><img src="${avatar(1)}" alt=""/><span>КОСТИ<br>КРОКОДИЛА</span></a>`; }
function header(game = false) {
  return `<header class="header">${brand()}<div class="header-middle">${state ? `<button class="room-code" data-action="copy-code" title="Скопировать код комнаты"><span>КОМНАТА</span> ${state.code} ${icon('copy')}</button>` : ''}</div><div class="header-actions"><button class="icon-button" data-action="settings" aria-label="Настройки звука">${icon('settings')}</button>${game ? `<button class="icon-button sound-button" data-action="sound" aria-label="${sound ? 'Выключить' : 'Включить'} звук">${icon(sound ? 'volume' : 'mute')}</button><button class="icon-button" data-action="fullscreen" aria-label="Полный экран">${icon('expand')}</button>` : ''}<button class="text-button" data-action="rules">${icon('help')}<span>Как играть</span></button>${state ? `<button class="icon-button" data-action="leave" aria-label="Выйти из комнаты">${icon('exit')}</button>` : ''}</div></header>`;
}
function renderLanding() {
  const names = ['Солнечный', 'Мечтатель', 'Смельчак', 'Хитрец', 'Крокодил 5', 'Крокодил 6'];
  return `${header()}<main class="landing"><section class="intro"><h1>Кости<br><span>Крокодила</span><span class="title-dot">.</span></h1><p class="intro-description">Немного расчёта. Немного жадности.<br>И один очень удачный бросок.</p><div class="game-facts"><span>${icon('users')}3–4 игрока</span><span>${icon('clock')}15 минут</span><span class="age">8+</span></div><div class="entry-panel"><div class="tabs" role="tablist" aria-label="Способ входа"><button role="tab" aria-selected="${mode === 'create'}" data-mode="create" class="${mode === 'create' ? 'active' : ''}">Создать комнату</button><button role="tab" aria-selected="${mode === 'join'}" data-mode="join" class="${mode === 'join' ? 'active' : ''}">Войти по коду</button></div><form id="entry-form"><label class="field-label" for="player-name">Как вас зовут?</label><input id="player-name" name="name" value="${e(profile.name)}" placeholder="Имя за игровым столом" maxlength="20" autocomplete="nickname" required ${busy ? 'disabled' : ''}/><div class="field-label avatar-label">Выберите своего крокодила</div><div class="avatar-picker" role="group" aria-label="Выбор персонажа">${[1, 2, 3, 4, 5, 6].map(n => `<button type="button" class="avatar-option ${profile.avatar === n ? 'selected' : ''}" data-avatar="${n}" aria-label="${names[n - 1]}" aria-pressed="${profile.avatar === n}" ${busy ? 'disabled' : ''}><img src="${avatar(n)}" alt="${names[n - 1]}"/>${profile.avatar === n ? `<span>${icon('check')}</span>` : ''}</button>`).join('')}</div>${mode === 'create' ? `<div class="field-label">Сколько вас будет?</div><div class="capacity-picker">${[3, 4].map(n => `<button type="button" data-capacity="${n}" class="capacity-option ${capacity === n ? 'selected' : ''}" aria-pressed="${capacity === n}" ${busy ? 'disabled' : ''}><b>${n}</b><span>игрока<small>${n === 3 ? '6 кубиков · 6 раундов' : '9 кубиков · 4 раунда'}</small></span><i></i></button>`).join('')}</div>` : `<label class="field-label" for="room-code-input">Код комнаты</label><input id="room-code-input" class="code-input" name="code" value="${e(codeInput)}" placeholder="ABC123" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" required ${busy ? 'disabled' : ''}/>`}<button type="submit" class="button primary entry-submit" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span> Подключаемся…' : `${mode === 'create' ? 'Создать комнату' : 'Присоединиться'} ${icon('arrow')}`}</button></form></div></section><section class="hero-art" aria-label="Кубики и карты Костей Крокодила"><div class="hero-orbit orbit-one"></div><div class="hero-orbit orbit-two"></div><div class="hero-badge">АЗАРТ В ХОРОШЕЙ КОМПАНИИ ${icon('dice')}</div><div class="hero-cards"><img src="${cardImage('3blue')}" class="hero-card card-one" alt="Карта 3 голубых"/><img src="${cardImage('4green')}" class="hero-card card-two" alt="Карта 4 зелёных"/><img src="${cardImage('change')}" class="hero-card card-three" alt="Четырёхцветная карта"/></div><div class="hero-caption"><span class="sparkle">✦</span><div><b>Не жадничайте.<br>Хотя… решать вам.</b><p>Меньше ставка — раньше ход.</p></div></div><span class="art-coord">36 КУБИКОВ / 10 КАРТ / ВАША УДАЧА</span></section></main><footer class="landing-footer"><span>Автор: Вячеслав Крокодил</span><button data-action="rules">Познакомиться с правилами ${icon('arrow')}</button></footer>`;
}
function renderLobby() {
  const host = myId === state.hostId, me = state.players.find(p => p.id === myId);
  const allReady = state.players.length === state.capacity && state.players.every(p => p.ready && p.online);
  return `${header()}<main class="lobby"><div class="eyebrow">ПЕРЕД ПЕРВЫМ БРОСКОМ</div><div class="lobby-heading"><div><h1>Все свои <span>за столом.</span></h1><p>Пригласите друзей и приготовьтесь немного рискнуть.</p></div><span class="player-counter">${icon('users')} ${state.players.length}<span>/ ${state.capacity}</span></span></div><section class="lobby-seats" style="--seats:${state.capacity}">${Array.from({ length: state.capacity }, (_, i) => {
    const p = state.players[i];
    return p ? `<article class="lobby-player ${p.id === myId ? 'is-you' : ''}"><div class="seat-top"><span>МЕСТО ${String(i + 1).padStart(2, '0')}</span>${p.id === state.hostId ? `<span class="host-tag">${icon('cup')} Создатель</span>` : host ? `<button class="kick" data-kick="${p.id}" aria-label="Освободить место ${e(p.name)}">${icon('close')}</button>` : ''}</div><img class="lobby-avatar" src="${avatar(p.avatar)}" alt="Персонаж ${e(p.name)}"/><h2>${e(p.name)} ${p.id === myId ? '<small>вы</small>' : ''}</h2><span class="ready-state ${p.ready && p.online ? 'ready' : ''}">${p.online ? p.ready ? `${icon('check')} Готов к игре` : 'Выбирает момент…' : 'Ждём подключения'}</span>${i === state.first ? `<span class="first-player-tag">${icon('cup')} Первый бросок</span>` : ''}</article>` : `<article class="lobby-player empty"><div class="seat-top"><span>МЕСТО ${String(i + 1).padStart(2, '0')}</span></div><div class="empty-avatar">${icon('users')}</div><h2>Ждём друга</h2><p>Хорошая компания<br>уже почти собралась</p><button class="text-button" data-action="copy-link">Пригласить ${icon('arrow')}</button></article>`;
  }).join('')}</section><div class="lobby-bottom"><section class="invite-panel"><div class="mini-heading">ССЫЛКА НА ВАШ СТОЛ</div><div class="invite-url"><span>${e(inviteURL())}</span><button class="icon-button" data-action="copy-link" aria-label="Скопировать приглашение">${icon('copy')}</button></div><p>Можно отправить ссылку или код <b>${state.code}</b>. Место игрока сохраняется при обновлении страницы.</p></section><section class="lobby-settings"><div class="mini-heading">${state.capacity === 3 ? '6 КУБИКОВ · 6 РАУНДОВ' : '9 КУБИКОВ · 4 РАУНДА'}</div>${host ? `<label class="first-select">Первым бросает <select id="first-player-select" aria-label="Первый игрок">${state.players.map((p, i) => `<option value="${i}" ${i === state.first ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select></label>` : `<p>Первым бросает <b>${e(state.players[state.first].name)}</b>.</p>`}<p>Выберите того, у кого самые прочные кости.</p></section></div><div class="lobby-controls"><div>${statusHTML()}<span class="lobby-hint">${allReady ? 'Все на месте. Можно начинать!' : `Готовы ${state.players.filter(p => p.ready).length} из ${state.capacity} игроков`}</span></div><div class="lobby-buttons"><button class="button ${me.ready ? 'secondary' : 'primary'}" data-action="ready">${icon(me.ready ? 'check' : 'dice')}${me.ready ? 'Я готов · отменить' : 'Я готов'}</button>${host ? `<button class="button ${allReady ? 'primary' : 'secondary'}" data-action="start" ${!allReady ? 'disabled' : ''}>Начать игру ${icon('arrow')}</button>` : ''}</div></div></main>`;
}
const phaseNames = { roll: 'Новый бросок', bidding: 'Тайные ставки', collect: 'Сбор кубиков', claim: 'Карта ваша!', roundEnd: 'Раунд завершён', finished: 'Итоги партии' };
function currentPlayer() { return state.players.find(p => p.id === (state.phase === 'claim' ? state.pending?.playerId : state.order[state.turn])); }
function playerSeat(p, i) {
  const current = currentPlayer()?.id === p.id && ['collect', 'claim'].includes(state.phase);
  const submitted = state.submitted.includes(p.id);
  const reveal = state.phase !== 'bidding' && Object.hasOwn(state.bids, p.id);
  return `<button class="player-seat ${p.id === myId ? 'is-you' : ''} ${current ? 'is-current' : ''}" data-inspect="${p.id}" aria-label="${e(p.name)}, ${score(p)} очков, посмотреть коллекцию"><div class="player-bid ${reveal ? 'revealed' : ''}">${reveal ? `<span>СТАВКА</span><b>${state.bids[p.id]}</b>` : submitted ? `${icon('lock')} Готово` : state.phase === 'bidding' ? '<span class="thinking">···</span>' : i === state.first ? `${icon('cup')} Первый игрок` : `МЕСТО ${i + 1}`}</div><div class="seat-info"><div class="avatar-wrap"><img src="${avatar(p.avatar)}" alt=""/>${!p.online ? '<span class="offline-dot" title="Нет связи"></span>' : ''}</div><div class="seat-text"><b>${e(p.name)}${p.id === myId ? ' <small>вы</small>' : ''}</b><span>${icon('dice')}${p.dice.length} <i>·</i> ${icon('cards')}${p.cards.length}</span></div><strong class="seat-score">${score(p)}<small>очк.</small></strong></div>${current ? '<div class="turn-line"></div>' : ''}</button>`;
}
function renderActionPanel() {
  const me = state.players.find(p => p.id === myId), first = state.players[state.first], turn = currentPlayer();
  if (status !== 'online') return `<div class="action-title"><span class="spinner"></span><div><h3>Восстанавливаем соединение</h3><p>Ваше место и собранные кубики сохранены. Ждём связь с комнатой.</p></div></div>`;
  if (state.phase === 'roll') return `<div class="action-title">${icon('dice')}<div><h3>${first.id === myId ? 'Ваш первый бросок' : `Бросает ${e(first.name)}`}</h3><p>Новые кубики из банка и остаток прошлого раунда.</p></div></div><button class="button primary" data-action="roll" ${first.id !== myId ? 'disabled' : ''}>${icon('dice')} Бросить кубики</button>`;
  if (rolling) return `<div class="action-title"><span class="spinner"></span><div><h3>Удача в движении…</h3><p>Сейчас узнаем, что приготовили кубики.</p></div></div>`;
  if (state.phase === 'bidding') {
    const done = state.submitted.includes(myId);
    return `<div class="action-title">${icon(done ? 'lock' : 'dice')}<div><h3>${done ? 'Ваша ставка принята' : 'Сколько очков заберёте?'}</h3><p>${done ? `Вы выбрали <b>${state.bids[myId]}</b>. Ждём остальных: ${state.submitted.length} / ${state.capacity}.` : 'Введите число. Остальные увидят его, когда ответят все.'}</p></div></div>${done ? `<span class="sealed-bid">${icon('lock')} ${state.bids[myId]}</span>` : `<form id="bid-form" class="bid-form"><label class="sr-only" for="bid-input">Ваша тайная ставка</label><input id="bid-input" inputmode="numeric" type="number" min="0" max="1000000" step="1" placeholder="0" required autocomplete="off"/><button class="button primary" type="submit">Сделать ставку ${icon('lock')}</button></form>`}`;
  }
  if (state.phase === 'claim') {
    if (turn?.id === myId) return `<div class="action-title">${icon('cards')}<div><h3>Выберите кубики для карты</h3><p>Нужно ${e(cardLabel(state.active, state.wildRule))}. Выбранные значения удвоятся.</p></div></div><button class="button primary" data-action="choose-claim">Выбрать кубики ${icon('arrow')}</button>`;
    return `<div class="action-title">${icon('cards')}<div><h3>${e(turn?.name)} получает карту</h3><p>Игрок выбирает кубики. После этого сбор продолжится.</p></div></div>`;
  }
  if (state.phase === 'collect') {
    if (turn?.id !== myId) return `<div class="action-title">${icon('clock')}<div><h3>Ходит ${e(turn?.name)}</h3><p>Выбирает кубики на ${state.bids[turn?.id]} очк. Посмотрите, что достанется вам.</p></div></div><span class="waiting-chip">${turn?.online ? 'Ждём ход' : 'Ждём подключения'}</span>`;
    const sum = state.table.filter(d => selected.has(d.id)).reduce((n, d) => n + d.value, 0), target = state.bids[myId];
    return `<div class="action-title">${icon('dice')}<div><h3>Ваш ход. Заберите ровно ${target}.</h3><p>Нажимайте на кубики на столе, чтобы выбрать их.</p></div></div><div class="take-controls"><span class="selected-sum ${sum === target ? 'exact' : sum > target ? 'over' : ''}"><b>${sum}</b><span>/ ${target}</span></span><button class="button primary" data-action="take" ${sum !== target || !selected.size ? 'disabled' : ''}>Забрать ${icon('arrow')}</button></div>`;
  }
  if (state.phase === 'roundEnd') return `<div class="action-title">${icon('check')}<div><h3>Этот раунд завершён</h3><p>${state.table.length ? `${state.table.length} куб. остаются на следующий бросок.` : 'Все кубики разобраны.'} Стаканчик переходит дальше.</p></div></div><button class="button primary" data-action="next" ${first.id !== myId ? 'disabled' : ''}>Следующий раунд ${icon('arrow')}</button>`;
  return '';
}
function dieButton(d, chosen = false, attrs = '') {
  return `<button class="die-token ${d.color} ${chosen ? 'chosen' : ''} ${d.card ? 'locked' : ''}" ${attrs} aria-pressed="${chosen}" aria-label="${d.value}, ${({ blue: 'голубой', green: 'зелёный', yellow: 'жёлтый' })[d.color]} кубик${d.card ? ', закреплён на карте' : ''}"><span>${d.value}</span>${d.card ? icon('lock') : ''}</button>`;
}
function renderGame() {
  const first = state.players[state.first];
  const stage = state.phase === 'roll' ? 0 : state.phase === 'bidding' ? 1 : 2;
  return `${header(true)}<main class="game"><div class="game-topline"><div class="round-label"><span>РАУНД</span><b>${state.round}<small> / ${totalRounds(state)}</small></b></div><div class="phase-track">${['Бросок', 'Ставки', 'Сбор'].map((label, i) => `<span class="${i === stage ? 'active' : i < stage ? 'complete' : ''}"><i>${i < stage ? icon('check') : i + 1}</i>${label}</span>`).join('')}</div>${statusHTML()}</div><section class="players-row" style="--seats:${state.capacity}">${state.players.map(playerSeat).join('')}</section><section class="table-area"><div class="table-heading"><div class="eyebrow">${rolling ? 'КУБИКИ РЕШАЮТ' : phaseNames[state.phase]}</div><p>${state.phase === 'bidding' && !rolling ? 'Тише. Каждый считает по-своему.' : state.phase === 'roll' ? `${e(first.name)}, удача ждёт вашего броска.` : state.phase === 'claim' ? 'Хорошая коллекция заслуживает удвоения.' : state.phase === 'collect' ? 'Точный расчёт — щедрая награда.' : 'Не всё достаётся самым жадным.'}</p></div><div class="table-wordmark" aria-hidden="true">КОСТИ<br>КРОКОДИЛА</div><aside class="card-dock"><div class="active-card-label"><span class="status-dot"></span> АКТИВНАЯ КАРТА</div>${state.active ? `<button class="active-card-image" data-action="view-card" aria-label="Активная карта: ${e(cardLabel(state.active, state.wildRule))}"><img src="${cardImage(state.active.id)}" alt="${e(cardLabel(state.active, state.wildRule))}"/></button><b class="card-requirement">${e(cardLabel(state.active, state.wildRule))}</b><span class="card-multiplier">Значения кубиков ×2</span>` : '<div class="empty-deck">Все карты<br>разобраны</div>'}<div class="next-card">${state.nextCard ? `<img src="${cardImage(state.nextCard.id)}" alt="Следующая: ${e(cardLabel(state.nextCard, state.wildRule))}"/><div><span>ДАЛЬШЕ</span><b>${e(cardLabel(state.nextCard, state.wildRule))}</b></div>` : '<span>Это последняя карта</span>'}</div></aside>${(!scene.available || (state.phase === 'collect' && currentPlayer()?.id === myId)) && !rolling ? `<div class="dice-accessible-row ${scene.available ? 'compact' : 'fallback'}" role="group" aria-label="Кубики на столе">${state.table.map(d => dieButton(d, selected.has(d.id), `data-die="${d.id}" ${state.phase !== 'collect' || currentPlayer()?.id !== myId ? 'disabled' : ''}`)).join('')}</div>` : ''}</section><section class="action-panel" aria-live="polite">${renderActionPanel()}</section><footer class="game-footer"><button data-inspect="${myId}">${icon('cards')}Моя коллекция <span>${score(state.players.find(p => p.id === myId))} очк.</span></button><span class="last-event">${e(state.log.at(-1)?.text || '')}</span><button data-action="log">${icon('clock')}Ход партии</button></footer></main>`;
}
function renderFinished() {
  const sorted = [...state.players].sort((a, b) => score(b) - score(a));
  const winning = score(sorted[0]), winners = sorted.filter(p => score(p) === winning);
  return `${header()}<main class="results"><div class="result-sparkle">✦</div><div class="eyebrow">ВСЕ КУБИКИ РАЗОБРАНЫ. ИЛИ ПОЧТИ.</div><h1>${winners.length > 1 ? 'Разделили удачу!' : `${e(sorted[0].name)} побеждает!`}</h1><p>Хороший расчёт, немного смелости и ваши ${totalRounds(state)} раундов.</p><section class="results-grid">${sorted.map((p, i) => `<button data-inspect="${p.id}" class="result-card ${score(p) === winning ? 'winner' : ''}"><span class="result-place">${score(p) === winning ? icon('cup') : String(sorted.findIndex(x => score(x) === score(p)) + 1).padStart(2, '0')}</span><img src="${avatar(p.avatar)}" alt=""/><h2>${e(p.name)}${p.id === myId ? ' <small>вы</small>' : ''}</h2><strong>${score(p)}<span>очков</span></strong><p>${p.dice.filter(d => !d.card).reduce((n, d) => n + d.value, 0)} за кубики + ${p.dice.filter(d => d.card).reduce((n, d) => n + d.value * 2, 0)} на картах</p><div>${icon('dice')} ${p.dice.length} куб. ${icon('cards')} ${p.cards.length} карт.</div></button>`).join('')}</section><div class="result-controls">${myId === state.hostId ? '<button class="button primary" data-action="rematch">Ещё одну партию? '+icon('arrow')+'</button>' : '<span class="waiting-chip">Создатель может начать новую партию</span>'}<button class="button secondary" data-action="log">Посмотреть ход партии</button></div></main>`;
}
function render() {
  // Preserve typed bids when a different player's ready/presence update arrives.
  const previousInput = document.querySelector('#bid-input'), bid = previousInput?.value;
  const focused = document.activeElement?.id, selectionStart = document.activeElement?.selectionStart;
  const landing = !state, lobby = state?.phase === 'lobby', finished = state?.phase === 'finished';
  document.body.className = landing ? 'view-landing' : lobby ? 'view-lobby' : finished ? 'view-results' : 'view-game';
  app.innerHTML = landing ? renderLanding() : lobby ? renderLobby() : finished ? renderFinished() : renderGame();
  if (bid != null && document.querySelector('#bid-input')) document.querySelector('#bid-input').value = bid;
  if (focused && document.getElementById(focused)) { const el = document.getElementById(focused); el.focus({ preventScroll: true }); if (typeof selectionStart === 'number' && el.type === 'text') el.setSelectionRange(selectionStart, selectionStart); }
  if (!landing) {
    scene.setGame();
    if (lobby || finished) sceneEl.style.visibility = 'hidden';
    else { sceneEl.style.visibility = 'visible'; scene.setDice(state.table, state.rollId ? String(state.rollId) : 'empty', state.phase === 'collect' && currentPlayer()?.id === myId && !rolling, selected); }
  } else sceneEl.style.visibility = 'visible';
  requestAnimationFrame(() => scene.resize());
  if (state?.phase === 'claim' && state.pending?.playerId === myId && lastPhase !== `${state.round}:claim:${state.pending.cardId}`) {
    lastPhase = `${state.round}:claim:${state.pending.cardId}`; showModal('claim');
  }
  if (modal === 'claim' && state?.phase !== 'claim') closeModal();
}
function pickDie(id) {
  if (!state || state.phase !== 'collect' || currentPlayer()?.id !== myId || rolling) return;
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  beep(); render();
}
function closeModal() { modal = null; modalRoot.innerHTML = ''; document.body.classList.remove('modal-open'); }
function showModal(type, data) { modal = type; if (type === 'inventory') inspectId = data; if (type === 'copy') inspectId = data; renderModal(); }
function renderModal() {
  if (!modal) return;
  let content = '', wide = false;
  if (modal === 'rules') {
    content = `<h2>Как играть</h2><div class="rules-content"><p>Побеждает тот, кто наберёт больше очков на собранных кубиках. Обычный кубик приносит своё значение, кубик на карте — <b>вдвое больше</b>.</p><ol><li><b>Бросьте кубики.</b> Первый игрок добавляет из банка 6 случайных кубиков для троих или 9 для четверых. Остаток прошлого раунда бросается вместе с ними.</li><li><b>Сделайте тайную ставку.</b> Каждый вводит число очков, которые хочет забрать. Ставки откроются, когда ответят все.</li><li><b>Забирайте по очереди.</b> Меньше ставка — раньше ход. При равенстве приоритет идёт по часовой стрелке от первого игрока.</li><li><b>Соберите точную сумму.</b> Выберите один или несколько кубиков, сумма которых строго равна ставке. Если нужную сумму уже не собрать, ход автоматически пропускается.</li><li><b>Получайте карты.</b> Если свободных кубиков хватает для активной карты, её обязательно нужно забрать. Вы выбираете, какие подходящие кубики закрепить. Они больше не перемещаются.</li></ol><div class="rule-callout">Четырёхцветная карта: <b>по 2 кубика каждого цвета</b>, всего 6. Их значения тоже удваиваются.</div><p>Следующая карта становится активной сразу. Если она подходит кому-то ещё, игрок получает её вне своего хода. При нескольких претендентах приоритет — от первого игрока по часовой стрелке. Цепочка продолжается, пока есть подходящие карты.</p><p>Неразобранные кубики переходят в следующий раунд, первый игрок меняется по часовой стрелке. Последняя порция из банка означает последний раунд: <b>6 раундов для троих, 4 для четверых</b>. Равные итоговые очки означают общую победу.</p><p class="rules-sources">По <a href="https://docs.google.com/document/d/1a3O1wNkeYDUVxFunPz8pDYVMTn34xOmogsrRMy_Nu40/edit" target="_blank" rel="noopener noreferrer">правилам автора</a> и <a href="https://docs.google.com/document/d/1ZOs0DHDGN_tFIcAwbbAu3JZKFGjJg8XwoSiFCXfUQAs/edit" target="_blank" rel="noopener noreferrer">руководству по комплектации</a>.</p></div>`;
  }
  if (modal === 'inventory') {
    const p = state.players.find(p => p.id === inspectId); if (!p) { closeModal(); return; }
    wide = true;
    content = `<div class="inventory-heading"><img src="${avatar(p.avatar)}" alt=""/><div><div class="eyebrow">КОЛЛЕКЦИЯ ИГРОКА</div><h2>${e(p.name)}</h2></div><strong>${score(p)}<small>очков</small></strong></div><h3>Свободные кубики <span>×1</span></h3><div class="inventory-dice">${p.dice.filter(d => !d.card).map(d => dieButton(d, false, 'disabled')).join('') || '<p class="empty-copy">Пока пусто. Всё впереди.</p>'}</div><h3>Карты и закреплённые кубики <span>×2</span></h3><div class="inventory-cards">${p.cards.map(c => `<div class="owned-card"><img src="${cardImage(c.id)}" alt="${e(cardLabel(c, state.wildRule))}"/><div><b>${e(cardLabel(c, state.wildRule))}</b><div class="inventory-dice">${p.dice.filter(d => d.card === c.id).map(d => dieButton(d, false, 'disabled')).join('')}</div><span>${p.dice.filter(d => d.card === c.id).reduce((n, d) => n + d.value * 2, 0)} очков</span></div></div>`).join('') || '<p class="empty-copy">Собирайте цвета, чтобы получать карты.</p>'}</div>`;
  }
  if (modal === 'settings') {
    content = `<h2>Звук за столом</h2><p>Настройки сохраняются на этом устройстве.</p><label class="settings-row"><span>Звук кубиков<small>Перекатывание и стук во время броска</small></span><input type="checkbox" id="setting-roll" ${sounds.roll ? 'checked' : ''}/></label><label class="settings-row"><span>Звуки игры<small>Выбор кубиков, раскрытие ставок и ваш ход</small></span><input type="checkbox" id="setting-turns" ${sounds.turns ? 'checked' : ''}/></label><label class="settings-row"><span>Громкость</span><input id="setting-volume" type="range" min="0" max="1" step="0.05" value="${sounds.volume}" aria-label="Громкость звуков"/></label><button class="button secondary settings-test" data-action="test-sound">Послушать кубики ${icon('volume')}</button>`;
  }
  if (modal === 'claim') {
    if (state.phase !== 'claim' || state.pending?.playerId !== myId) { closeModal(); return; }
    const me = state.players.find(p => p.id === myId);
    const free = me.dice.filter(d => !d.card);
    const chosen = free.filter(d => claimSelected.has(d.id));
    const valid = validClaim(chosen, state.active, state.wildRule);
    content = `<div class="claim-heading"><img src="${cardImage(state.active.id)}" alt="${e(cardLabel(state.active, state.wildRule))}"/><div><div class="eyebrow">ОБЯЗАТЕЛЬНАЯ КАРТА</div><h2>Эти кубики — вдвойне ценнее</h2><p>Выберите ${e(cardLabel(state.active, state.wildRule))} из своих свободных кубиков.</p></div></div><div class="inventory-dice claim-dice">${free.map(d => dieButton(d, claimSelected.has(d.id), `data-claim-die="${d.id}" ${state.active.color !== 'wild' && d.color !== state.active.color ? 'disabled' : ''}`)).join('')}</div><div class="claim-summary"><span>Выбрано: ${chosen.length} · <b>${chosen.reduce((n, d) => n + d.value * 2, 0)} очк.</b> на карте</span><button class="button primary" data-action="claim" ${!valid ? 'disabled' : ''}>Получить карту ${icon('check')}</button></div><p class="small-note">Выбирайте внимательно: закреплённые кубики нельзя заменить или использовать для другой карты.</p>`;
  }
  if (modal === 'log') {
    content = `<div class="eyebrow">НИЧЕГО НЕ ПРОПУСТИТЕ</div><h2>Ход партии</h2><div class="event-log">${[...state.log].reverse().map(item => `<article class="log-item ${item.type}"><span>Р${item.round}</span><p>${e(item.text)}</p></article>`).join('') || '<p>Первый бросок ещё впереди.</p>'}</div>`;
  }
  if (modal === 'card') {
    content = `<div class="card-preview"><img src="${cardImage(state.active.id)}" alt="Активная карта"/><h2>${e(cardLabel(state.active, state.wildRule))}</h2><p>Эти кубики на карте приносят вдвое больше очков.<br>Карту нужно забрать, как только свободных кубиков достаточно.</p></div>`;
  }
  if (modal === 'leave') content = `<div class="eyebrow">ВЫХОД ИЗ КОМНАТЫ</div><h2>${myId === state.hostId ? 'Закрыть этот стол?' : 'Покинуть игру?'}</h2><p>${myId === state.hostId ? 'Вы создатель. Комната закроется для всех игроков.' : state.phase === 'lobby' ? 'Ваше место освободится для другого игрока.' : 'Партия будет ждать вас. Вернуться можно в этой вкладке через кнопку восстановления.'}</p><div class="modal-actions"><button class="button secondary" data-action="close-modal">Остаться</button><button class="button danger" data-action="confirm-leave">${myId === state.hostId ? 'Закрыть комнату' : 'Выйти'}</button></div>`;
  if (modal === 'restore') content = `<div class="eyebrow">ЗНАКОМЫЙ СТОЛ</div><h2>Вернуться в комнату?</h2><p>В этой вкладке сохранилось ваше место. Попробуем восстановить подключение.</p><div class="modal-actions"><button class="button secondary" data-action="discard-restore">Начать заново</button><button class="button primary" data-action="restore-room">Вернуться ${icon('arrow')}</button></div>`;
  if (modal === 'copy') content = `<h2>Ваше приглашение</h2><p>Скопируйте текст из поля.</p><input class="copy-fallback" readonly value="${e(inspectId)}" aria-label="Текст приглашения"/>`;
  document.body.classList.add('modal-open');
  const wasFocused = document.activeElement?.dataset?.claimDie;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${modal === 'claim' ? 'Выбор кубиков для карты' : 'Информация об игре'}" tabindex="-1"><button class="modal-close icon-button" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button>${content}</section></div>`;
  if (wasFocused) modalRoot.querySelector(`[data-claim-die="${wasFocused}"]`)?.focus();
  else modalRoot.querySelector('.modal').focus({ preventScroll: true });
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button, [data-action]'); if (!button || button.disabled) return;
  if (button.dataset.mode) { updateProfile(); mode = button.dataset.mode; render(); return; }
  if (button.dataset.avatar) { updateProfile(); profile.avatar = Number(button.dataset.avatar); render(); return; }
  if (button.dataset.capacity) { updateProfile(); capacity = Number(button.dataset.capacity); render(); return; }
  if (button.dataset.die) { pickDie(button.dataset.die); return; }
  if (button.dataset.inspect) { showModal('inventory', button.dataset.inspect); return; }
  if (button.dataset.kick) { try { await connection.kick(button.dataset.kick); } catch (e) { toast(e.message); } return; }
  if (button.dataset.claimDie) {
    const id = button.dataset.claimDie; if (claimSelected.has(id)) claimSelected.delete(id); else claimSelected.add(id);
    beep(); renderModal(); return;
  }
  switch (button.dataset.action) {
    case 'home': event.preventDefault(); if (state) showModal('leave'); break;
    case 'rules': showModal('rules'); break;
    case 'copy-code': copy(state.code, 'Код комнаты скопирован'); break;
    case 'copy-link': copy(inviteURL(), 'Ссылка-приглашение скопирована'); break;
    case 'ready': send({ type: 'ready', value: !state.players.find(p => p.id === myId).ready }); break;
    case 'start': send({ type: 'start' }); break;
    case 'roll': send({ type: 'roll' }); break;
    case 'take': send({ type: 'take', ids: [...selected] }); break;
    case 'choose-claim': showModal('claim'); break;
    case 'claim': if (await send({ type: 'claim', ids: [...claimSelected] })) { claimSelected.clear(); closeModal(); } break;
    case 'next': send({ type: 'next' }); break;
    case 'rematch': rollKey = null; lastPhase = null; send({ type: 'rematch' }); break;
    case 'view-card': if (state.active) showModal('card'); break;
    case 'log': showModal('log'); break;
    case 'leave': showModal('leave'); break;
    case 'confirm-leave':
      if (connection.role === 'guest' && !['lobby', 'finished'].includes(state.phase)) { connection.close(false); connection = null; state = null; status = 'offline'; busy = false; closeModal(); scene.setHero(); render(); }
      else reset(); break;
    case 'sound': sounds.roll = !sound; sounds.turns = !sound; saveSounds(); render(); break;
    case 'settings': showModal('settings'); break;
    case 'test-sound': beep('roll'); break;
    case 'fullscreen': await fullscreen(); break;
    case 'close-modal': closeModal(); break;
    case 'backdrop': if (event.target === button && modal !== 'claim') closeModal(); break;
    case 'discard-restore': RoomConnection.discard(); closeModal(); break;
    case 'restore-room': {
      const saved = RoomConnection.saved(); closeModal(); if (!saved) break;
      busy = true; connection = newConnection(); render();
      try { await connection.restore(saved); } catch (error) { connection?.close(false); connection = null; state = null; busy = false; render(); toast(error.message); showModal('restore'); }
      break;
    }
  }
});
document.addEventListener('submit', event => {
  if (event.target.id === 'entry-form') { event.preventDefault(); enterRoom(); }
  if (event.target.id === 'bid-form') {
    event.preventDefault(); const input = document.querySelector('#bid-input');
    if (input.value.trim() === '') return;
    send({ type: 'bid', value: Number(input.value) });
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'player-name') profile.name = event.target.value;
  if (event.target.id === 'room-code-input') { codeInput = normalizeCode(event.target.value); event.target.value = codeInput; }
  if (event.target.id === 'setting-volume') { sounds.volume = Number(event.target.value); saveSounds(); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'first-player-select') send({ type: 'configure', first: Number(event.target.value) });
  if (event.target.id === 'setting-roll') { sounds.roll = event.target.checked; saveSounds(); }
  if (event.target.id === 'setting-turns') { sounds.turns = event.target.checked; saveSounds(); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && modal) closeModal();
  if (modal && event.key === 'Tab') {
    const focusable = [...modalRoot.querySelectorAll('button:not(:disabled),input,select,a[href]')];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement.classList.contains('modal'))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
async function fullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else { await document.exitFullscreen(); return; }
    try { await screen.orientation?.lock('landscape'); } catch { /* platform restriction: portrait overlay remains */ }
  } catch { toast('Поверните устройство горизонтально. В этом браузере полноэкранный режим недоступен.'); }
}
document.querySelector('#landscape-button').addEventListener('click', fullscreen);
window.addEventListener('beforeunload', event => { if (state && !['lobby', 'finished'].includes(state.phase)) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('online', () => connection?.poll());
render();
if (RoomConnection.saved()) showModal('restore');
