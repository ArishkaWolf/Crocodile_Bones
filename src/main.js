import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/cyrillic-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/cyrillic-600.css';
import '@fontsource/manrope/latin-800.css';
import '@fontsource/manrope/cyrillic-800.css';
import '@fontsource/unbounded/latin-600.css';
import '@fontsource/unbounded/cyrillic-600.css';
import './style.css';
import './desktop.css';
import './table.css';
import { TableScene } from './scene.js';
import { TablePresentation } from './presentation.js';
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
let revealing = false, revealStarted = 0, revealRound = 0, revealTimer, finishing = false, finishTimer;
let dealing = false, dealTimer;
let pendingPick = null, sendingPick = false, pickTimer, previewCardId = null;
let sounds = { roll: true, turns: true, volume: 0.5 };
let motion = true;
try { motion = localStorage.getItem('crocodile-motion') !== 'reduced'; } catch {}
document.documentElement.dataset.motion = motion ? 'full' : 'reduced';
try { sounds = { ...sounds, ...JSON.parse(localStorage.getItem('crocodile-sound') || '{}') }; } catch {}
sound = sounds.roll || sounds.turns;
const scene = new TableScene(sceneEl, pickDie, () => { if (rolling) { rolling = false; if (state) render(); } });
scene.reduced = !motion;
const presentation = new TablePresentation({ asset, getState: () => state, getMyId: () => myId, scene, signal: sendSignal, onSlam: () => beep('slam'), onAward: () => beep('award') });

