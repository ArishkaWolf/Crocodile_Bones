const LABELS = ['Привет!', 'Улыбка', 'Смеюсь', 'Смена планов', 'Что?', 'Хитрость', 'Подмигиваю', 'Ура!', 'Отлично!', 'Цветочек', 'Дразнюсь', 'Круто', 'Любовь', 'Ого!', 'Грущу', 'Обидно', 'Злюсь', 'Без слов', 'Не уверен', 'Ничего себе', 'Коварный план', 'Возмущён', 'Ха-ха!', 'Хихикаю', 'Думаю'];
const colorNames = { blue: 'голубой', green: 'зелёный', yellow: 'жёлтый' };
const takeTime = ev => 950 + Math.max(0,ev.dice.length-1)*65;
const awardTime = ev => 3100 + Math.max(0,(ev.diceIds?.length || 1)-1)*110;
function flyingDie(d) {
  const node = document.createElement('div'); node.className = `flying-die ${d.color}`;
  const pips = value => `<i class="flight-face face-${value}">${Array.from({length:value},()=>'<em></em>').join('')}</i>`;
  const rest=[1,2,3,4,5,6].filter(v=>v!==d.value&&v!==7-d.value), right=rest[0], top=rest.find(v=>v!==right&&v!==7-right);
  node.innerHTML = `<span class="flight-cube">${[d.value,right,top,7-d.value,7-right,7-top].map(pips).join('')}</span>`;
  node.setAttribute('aria-label', `${d.value}, ${colorNames[d.color]} кубик`);
  return node;
}
export class TablePresentation {
  constructor({ asset, signal, getState, getMyId, scene, onSlam, onAward }) {
    Object.assign(this, { asset, signal, getState, getMyId, scene, onSlam, onAward });
    this.seen = new Set(); this.timers = new Set();
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
          const owned = target.querySelector(`[data-owned-die="${d.id}"]`); this.fly(flyingDie(d), ev.sources[i], target, delay + i * 65, owned);
        });
        delay += takeTime(ev);
      } else {
        this.award(ev,target,delay);
        delay += awardTime(ev);
      }
    }
    if (events.some(ev=>ev.type==='card') && document.documentElement.dataset.motion !== 'reduced') {
      document.querySelector('.card-dock')?.classList.add('awaiting-award');
      this.later(()=>document.querySelector('.card-dock')?.classList.remove('awaiting-award'),delay);
    }
  }
  later(fn, delay) {
    const id=setTimeout(()=>{this.timers.delete(id);fn();},delay);this.timers.add(id);
  }
  award(ev,target,delay) {
    if (document.documentElement.dataset.motion === 'reduced') return;
    const owned = target.querySelector(`[data-owned-card="${ev.card.id}"]`)?.closest('.held-card');
    if (!owned) return;
    const clone=owned.cloneNode(true); clone.classList.remove('arriving'); clone.classList.add('award-card-stack');
    clone.querySelectorAll('.mini-die').forEach(el=>el.classList.add('arriving'));
    owned.classList.add('arriving');
    this.later(()=>{
      if (!target.isConnected) return;
      const image=owned.querySelector('img'), ratio=image.naturalHeight/image.naturalWidth || 1.4;
      const width=Math.min(198,innerHeight*.38), height=width*ratio;
      const x=Math.max(width/2+20,Math.min(innerWidth-width/2-20,innerWidth*.48));
      const y=Math.max(height/2+48,innerHeight*.39);
      const spot=document.createElement('div');spot.className='award-spotlight';this.layer.append(spot);
      const hero=document.createElement('div');hero.className='award-card';hero.style.cssText=`left:${x-width/2}px;top:${y-height/2}px;width:${width}px;`;
      hero.append(clone); this.layer.append(hero);
      const caption=document.createElement('div');caption.className='award-caption';
      const name=this.getState().players.find(p=>p.id===ev.playerId)?.name || '';
      caption.textContent=ev.playerId===this.getMyId()?'Карта ваша!':`${name} получает карту`;
      hero.append(caption);
      const source=ev.source || {left:x,top:y,width:width*.6,height:height*.6};
      const sx=source.left+source.width/2, sy=source.top+source.height/2, scale=source.width/width;
      hero.animate([
        {transform:`translate(${sx-x}px,${sy-y}px) scale(${scale}) rotate(5deg)`,filter:'drop-shadow(0 4px 4px #0003)'},
        {transform:'translate(0,-12px) scale(1.04) rotate(-3deg)',filter:'drop-shadow(0 30px 20px #0006)',offset:.78},
        {transform:'translate(0,0) scale(1) rotate(0deg)',filter:'drop-shadow(0 24px 20px #0005)'},
      ],{duration:650,easing:'cubic-bezier(.18,.75,.25,1)',fill:'forwards'});
      const dice=this.getState().players.find(p=>p.id===ev.playerId)?.dice.filter(d=>ev.diceIds?.includes(d.id)) || [];
      this.later(()=>{
        dice.forEach((d,i)=>{
          const slot=clone.querySelector(`[data-owned-die="${d.id}"]`), from=target.querySelector(`[data-owned-die="${d.id}"]`);
          if (!slot) return;
          const r=(from||target).getBoundingClientRect(), size=36, dest=slot.getBoundingClientRect();
          this.fly(flyingDie(d),{x:r.left+r.width/2,y:r.top+r.height/2,size},clone,i*110,slot,{duration:650,endScale:dest.width/size,award:true});
        });
      },1000);
      this.later(()=>this.onAward?.(),1650+Math.max(0,dice.length-1)*110);
      this.later(()=>{
        if (!owned.isConnected) {hero.remove();spot.remove();return;}
        const dest=owned.getBoundingClientRect(), tx=dest.left+dest.width/2,ty=dest.top+dest.height/2;
        caption.animate([{opacity:1},{opacity:0}],{duration:180,fill:'forwards'});
        spot.animate([{opacity:1},{opacity:0}],{duration:650,fill:'forwards'});
        hero.getAnimations().forEach(a=>a.cancel());
        const leave=hero.animate([
          {transform:'translate(0,0) scale(1) rotate(0deg)',opacity:1},
          {transform:`translate(${(tx-x)*.55}px,${(ty-y)*.55-35}px) scale(.8) rotate(-8deg)`,opacity:1,offset:.5},
          {transform:`translate(${tx-x}px,${ty-y}px) scale(${dest.width/width}) rotate(0deg)`,opacity:.8},
        ],{duration:800,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});
        leave.finished.then(()=>{hero.remove();spot.remove();owned.classList.remove('arriving');target.classList.remove('collection-arrived');void target.offsetWidth;target.classList.add('collection-arrived');}).catch(()=>{hero.remove();spot.remove();});
      },awardTime(ev)-800);
    },delay);
  }
  duration(events) {
    if (document.documentElement.dataset.motion === 'reduced') return events.length ? 120 : 0;
    return events.reduce((n,ev)=>n+(ev.type === 'take' ? takeTime(ev) : awardTime(ev)),0);
  }
  fly(node, source, target, delay, owned, options={}) {
    const dest = (owned || target).getBoundingClientRect(), end = { x: dest.left + dest.width / 2, y: dest.top + dest.height / 2 };
    source ||= { x: innerWidth / 2, y: innerHeight * .45, size: 50 };
    node.style.width = `${source.size || 50}px`; if (node.classList.contains('flying-die')) node.style.height = `${source.size || 50}px`;
    node.style.setProperty('--cube-half', `${(source.size || 50) / 2}px`);
    this.layer.append(node); owned?.classList.add('arriving');
    const reduce = document.documentElement.dataset.motion === 'reduced';
    const animation = node.animate([
      { transform: `translate(${source.x}px,${source.y}px) translate(-50%,-50%) scale(1) rotate(-8deg)`, opacity: 1 },
      { transform: `translate(${(source.x + end.x) / 2}px,${Math.min(source.y, end.y) - 60}px) translate(-50%,-50%) scale(1.15) rotate(10deg)`, opacity: 1, offset: .45 },
      { transform: `translate(${end.x}px,${end.y}px) translate(-50%,-50%) scale(${options.endScale ?? .35}) rotate(0deg)`, opacity: .15 },
    ], { duration: reduce ? 80 : options.duration || 850, delay: reduce ? 0 : delay, easing: 'cubic-bezier(.3,.1,.2,1)', fill: 'both' });
    animation.finished.then(() => {
      node.remove(); owned?.classList.remove('arriving'); target.classList.remove('collection-arrived'); void target.offsetWidth; target.classList.add('collection-arrived');
      if (!reduce && !options.award) {
        const burst = document.createElement('div'); burst.className = 'arrival-sparks'; burst.style.left = `${end.x}px`; burst.style.top = `${end.y}px`;
        burst.innerHTML = Array.from({length:7},(_,i)=>`<i style="--a:${i*51}deg;--distance:${25+i%3*10}px"></i>`).join('');
        this.layer.append(burst); setTimeout(()=>burst.remove(),700);
      }
    }).catch(() => node.remove());
  }
  reset() { this.closePicker(); for(const id of this.timers) clearTimeout(id);this.timers.clear();this.layer.getAnimations({subtree:true}).forEach(a=>a.cancel());this.layer.replaceChildren(); this.seen.clear(); }
}
