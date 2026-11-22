const LABELS = ['Привет!', 'Улыбка', 'Смеюсь', 'Смена планов', 'Что?', 'Хитрость', 'Подмигиваю', 'Ура!', 'Отлично!', 'Цветочек', 'Дразнюсь', 'Круто', 'Любовь', 'Ого!', 'Грущу', 'Обидно', 'Злюсь', 'Без слов', 'Не уверен', 'Ничего себе', 'Коварный план', 'Возмущён', 'Ха-ха!', 'Хихикаю', 'Думаю'];
const colorNames = { blue: 'голубой', green: 'зелёный', yellow: 'жёлтый' };
export class TablePresentation {
  constructor({ asset, signal, getState, getMyId, scene, onSlam }) {
    Object.assign(this, { asset, signal, getState, getMyId, scene, onSlam });
    this.seen = new Set(); this.effects = new Set();
    this.layer = document.createElement('div'); this.layer.className = 'table-effects'; document.body.append(this.layer);
    document.addEventListener('pointerdown', event => {
      if (this.picker && !event.target.closest('.reaction-picker, [data-action="emotions"]')) this.closePicker();
    });
    window.addEventListener('resize', () => { if (this.picker) this.positionPicker(); this.positionReactions(); });
  }
  avatar(id) { return document.querySelector(`[data-player="${CSS.escape(id)}"] .reaction-anchor`); }
  canSlam() {
    const s = this.getState(), id = this.getMyId();
    return s?.log.some(ev => ev.round === s.round && ev.type === 'skip' && ev.playerId === id) && !s.social?.slammed?.includes(id);
  }
  togglePicker() {
    if (this.picker) { this.closePicker(); return; }
    const picker = this.picker = document.createElement('section');
    picker.className = 'reaction-picker'; picker.setAttribute('aria-label', 'Эмоции');
    picker.innerHTML = `<div class="reaction-picker-title"><b>Эмоции</b><button type="button" class="reaction-close" aria-label="Закрыть эмоции">×</button></div>${this.canSlam() ? '<button class="slam-option">✊ Ударить по столу</button>' : ''}<div class="sticker-grid">${LABELS.map((label, i) => `<button type="button" data-sticker="${i + 1}" aria-label="${label}"><img src="${this.asset(`stickers/${i + 1}.webp`)}" alt="${label}"/></button>`).join('')}</div>`;
    picker.addEventListener('click', async event => {
      if (event.target.closest('.reaction-close')) { this.closePicker(); return; }
      const sticker = event.target.closest('[data-sticker]');
      if (sticker || event.target.closest('.slam-option')) {
        this.closePicker();
        await this.signal(sticker ? { type: 'reaction', sticker: Number(sticker.dataset.sticker) } : { type: 'slam' });
      }
    });
    document.body.append(picker); this.positionPicker();
    picker.querySelector('button').focus({ preventScroll: true });
  }
  positionPicker() {
    const anchor = this.avatar(this.getMyId()); if (!anchor || !this.picker) return;
    const rect = anchor.getBoundingClientRect(), box = this.picker.getBoundingClientRect();
    this.picker.style.left = `${Math.max(10, Math.min(innerWidth - box.width - 10, rect.left + rect.width / 2 - box.width / 2))}px`;
    this.picker.style.top = `${Math.max(10, rect.top - box.height - 12)}px`;
  }
  closePicker() {
    if (!this.picker) return;
    const picker = this.picker; this.picker = null;
    picker.classList.add('closing'); setTimeout(() => picker.remove(), 180);
  }
  refresh(social = this.getState()?.social) {
    if (this.picker) this.positionPicker();
    const now = Date.now();
    for (const r of social?.reactions || []) {
      if (this.seen.has(r.id)) continue;
      this.seen.add(r.id);
      const age = Math.max(0, now - r.at); if (age >= 4800) continue;
      const el = document.createElement('div'); el.className = `player-reaction ${r.kind === 'slam' ? 'is-slam' : ''}`;
      el.dataset.player = r.playerId; el.setAttribute('role', 'img');
      el.setAttribute('aria-label', r.kind === 'slam' ? 'Удар по столу' : LABELS[r.sticker - 1]);
      el.innerHTML = r.kind === 'slam' ? '<span>✊</span><b>БАХ!</b>' : `<img src="${this.asset(`stickers/${r.sticker}.webp`)}" alt=""/>`;
      el.style.animationDelay = `-${age}ms`; this.layer.append(el);
      if (r.kind === 'slam' && age < 2000) {
        document.body.classList.remove('table-slam'); void document.body.offsetWidth; document.body.classList.add('table-slam');
        setTimeout(() => document.body.classList.remove('table-slam'), 600); this.onSlam?.();
      }
      setTimeout(() => el.remove(), 4800 - age);
    }
    if (this.seen.size > 150) this.seen = new Set([...this.seen].slice(-80));
    this.positionReactions();
  }
  positionReactions() {
    for (const el of this.layer.querySelectorAll('.player-reaction')) {
      const rect = this.avatar(el.dataset.player)?.getBoundingClientRect();
      if (!rect) { el.remove(); continue; }
      const width = el.offsetWidth, height = el.offsetHeight;
      const rise = -parseFloat(getComputedStyle(el).marginTop);
      el.style.left = `${Math.max(width / 2 + 8, Math.min(innerWidth - width / 2 - 8, rect.left + rect.width / 2))}px`;
      el.style.top = `${Math.max(rise + 8, Math.min(innerHeight - (height - rise) - 8, rect.top + rect.height / 2))}px`;
    }
  }
  capture(prev, next) {
    if (!prev || prev.phase === 'lobby' || next.round !== prev.round) return [];
    const lastId = prev.log.at(-1)?.id || 0;
    const card = document.querySelector('.active-card-image')?.getBoundingClientRect();
    return next.log.filter(ev => ev.id > lastId && ['take', 'card'].includes(ev.type)).map(ev => ({
      ...ev, source: card,
      sources: ev.type === 'take' ? ev.dice.map(d => this.scene.dieScreenPosition(d.id)) : [],
    }));
  }
  play(events) {
    let delay = 0;
    for (const ev of events) {
      const target = document.querySelector(`[data-player="${CSS.escape(ev.playerId)}"] .seat-collection`);
      if (!target) continue;
      if (ev.type === 'take') {
        ev.dice.forEach((d, i) => {
          const node = document.createElement('div'); node.className = `flying-die ${d.color}`;
          const pips = value => `<i class="flight-face face-${value}">${Array.from({length:value},()=>'<em></em>').join('')}</i>`;
          const rest=[1,2,3,4,5,6].filter(v=>v!==d.value&&v!==7-d.value), right=rest[0], top=rest.find(v=>v!==right&&v!==7-right);
          node.innerHTML = `<span class="flight-cube">${[d.value,right,top,7-d.value,7-right,7-top].map(pips).join('')}</span>`;
          node.setAttribute('aria-label', `${d.value}, ${colorNames[d.color]} кубик`);
          const owned = target.querySelector(`[data-owned-die="${d.id}"]`); this.fly(node, ev.sources[i], target, delay + i * 65, owned);
        });
        delay += 950 + Math.max(0,ev.dice.length-1)*65;
      } else {
        const node = document.createElement('img'); node.className = 'flying-card'; node.src = this.asset(`cards/${ev.card.id}.webp`); node.alt = '';
        const rect = ev.source;
        this.fly(node, rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: rect.width } : null, target, delay, target.querySelector(`[data-owned-card="${ev.card.id}"]`));
        delay += 850;
      }
    }
  }
  duration(events) {
    if (document.documentElement.dataset.motion === 'reduced') return events.length ? 120 : 0;
    return events.reduce((n,ev)=>n+(ev.type === 'take' ? 950 + Math.max(0,ev.dice.length-1)*65 : 850),0);
  }
  fly(node, source, target, delay, owned) {
    const dest = (owned || target).getBoundingClientRect(), end = { x: dest.left + dest.width / 2, y: dest.top + dest.height / 2 };
    source ||= { x: innerWidth / 2, y: innerHeight * .45, size: 50 };
    node.style.width = `${source.size || 50}px`; if (node.classList.contains('flying-die')) node.style.height = `${source.size || 50}px`;
    node.style.setProperty('--cube-half', `${(source.size || 50) / 2}px`);
    this.layer.append(node); owned?.classList.add('arriving');
    const reduce = document.documentElement.dataset.motion === 'reduced';
    const animation = node.animate([
      { transform: `translate(${source.x}px,${source.y}px) translate(-50%,-50%) scale(1) rotate(-8deg)`, opacity: 1 },
      { transform: `translate(${(source.x + end.x) / 2}px,${Math.min(source.y, end.y) - 60}px) translate(-50%,-50%) scale(1.15) rotate(10deg)`, opacity: 1, offset: .45 },
      { transform: `translate(${end.x}px,${end.y}px) translate(-50%,-50%) scale(.35) rotate(0deg)`, opacity: .15 },
    ], { duration: reduce ? 80 : 850, delay: reduce ? 0 : delay, easing: 'cubic-bezier(.3,.1,.2,1)', fill: 'both' });
    animation.finished.then(() => {
      node.remove(); owned?.classList.remove('arriving'); target.classList.remove('collection-arrived'); void target.offsetWidth; target.classList.add('collection-arrived');
      if (!reduce) {
        const burst = document.createElement('div'); burst.className = 'arrival-sparks'; burst.style.left = `${end.x}px`; burst.style.top = `${end.y}px`;
        burst.innerHTML = Array.from({length:7},(_,i)=>`<i style="--a:${i*51}deg;--distance:${25+i%3*10}px"></i>`).join('');
        this.layer.append(burst); setTimeout(()=>burst.remove(),700);
      }
    }).catch(() => node.remove());
  }
  reset() { this.closePicker(); this.layer.replaceChildren(); this.seen.clear(); }
}