function toast(message) {
  const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 4500);
}
function beep(kind = 'click') {
  if (!sound || (kind === 'roll' ? !sounds.roll : !sounds.turns)) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    if (kind === 'award') {
      [523.25,659.25,783.99].forEach((frequency,i)=>{
        const start=audio.currentTime+i*.12, osc=audio.createOscillator(), gain=audio.createGain();
        osc.type='sine';osc.frequency.value=frequency;
        gain.gain.setValueAtTime(.001,start);gain.gain.exponentialRampToValueAtTime(.07*sounds.volume+.001,start+.025);gain.gain.exponentialRampToValueAtTime(.001,start+.6);
        osc.connect(gain);gain.connect(audio.destination);osc.start(start);osc.stop(start+.62);
      });
      return;
    }
    if (kind === 'roll') {
      for (let i = 0; i < 24; i++) {
        const start = audio.currentTime + i * 0.115;
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
    osc.type = kind === 'slam' ? 'triangle' : 'sine'; osc.frequency.setValueAtTime(kind === 'slam' ? 130 : kind === 'reveal' ? 660 : kind === 'turn' ? 880 : 440, audio.currentTime);
    osc.frequency.exponentialRampToValueAtTime(kind === 'slam' ? 32 : kind === 'turn' ? 660 : 300, audio.currentTime + .22);
    gain.gain.setValueAtTime((kind === 'slam' ? .7 : .09) * sounds.volume, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .3);
    osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(audio.currentTime + .31);
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
async function sendSignal(signal) {
  try { await connection?.signal(signal); } catch (error) { if (signal.type !== 'selection') toast(error.message); }
}
async function flushPick() {
  if (sendingPick || !pendingPick) return;
  const pick = pendingPick; pendingPick = null; sendingPick = true;
  try { await sendSignal(pick); } finally { sendingPick = false; if (pendingPick) flushPick(); }
}
function sharedSelection() {
  return currentPlayer()?.id === myId ? selected : new Set(state?.social?.selection?.ids || []);
}
function newConnection() {
  return new RoomConnection({
    onState: (next, id) => {
      const prev = state, transfers = presentation.capture(prev, next); state = next; myId = id;
      if (transfers.length) {
        dealing = true; clearTimeout(dealTimer);
        dealTimer = setTimeout(() => { dealing = false; render(); }, presentation.duration(transfers) + 180);
      }
      if (prev?.phase !== next.phase || prev?.order[prev.turn] !== next.order[next.turn]) selected.clear();
      if (prev?.pending?.cardId !== next.pending?.cardId || prev?.pending?.playerId !== next.pending?.playerId) claimSelected.clear();
      if (next.phase !== 'lobby') {
        const nextKey = String(next.rollId);
        if (next.rollId && next.phase !== 'roll' && nextKey !== rollKey) {
          rollKey = nextKey; rolling = next.phase === 'bidding' || !!prev;
          if (rolling) beep('roll');
        }
      }
      if (prev?.phase === 'bidding' && next.phase !== 'bidding') {
        beep('reveal');
        const duration = motion ? 700 + next.capacity * 420 : 0, at = next.log.findLast(ev => ev.type === 'reveal')?.at;
        const elapsed = at ? Math.max(0,Math.min(duration,Date.now() - at)) : 0;
        revealing = elapsed < duration; revealStarted = performance.now() - elapsed; revealRound = next.round;
        clearTimeout(revealTimer); revealTimer = setTimeout(() => { revealing = false; render(); }, duration - elapsed);
      }
      if (next.phase === 'finished' && prev && prev.phase !== 'finished') {
        finishing = true; clearTimeout(finishTimer);
        finishTimer = setTimeout(() => { finishing = false; render(); }, Math.max(2700, presentation.duration(transfers) + 500));
      }
      if (next.phase === 'collect' && next.order[next.turn] === id && (prev?.phase !== 'collect' || prev?.order[prev.turn] !== id)) beep('turn');
      busy = false;
      document.title = next.phase === 'lobby' ? 'За столом — Кости Крокодила' : `Раунд ${next.round} — Кости Крокодила`;
      if (modal === 'bid' && (next.phase !== 'bidding' || next.submitted.includes(id))) closeModal();
      // Another player's bid must not replace the button or input under your pointer.
      if (prev?.phase === 'bidding' && next.phase === 'bidding' && prev.rollId === next.rollId && prev.submitted.includes(id) === next.submitted.includes(id) && document.querySelector('.table-game')) {
        next.players.forEach((p,i) => {
          if (prev.submitted.includes(p.id) !== next.submitted.includes(p.id)) document.querySelector(`.table-seat[data-player="${CSS.escape(p.id)}"]`).outerHTML = playerSeat(p,i);
        });
        if (next.submitted.includes(id)) document.querySelector('.action-panel').innerHTML = renderActionPanel();
      } else render();
      presentation.play(transfers); presentation.refresh();
      if (modal === 'inventory') renderModal();
    },
    onSocial: social => {
      if (!state) return;
      state.social = social; const shared = sharedSelection(); scene.setSelected(shared);
      document.querySelectorAll('.dice-accessible-row [data-die]').forEach(el => { el.classList.toggle('chosen',shared.has(el.dataset.die)); el.setAttribute('aria-pressed',shared.has(el.dataset.die)); });
      presentation.refresh(social);
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
  clearTimeout(revealTimer); clearTimeout(finishTimer); clearTimeout(pickTimer); clearTimeout(dealTimer); revealing = false; finishing = false; dealing = false; pendingPick = null; presentation.reset();
  scene.setHero(); document.title = 'Кости Крокодила — игра с характером'; render();
}
function statusHTML() {
  if (status === 'online' || status === 'offline') return '';
  const text = { connecting: 'Подключаемся', reconnecting: 'Восстанавливаем связь' }[status];
  return `<span id="connection-status" class="connection-status ${status}"><i></i>${text}</span>`;
}
function brand() { return `<a class="brand" href="./" aria-label="Кости Крокодила, главная" data-action="home"><img src="${avatar(1)}" alt=""/><span>КОСТИ<br>КРОКОДИЛА</span></a>`; }
function header() {
  if (state) return '<header class="table-toolbar"><button class="icon-button" data-action="settings" aria-label="Настройки">'+icon('settings')+'</button></header>';
  return '<header class="header">'+brand()+'<div class="header-actions"><button class="icon-button" data-action="settings" aria-label="Настройки">'+icon('settings')+'</button></div></header>';
}
function renderLanding() {
  const names = ['Солнечный', 'Мечтатель', 'Смельчак', 'Хитрец', 'Крокодил 5', 'Крокодил 6'];
  return `${header()}<main class="landing"><section class="intro"><h1>Кости<br><span>Крокодила</span><span class="title-dot">.</span></h1><p class="intro-description">Немного расчёта. Немного жадности.<br>И один очень удачный бросок.</p><div class="game-facts"><span>${icon('users')}3–4 игрока</span><span>${icon('clock')}15 минут</span><span class="age">8+</span></div><div class="entry-panel"><div class="tabs" role="tablist" aria-label="Способ входа"><button role="tab" aria-selected="${mode === 'create'}" data-mode="create" class="${mode === 'create' ? 'active' : ''}">Создать комнату</button><button role="tab" aria-selected="${mode === 'join'}" data-mode="join" class="${mode === 'join' ? 'active' : ''}">Войти по коду</button></div><form id="entry-form"><label class="field-label" for="player-name">Как вас зовут?</label><input id="player-name" name="name" value="${e(profile.name)}" placeholder="Имя за игровым столом" maxlength="20" autocomplete="nickname" required ${busy ? 'disabled' : ''}/><div class="field-label avatar-label">Выберите своего крокодила</div><div class="avatar-picker" role="group" aria-label="Выбор персонажа">${[1, 2, 3, 4, 5, 6].map(n => `<button type="button" class="avatar-option ${profile.avatar === n ? 'selected' : ''}" data-avatar="${n}" aria-label="${names[n - 1]}" aria-pressed="${profile.avatar === n}" ${busy ? 'disabled' : ''}><img src="${avatar(n)}" alt="${names[n - 1]}"/>${profile.avatar === n ? `<span>${icon('check')}</span>` : ''}</button>`).join('')}</div>${mode === 'create' ? `<div class="field-label">Сколько вас будет?</div><div class="capacity-picker">${[3, 4].map(n => `<button type="button" data-capacity="${n}" class="capacity-option ${capacity === n ? 'selected' : ''}" aria-pressed="${capacity === n}" ${busy ? 'disabled' : ''}><b>${n}</b><span>игрока<small>${n === 3 ? '6 кубиков · 6 раундов' : '9 кубиков · 4 раунда'}</small></span><i></i></button>`).join('')}</div>` : `<label class="field-label" for="room-code-input">Код комнаты</label><input id="room-code-input" class="code-input" name="code" value="${e(codeInput)}" placeholder="ABC123" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" required ${busy ? 'disabled' : ''}/>`}<button type="submit" class="button primary entry-submit" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span> Подключаемся…' : `${mode === 'create' ? 'Создать комнату' : 'Присоединиться'} ${icon('arrow')}`}</button></form></div></section><section class="hero-art" aria-label="Кубики и карты Костей Крокодила"><div class="hero-orbit orbit-one"></div><div class="hero-orbit orbit-two"></div><div class="hero-badge">АЗАРТ В ХОРОШЕЙ КОМПАНИИ ${icon('dice')}</div><div class="hero-cards"><img src="${cardImage('3blue')}" class="hero-card card-one" alt="Карта 3 голубых"/><img src="${cardImage('4green')}" class="hero-card card-two" alt="Карта 4 зелёных"/><img src="${cardImage('change')}" class="hero-card card-three" alt="Четырёхцветная карта"/></div><div class="hero-caption"><span class="sparkle">✦</span><div><b>Не жадничайте.<br>Хотя… решать вам.</b><p>Меньше ставка — раньше ход.</p></div></div><span class="art-coord">36 КУБИКОВ / 10 КАРТ / ВАША УДАЧА</span></section></main><footer class="landing-footer"><span>Автор: Вячеслав Крокодил</span><button data-action="rules">Познакомиться с правилами ${icon('arrow')}</button></footer>`;
}
function renderLobby() {
  const host = myId === state.hostId, me = state.players.find(p => p.id === myId);
  const allReady = state.players.length === state.capacity && state.players.every(p => p.ready && p.online);
  return `${header()}<main class="lobby"><div class="lobby-heading"><div><p>Пригласите друзей и приготовьтесь немного рискнуть.</p></div><span class="player-counter">${icon('users')} ${state.players.length}<span>/ ${state.capacity}</span></span></div><section class="lobby-seats" style="--seats:${state.capacity}">${Array.from({ length: state.capacity }, (_, i) => {
    const p = state.players[i];
    return p ? `<article data-player="${p.id}" class="lobby-player ${p.ready ? 'is-ready' : 'is-thinking'} ${p.id === myId ? 'is-you' : ''}"><div class="seat-top"><span>МЕСТО ${String(i + 1).padStart(2, '0')}</span>${p.id === state.hostId ? `<span class="host-tag">${icon('cup')} Создатель</span>` : host ? `<button class="kick" data-kick="${p.id}" aria-label="Освободить место ${e(p.name)}">${icon('close')}</button>` : ''}</div><button class="lobby-avatar-button reaction-anchor" ${p.id === myId ? 'data-action="emotions"' : 'data-inspect="'+p.id+'"'} aria-label="${e(p.name)}${p.id === myId ? ', открыть эмоции' : ''}"><img class="lobby-avatar" src="${avatar(p.avatar)}" alt="Персонаж ${e(p.name)}"/></button><h2>${e(p.name)} ${p.id === myId ? '<small>вы</small>' : ''}</h2><span class="ready-state ${p.ready && p.online ? 'ready' : ''}">${p.online ? p.ready ? `${icon('check')} Готов к игре` : 'Выбирает момент…' : 'Ждём подключения'}</span>${i === state.first ? `<span class="first-player-tag">${icon('cup')} Первый бросок</span>` : ''}</article>` : `<article class="lobby-player empty"><div class="seat-top"><span>МЕСТО ${String(i + 1).padStart(2, '0')}</span></div><div class="empty-avatar">${icon('users')}</div><h2>Ждём друга</h2><button class="text-button" data-action="copy-link">Пригласить ${icon('arrow')}</button></article>`;
  }).join('')}</section><div class="lobby-bottom"><section class="invite-panel"><div class="mini-heading">ССЫЛКА НА ВАШ СТОЛ</div><div class="invite-url"><span>${e(inviteURL())}</span><button class="icon-button" data-action="copy-link" aria-label="Скопировать приглашение">${icon('copy')}</button></div><p>Отправьте друзьям ссылку. Место игрока сохраняется при обновлении страницы.</p></section><section class="lobby-settings"><div class="mini-heading">${state.capacity === 3 ? '6 КУБИКОВ · 6 РАУНДОВ' : '9 КУБИКОВ · 4 РАУНДА'}</div>${host ? `<label class="first-select">Первым бросает <select id="first-player-select" aria-label="Первый игрок">${state.players.map((p, i) => `<option value="${i}" ${i === state.first ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select></label>` : `<p>Первым бросает <b>${e(state.players[state.first].name)}</b>.</p>`}<p>Выберите того, у кого самые прочные кости.</p></section></div><div class="lobby-controls"><div>${statusHTML()}<span class="lobby-hint">${allReady ? 'Все на месте. Можно начинать!' : `Готовы ${state.players.filter(p => p.ready).length} из ${state.capacity} игроков`}</span></div><div class="lobby-buttons"><button class="button ${me.ready ? 'secondary' : 'primary'}" data-action="ready">${icon(me.ready ? 'check' : 'dice')}${me.ready ? 'Я готов · отменить' : 'Я готов'}</button>${host ? `<button class="button ${allReady ? 'primary' : 'secondary'}" data-action="start" ${!allReady ? 'disabled' : ''}>Начать игру ${icon('arrow')}</button>` : ''}</div></div></main>`;
}
const phaseNames = { roll: 'Новый бросок', bidding: 'Тайные ставки', collect: 'Сбор кубиков', claim: 'Карта ваша!', roundEnd: 'Раунд завершён', finished: 'Итоги партии' };
function currentPlayer() { return state.players.find(p => p.id === (state.phase === 'claim' ? state.pending?.playerId : state.order[state.turn])); }
function miniDie(d) {
  return `<span class="mini-die ${d.color}" data-owned-die="${d.id}" aria-label="Кубик ${d.value}">${d.value}</span>`;
}
function cardStack(p, c, large = false) {
  const dice = p.dice.filter(d => d.card === c.id);
  return `<span class="held-card ${large ? 'large-card-stack' : ''}" aria-label="${e(cardLabel(c,state.wildRule))}, кубики: ${dice.map(d=>d.value).join(', ')}"><img src="${cardImage(c.id)}" alt="${e(cardLabel(c,state.wildRule))}" data-owned-card="${c.id}"/><span class="held-card-dice ${dice.length > 4 ? 'three-columns' : ''}">${dice.map(miniDie).join('')}</span></span>`;
}
function playerSeat(p, i) {
  const mine = p.id === myId;
  const casting = (state.phase === 'roll' || rolling) && state.players[state.first].id === p.id;
  const current = casting || currentPlayer()?.id === p.id && ['collect', 'claim'].includes(state.phase);
  const submitted = state.submitted.includes(p.id), reveal = state.phase !== 'bidding' && Object.hasOwn(state.bids, p.id);
  const relative = (i - state.players.findIndex(x => x.id === myId) + state.capacity) % state.capacity;
  const position = state.capacity === 4 ? ['south','west','north','east'][relative] : ['south','north-west','north-east'][relative];
  const burned = state.log.some(ev => ev.round === state.round && ev.type === 'skip' && ev.playerId === p.id);
  const index = state.order.indexOf(p.id), flip = revealing && revealRound === state.round;
  return '<article class="table-seat seat-'+position+' '+(mine?'is-you ':'')+(current?'is-current ':'')+(submitted?'is-ready ':'')+(state.phase==='bidding'&&!submitted&&!rolling?'is-thinking ':'')+'" data-player="'+p.id+'">'
    +'<div class="seat-profile"><button class="seat-avatar reaction-anchor" '+(mine?'data-action="emotions"':'data-inspect="'+p.id+'"')+' aria-label="'+e(p.name)+(mine?', открыть эмоции':', посмотреть коллекцию')+'"><img src="'+avatar(p.avatar)+'" alt=""/>'+(mine?'<span class="avatar-emotion-hint">☺</span>':'')+'</button><div class="seat-name"><b>'+e(p.name)+'</b>'+(mine?'<span class="private-score">'+score(p)+' очк.</span>':'')+(current?'<span class="seat-turn">Ваш ход</span>'.replace('Ваш ход',casting ? (mine?'Ваш бросок':'Бросает кубики') : mine?'Ваш ход':'Ходит'):state.phase==='bidding'&&!rolling?'<span class="seat-status">'+(submitted?'Готов':'Думает…')+'</span>':'')+'</div>'+(i===state.first?'<span class="seat-cup" title="Первый бросок">'+icon('cup')+'</span>':'')+'</div>'
    +'<button class="seat-collection" data-inspect="'+p.id+'" aria-label="Рассмотреть кубики и карты: '+e(p.name)+'"><span class="seat-dice">'+p.dice.filter(d=>!d.card).map(miniDie).join('')+'</span><span class="seat-cards">'+p.cards.map(c=>cardStack(p,c)).join('')+'</span>'+(!p.dice.length&&!p.cards.length?'<span class="collection-empty">Кубики и карты</span>':'')+'</button>'
    +(submitted?'<div class="bid-paper '+(reveal?'is-open ':'')+(flip?'is-flipping ':'')+(burned?'is-burned':'')+'" style="--bid-font:'+Math.min(26,72/String(state.bids[p.id] ?? 0).length)+'px;--flip-delay:'+(Math.max(-800,index*420-(performance.now()-revealStarted)))+'ms"><div class="bid-paper-inner"><div class="bid-back">'+(mine&&!reveal?'<b>'+state.bids[p.id]+'</b>':icon('lock'))+'</div><div class="bid-front"><img src="'+cardImage('list')+'" alt=""/><b>'+ (reveal?state.bids[p.id]:'')+'</b></div></div>'+(burned?'<span class="burned-label">Сгорела</span>':'')+'</div>':'')
    +(mine&&burned&&!state.social?.slammed?.includes(myId)?'<button class="seat-slam" data-action="slam" aria-label="Ударить по столу">✊</button>':'')+'</article>';
}
function renderActionPanel() {
  const first = state.players[state.first], turn = currentPlayer();
  if (status !== 'online') return '<div class="action-title"><span class="spinner"></span><h3>Восстанавливаем соединение…</h3></div>';
  if (rolling) return '<div class="action-title"><span class="spinner"></span><h3>Кубики крутятся…</h3></div>';
  if (revealing) return '<div class="action-title"><span class="reveal-spark">✦</span><h3>Открываем ставки</h3></div>';
  if (dealing) return '<div class="action-title"><span class="reveal-spark">✦</span><h3>Пополняем коллекцию</h3></div>';
  if (state.phase==='roll') return '<div class="action-title"><h3>'+(first.id===myId?'Ваш бросок':'Бросает '+e(first.name))+'</h3></div><button class="button primary" data-action="roll" '+(first.id!==myId?'disabled':'')+'>'+icon('dice')+' Бросить кубики</button>';
  if (state.phase==='bidding') return state.submitted.includes(myId)
    ? '<div class="action-title">'+icon('lock')+'<h3>Ждём остальные ставки</h3></div><span class="waiting-chip">'+state.submitted.length+' / '+state.capacity+'</span>'
    : '<div class="action-title"><h3>Сколько заберёте?</h3></div><button class="button primary" data-action="write-bid">Написать ставку</button>';
  if (state.phase==='claim') return '<div class="action-title">'+icon('cards')+'<h3>'+(turn?.id===myId?'Выберите кубики для карты':e(turn?.name)+' получает карту')+'</h3></div>'+(turn?.id===myId?'<button class="button primary" data-action="choose-claim">Выбрать кубики</button>':'');
  if (state.phase==='collect') {
    if (turn?.id!==myId) return '<div class="action-title"><h3>Ходит '+e(turn?.name)+'</h3><p>Выбирает кубики на '+state.bids[turn?.id]+'</p></div>';
    const sum=state.table.filter(d=>selected.has(d.id)).reduce((n,d)=>n+d.value,0), target=state.bids[myId];
    return '<div class="action-title"><h3>Выберите кубики на '+target+'</h3></div><div class="take-controls"><span class="selected-sum '+(sum===target?'exact':sum>target?'over':'')+'"><b>'+sum+'</b><span> / '+target+'</span></span><button class="button primary" data-action="take" '+(sum!==target||!selected.size?'disabled':'')+'>Забрать</button></div>';
  }
  if (state.phase==='roundEnd') return '<div class="action-title"><h3>Раунд завершён</h3></div><button class="button primary" data-action="next" '+(first.id!==myId?'disabled':'')+'>Следующий раунд</button>';
  return '<div class="action-title"><span class="reveal-spark">✦</span><h3>Подводим итоги</h3></div>';
}
function dieButton(d, chosen = false, attrs = '') {
  return `<button class="die-token ${d.color} ${chosen ? 'chosen' : ''} ${d.card ? 'locked' : ''}" ${attrs} aria-pressed="${chosen}" aria-label="${d.value}, ${({ blue: 'голубой', green: 'зелёный', yellow: 'жёлтый' })[d.color]} кубик${d.card ? ', закреплён на карте' : ''}"><span>${d.value}</span>${d.card ? icon('lock') : ''}</button>`;
}
function renderGame() {
  return header()+'<main class="game table-game seats-'+state.capacity+'"><div class="table-round">Раунд <b>'+state.round+'</b> / '+totalRounds(state)+'</div><section class="table-area" aria-label="Игровой стол"><div class="table-wordmark" aria-hidden="true">КОСТИ<br>КРОКОДИЛА</div><aside class="card-dock">'+(state.active?'<button class="active-card-image" data-action="view-card" aria-label="Активная карта: '+e(cardLabel(state.active,state.wildRule))+'"><img src="'+cardImage(state.active.id)+'" alt="'+e(cardLabel(state.active,state.wildRule))+'"/></button><span class="active-card-label">Активная карта</span>':'')+(state.nextCard?'<button class="next-card-image" data-card-preview="'+state.nextCard.id+'" aria-label="Следующая карта"><img src="'+cardImage(state.nextCard.id)+'" alt="Следующая карта"/></button>':'')+'</aside>'+(!scene.available&&!rolling?'<div class="dice-accessible-row fallback" role="group" aria-label="Кубики на столе">'+state.table.map(d=>dieButton(d,sharedSelection().has(d.id),'data-die="'+d.id+'" '+(state.phase!=='collect'||currentPlayer()?.id!==myId?'disabled':''))).join('')+'</div>':'')+'</section><section class="table-seats" aria-label="Игроки за столом">'+state.players.map(playerSeat).join('')+'</section><section class="action-panel" aria-live="polite">'+renderActionPanel()+'</section>'+(state.phase==='collect'&&currentPlayer()?.id===myId&&!rolling&&!revealing?'<div class="accessible-dice-controls" role="group" aria-label="Выбрать кубики с клавиатуры">'+state.table.map(d=>dieButton(d,selected.has(d.id),'data-die="'+d.id+'"')).join('')+'</div>':'')+'</main>';
}
function renderFinished() {
  const sorted = [...state.players].sort((a, b) => score(b) - score(a));
  const winning = score(sorted[0]), winners = sorted.filter(p => score(p) === winning);
  return `${header()}<main class="results"><div class="result-sparkle">✦</div><div class="eyebrow">ВСЕ КУБИКИ РАЗОБРАНЫ. ИЛИ ПОЧТИ.</div><h1>${winners.length > 1 ? 'Разделили удачу!' : `${e(sorted[0].name)} побеждает!`}</h1><p>Хороший расчёт, немного смелости и ваши ${totalRounds(state)} раундов.</p><section class="results-grid">${sorted.map((p, i) => `<article data-player="${p.id}" class="result-card ${score(p) === winning ? 'winner' : ''}"><span class="result-place">${score(p) === winning ? icon('cup') : String(sorted.findIndex(x => score(x) === score(p)) + 1).padStart(2, '0')}</span><button class="result-avatar-button reaction-anchor" ${p.id === myId ? 'data-action="emotions"' : 'data-inspect="'+p.id+'"'} aria-label="${e(p.name)}${p.id === myId ? ', открыть эмоции' : ', посмотреть коллекцию'}"><img src="${avatar(p.avatar)}" alt=""/></button><h2>${e(p.name)}${p.id === myId ? ' <small>вы</small>' : ''}</h2><strong>${score(p)}<span>очков</span></strong><p>${p.dice.filter(d => !d.card).reduce((n, d) => n + d.value, 0)} за кубики + ${p.dice.filter(d => d.card).reduce((n, d) => n + d.value * 2, 0)} на картах</p><div>${icon('dice')} ${p.dice.length} куб. ${icon('cards')} ${p.cards.length} карт.</div><button class="result-collection-button" data-inspect="${p.id}">Рассмотреть коллекцию</button></article>`).join('')}</section><div class="result-controls">${myId === state.hostId ? '<button class="button primary" data-action="rematch">Ещё одну партию? '+icon('arrow')+'</button>' : '<span class="waiting-chip">Создатель может начать новую партию</span>'}<button class="button secondary" data-action="log">Посмотреть ход партии</button></div></main>`;
}
function render() {
  // Preserve typed bids when a different player's ready/presence update arrives.
  const previousInput = document.querySelector('#bid-input'), bid = previousInput?.value;
  const focused = document.activeElement?.id, selectionStart = document.activeElement?.selectionStart;
  const landing = !state, lobby = state?.phase === 'lobby', finished = state?.phase === 'finished' && !revealing && !finishing;
  document.body.className = landing ? 'view-landing' : lobby ? 'view-lobby' : finished ? 'view-results' : 'view-game';
  app.innerHTML = landing ? renderLanding() : lobby ? renderLobby() : finished ? renderFinished() : renderGame();
  if (bid != null && document.querySelector('#bid-input')) document.querySelector('#bid-input').value = bid;
  if (focused && document.getElementById(focused)) { const el = document.getElementById(focused); el.focus({ preventScroll: true }); if (typeof selectionStart === 'number' && el.type === 'text') el.setSelectionRange(selectionStart, selectionStart); }
  if (!landing) {
    scene.setGame();
    if (lobby || finished) sceneEl.style.visibility = 'hidden';
    else {
      sceneEl.style.visibility = 'visible';
      const key = state.rollId ? String(state.rollId) : 'empty', changed = scene.lastRoll !== key;
      scene.setDice(state.table, key, state.phase === 'collect' && currentPlayer()?.id === myId && !rolling && !revealing && !dealing, sharedSelection());
      if (changed && !rolling) scene.settle();
    }
  } else sceneEl.style.visibility = 'visible';
  presentation.refresh();
  requestAnimationFrame(() => { scene.resize(); presentation.positionReactions(); });
  if (!dealing && !revealing && state?.phase === 'claim' && state.pending?.playerId === myId && lastPhase !== `${state.round}:claim:${state.pending.cardId}`) {
    lastPhase = `${state.round}:claim:${state.pending.cardId}`; showModal('claim');
  }
  if (modal === 'claim' && state?.phase !== 'claim') closeModal();
}
function pickDie(id) {
  if (!state || state.phase !== 'collect' || currentPlayer()?.id !== myId || rolling || revealing || dealing) return;
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  beep(); render();
  pendingPick = { type: 'selection', ids: [...selected], rollId: state.rollId, turn: state.turn };
  clearTimeout(pickTimer); pickTimer = setTimeout(flushPick, 60);
}
function closeModal() { modal = null; modalRoot.innerHTML = ''; document.body.classList.remove('modal-open'); }
function showModal(type, data) { modal = type; if (type === 'inventory') inspectId = data; if (type === 'copy') inspectId = data; if (type === 'card-preview') previewCardId = data; renderModal(); }
function renderModal() {
  if (!modal) return;
  let content = '', wide = false;
  if (modal === 'rules') {
    content = `<h2>Как играть</h2><div class="rules-content"><p>Побеждает тот, кто наберёт больше очков на собранных кубиках. Обычный кубик приносит своё значение, кубик на карте — <b>вдвое больше</b>.</p><ol><li><b>Бросьте кубики.</b> Первый игрок добавляет из банка 6 случайных кубиков для троих или 9 для четверых. Остаток прошлого раунда бросается вместе с ними.</li><li><b>Сделайте тайную ставку.</b> Каждый вводит число очков, которые хочет забрать. Ставки откроются, когда ответят все.</li><li><b>Забирайте по очереди.</b> Меньше ставка — раньше ход. При равенстве приоритет идёт по часовой стрелке от первого игрока.</li><li><b>Соберите точную сумму.</b> Выберите один или несколько кубиков, сумма которых строго равна ставке. Если нужную сумму уже не собрать, ход автоматически пропускается.</li><li><b>Получайте карты.</b> Если свободных кубиков хватает для активной карты, её обязательно нужно забрать. Вы выбираете, какие подходящие кубики закрепить. Они больше не перемещаются.</li></ol><div class="rule-callout">Четырёхцветная карта: <b>по 2 кубика каждого цвета</b>, всего 6. Их значения тоже удваиваются.</div><p>Следующая карта становится активной сразу. Если она подходит кому-то ещё, игрок получает её вне своего хода. При нескольких претендентах приоритет — от первого игрока по часовой стрелке. Цепочка продолжается, пока есть подходящие карты.</p><p>Неразобранные кубики переходят в следующий раунд, первый игрок меняется по часовой стрелке. Последняя порция из банка означает последний раунд: <b>6 раундов для троих, 4 для четверых</b>. Равные итоговые очки означают общую победу.</p><p class="rules-sources">По <a href="https://docs.google.com/document/d/1a3O1wNkeYDUVxFunPz8pDYVMTn34xOmogsrRMy_Nu40/edit" target="_blank" rel="noopener noreferrer">правилам автора</a> и <a href="https://docs.google.com/document/d/1ZOs0DHDGN_tFIcAwbbAu3JZKFGjJg8XwoSiFCXfUQAs/edit" target="_blank" rel="noopener noreferrer">руководству по комплектации</a>.</p></div>`;
  }
  if (modal === 'inventory') {
    const p = state.players.find(p => p.id === inspectId); if (!p) { closeModal(); return; }
    wide = true;
    content = `<div class="inventory-heading"><img src="${avatar(p.avatar)}" alt=""/><div><div class="eyebrow">КОЛЛЕКЦИЯ ИГРОКА</div><h2>${e(p.name)}</h2></div>${p.id === myId || state.phase === 'finished' ? `<strong>${score(p)}<small>очков</small></strong>` : ''}</div><h3>Свободные кубики <span>×1</span></h3><div class="inventory-dice">${p.dice.filter(d => !d.card).map(d => dieButton(d, false, 'disabled')).join('') || '<p class="empty-copy">Пока пусто. Всё впереди.</p>'}</div><h3>Карты и закреплённые кубики <span>×2</span></h3><div class="inventory-cards">${p.cards.map(c => `<div class="owned-card"><button class="owned-card-preview" data-card-preview="${c.id}" aria-label="Приблизить карту">${cardStack(p,c,true)}</button><div><b>${e(cardLabel(c, state.wildRule))}</b>${p.id === myId || state.phase === 'finished' ? `<span>${p.dice.filter(d => d.card === c.id).reduce((n, d) => n + d.value * 2, 0)} очков</span>` : ''}</div></div>`).join('') || '<p class="empty-copy">Собирайте цвета, чтобы получать карты.</p>'}</div>`;
  }
  if (modal === 'settings') {
    content = `<h2>Настройки</h2><div class="settings-navigation"><button class="button secondary" data-action="rules">${icon('help')} Как играть</button>${state ? `<button class="button secondary" data-action="fullscreen">${icon('expand')} Полный экран</button>` : ''}</div><p>Настройки сохраняются на этом устройстве.</p><label class="settings-row"><span>Плавные анимации<small>Броски, полёт карт и эмоции</small></span><input type="checkbox" id="setting-motion" ${motion ? 'checked' : ''}/></label><label class="settings-row"><span>Звук кубиков<small>Перекатывание и стук во время броска</small></span><input type="checkbox" id="setting-roll" ${sounds.roll ? 'checked' : ''}/></label><label class="settings-row"><span>Звуки игры<small>Выбор кубиков, раскрытие ставок и ваш ход</small></span><input type="checkbox" id="setting-turns" ${sounds.turns ? 'checked' : ''}/></label><label class="settings-row"><span>Громкость</span><input id="setting-volume" type="range" min="0" max="1" step="0.05" value="${sounds.volume}" aria-label="Громкость звуков"/></label><button class="button secondary settings-test" data-action="test-sound">Послушать кубики ${icon('volume')}</button>${state ? `<div class="settings-navigation"><button class="text-button" data-action="log">${icon('clock')} Ход партии</button><button class="text-button" data-action="leave">${icon('exit')} Выйти из комнаты</button></div>` : ''}`;
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
  if (modal === 'card' || modal === 'card-preview') {
    const preview = modal === 'card' ? state.active : [...state.players.flatMap(p => p.cards), state.nextCard, state.active].find(c => c?.id === previewCardId);
    if (!preview) { closeModal(); return; }
    const owner = state.players.find(p=>p.cards.some(c=>c.id===preview.id));
    content = `<div class="card-preview">${owner ? cardStack(owner,preview,true) : `<img src="${cardImage(preview.id)}" alt="Карта"/>`}<h2>${e(cardLabel(preview, state.wildRule))}</h2><p>Эти кубики на карте приносят вдвое больше очков.<br>Карту нужно забрать, как только свободных кубиков достаточно.</p></div>`;
  }
  if (modal === 'bid') {
    if (state.phase !== 'bidding' || state.submitted.includes(myId)) { closeModal(); return; }
    content = '<form id="bid-form" class="paper-bid-form"><img src="'+cardImage('list')+'" alt=""/><label for="bid-input">Ваша тайная ставка</label><input id="bid-input" inputmode="numeric" type="number" min="0" max="1000000" step="1" placeholder="0" required autocomplete="off"/><button class="button primary" type="submit">Готово '+icon('lock')+'</button></form>';
  }
  if (modal === 'leave') content = `<div class="eyebrow">ВЫХОД ИЗ КОМНАТЫ</div><h2>${myId === state.hostId ? 'Закрыть этот стол?' : 'Покинуть игру?'}</h2><p>${myId === state.hostId ? 'Вы создатель. Комната закроется для всех игроков.' : state.phase === 'lobby' ? 'Ваше место освободится для другого игрока.' : 'Партия будет ждать вас. Вернуться можно в этой вкладке через кнопку восстановления.'}</p><div class="modal-actions"><button class="button secondary" data-action="close-modal">Остаться</button><button class="button danger" data-action="confirm-leave">${myId === state.hostId ? 'Закрыть комнату' : 'Выйти'}</button></div>`;
  if (modal === 'restore') content = `<div class="eyebrow">ЗНАКОМЫЙ СТОЛ</div><h2>Вернуться в комнату?</h2><p>В этой вкладке сохранилось ваше место. Попробуем восстановить подключение.</p><div class="modal-actions"><button class="button secondary" data-action="discard-restore">Начать заново</button><button class="button primary" data-action="restore-room">Вернуться ${icon('arrow')}</button></div>`;
  if (modal === 'copy') content = `<h2>Ваше приглашение</h2><p>Скопируйте текст из поля.</p><input class="copy-fallback" readonly value="${e(inspectId)}" aria-label="Текст приглашения"/>`;
  document.body.classList.add('modal-open');
  const wasFocused = document.activeElement?.dataset?.claimDie;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal ${wide ? 'wide' : ''} ${modal === 'bid' ? 'bid-modal' : ''}" role="dialog" aria-modal="true" aria-label="${modal === 'claim' ? 'Выбор кубиков для карты' : 'Информация об игре'}" tabindex="-1"><button class="modal-close icon-button" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button>${content}</section></div>`;
  if (wasFocused) modalRoot.querySelector(`[data-claim-die="${wasFocused}"]`)?.focus();
  else if (modal === 'bid') modalRoot.querySelector('#bid-input').focus({ preventScroll: true });
  else modalRoot.querySelector('.modal').focus({ preventScroll: true });
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button, [data-action]'); if (!button || button.disabled) return;
  if (button.dataset.cardPreview) { showModal('card-preview', button.dataset.cardPreview); return; }
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
    case 'emotions': presentation.togglePicker(); break;
    case 'slam': sendSignal({ type: 'slam' }); break;
    case 'write-bid': showModal('bid'); break;
    case 'home': event.preventDefault(); if (state) showModal('leave'); break;
    case 'rules': showModal('rules'); break;
    case 'copy-code': copy(state.code, 'Код комнаты скопирован'); break;
    case 'copy-link': copy(inviteURL(), 'Ссылка-приглашение скопирована'); break;
    case 'ready': send({ type: 'ready', value: !state.players.find(p => p.id === myId).ready }); break;
    case 'start': send({ type: 'start' }); break;
    case 'roll': send({ type: 'roll' }); break;
    case 'take': if (!revealing) { clearTimeout(pickTimer); pendingPick = null; send({ type: 'take', ids: [...selected] }); } break;
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
  if (event.target.id === 'setting-motion') { motion = event.target.checked; scene.reduced = !motion; document.documentElement.dataset.motion = motion ? 'full' : 'reduced'; try { localStorage.setItem('crocodile-motion',motion ? 'full' : 'reduced'); } catch {} }
  if (event.target.id === 'setting-roll') { sounds.roll = event.target.checked; saveSounds(); }
  if (event.target.id === 'setting-turns') { sounds.turns = event.target.checked; saveSounds(); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && presentation.picker) { presentation.closePicker(); return; }
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
