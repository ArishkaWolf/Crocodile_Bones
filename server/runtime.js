import { reduceGame, publicView, randomInt, AVATAR_COUNT } from '../src/engine.js';
import { botAction } from './bots.js';
import { applySignal } from './social.js';

export const TIMING=Object.freeze({online:15000,disconnect:25000,roll:25000,bidding:45000,collect:35000,claim:35000,roundEnd:10000,think:1200,selection:750});
export const phaseKey=s=>`${s.phase}:${s.round}:${s.rollId}:${s.turn}:${s.pending?.playerId||''}:${s.pending?.cardId||''}`;
const runtime=data=>data.runtime||=( {key:null,startedAt:0,opensAt:0,deadline:null,afk:[],controllers:{},automatic:null} );
export function actors(s){
  if(s.phase==='bidding')return s.players.filter(p=>!s.submitted.includes(p.id)).map(p=>p.id);
  if(s.phase==='collect')return [s.order[s.turn]];
  if(s.phase==='claim')return [s.pending?.playerId];
  if(['roll','roundEnd'].includes(s.phase))return [s.players[s.first].id];
  return [];
}
export function playerControl(data,p,now=Date.now()){
  const age=now-(data.seen[p.id]||0),afk=data.runtime?.afk.includes(p.id);
  return {online:!!p.bot||age<TIMING.online,control:p.bot||afk||age>=TIMING.disconnect?'bot':'human',controlReason:p.bot?'bot':afk?'afk':age>=TIMING.disconnect?'disconnected':null};
}
function clearSelection(data,id){
  if(data.social?.selection?.playerId===id){delete data.social.selection;data.social.revision++;}
}
export function syncRuntime(data,now=Date.now()){
  const rt=runtime(data),s=data.state;let changed=false;
  if(['lobby','finished'].includes(s.phase)&&now-(data.seen[s.hostId]||0)>=TIMING.disconnect){
    const host=s.players.find(p=>!p.bot&&now-(data.seen[p.id]||0)<TIMING.online);
    if(host&&host.id!==s.hostId){s.hostId=host.id;s.version++;changed=true;}
  }
  for(const p of s.players){
    const status=playerControl(data,p,now),old=rt.controllers[p.id];p.online=status.online;
    if(p.bot&&s.phase==='lobby'&&!p.ready){p.ready=true;changed=true;}
    if(old!==status.controlReason){
      rt.controllers[p.id]=status.controlReason;changed=true;
      if(old==='disconnected'&&status.control==='human'){
        clearSelection(data,p.id);rt.automatic=null;
        if(actors(s).includes(p.id)&&rt.deadline!=null&&now>=rt.deadline){rt.startedAt=now;rt.opensAt=now;rt.deadline=now+TIMING[s.phase];}
      }
    }
  }
  const key=phaseKey(s);
  if(rt.key!==key){rt.key=key;rt.startedAt=now;rt.opensAt=now;rt.deadline=TIMING[s.phase]?now+TIMING[s.phase]:null;rt.automatic=null;changed=true;}
  return changed;
}
export function applyGameAction(data,id,action,now=Date.now(),rng=randomInt){
  const last=data.state.log.at(-1)?.id||0;
  data.state=reduceGame(data.state,id,action,rng);
  if(action.type==='rematch'){
    data.runtime=null;
    data.social={revision:(data.social?.revision||0)+1,reactions:[],slams:{}};
  }
  const oldKey=data.runtime?.key;syncRuntime(data,now);const rt=runtime(data);
  const events=data.state.log.filter(ev=>ev.id>last);
  let grace=action.type==='roll'?Math.max(3500,3300+Math.max(0,data.state.table.length-1)*24):0;
  if(events.some(ev=>ev.type==='reveal'))grace+=900+data.state.capacity*420;
  for(const ev of events){
    if(ev.type==='take')grace+=1150+Math.max(0,ev.dice.length-1)*65;
    if(ev.type==='card')grace+=3400+Math.max(0,ev.diceIds.length-1)*110;
  }
  if(oldKey!==rt.key&&rt.deadline!=null){rt.opensAt=now+grace;rt.startedAt=rt.opensAt;rt.deadline=rt.opensAt+TIMING[data.state.phase];}
  return data.state;
}
export function resumePlayer(data,id,now=Date.now()){
  const rt=runtime(data),p=data.state.players.find(p=>p.id===id);
  if(!p||p.bot)throw Error('Это место принадлежит боту.');
  if(!rt.afk.includes(id))return false;
  rt.afk=rt.afk.filter(key=>key!==id);rt.automatic=null;clearSelection(data,id);data.seen[id]=now;
  syncRuntime(data,now);
  if(actors(data.state).includes(id)&&rt.deadline!=null){rt.startedAt=now;rt.opensAt=now;rt.deadline=now+TIMING[data.state.phase];}
  return true;
}
export function addBot(data,now=Date.now()){
  if(data.state.phase!=='lobby')throw Error('Ботов можно добавлять до начала партии.');
  const used=new Set(data.state.players.map(p=>p.name));let n=1;while(used.has(`Крокобот ${n}`))n++;
  const id=`bot-${crypto.randomUUID()}`,taken=new Set(data.state.players.map(p=>p.avatar));
  const avatar=Array.from({length:AVATAR_COUNT},(_,i)=>i+1).find(n=>!taken.has(n))||1;
  data.state=reduceGame(data.state,data.state.hostId,{type:'join',player:{id,name:`Крокобот ${n}`,avatar}});
  data.state.players.find(p=>p.id===id).bot=true;
  syncRuntime(data,now);return id;
}
export function advanceRuntime(data,now=Date.now(),rng=randomInt){
  let changed=syncRuntime(data,now);const rt=runtime(data),s=data.state,waiting=actors(s);
  if(!waiting.length){if(rt.automatic){rt.automatic=null;changed=true;}return changed;}
  if(now>=rt.deadline)for(const id of waiting){
    const p=s.players.find(p=>p.id===id);
    if(playerControl(data,p,now).control==='human'&&!rt.afk.includes(id)){rt.afk.push(id);changed=true;}
  }
  if(changed)syncRuntime(data,now);
  const automatic=waiting.filter(id=>playerControl(data,s.players.find(p=>p.id===id),now).control==='bot');
  let plan=rt.automatic;
  if(plan&&(plan.key!==rt.key||!automatic.includes(plan.id))){clearSelection(data,plan.id);rt.automatic=null;plan=null;changed=true;}
  if(!plan&&automatic.length){
    const id=automatic[0],action=botAction(publicView(s,id),id,rng);
    if(action){plan=rt.automatic={id,key:rt.key,action,dueAt:Math.max(now,rt.opensAt)+TIMING.think};changed=true;}
  }
  if(!plan||now<plan.dueAt)return changed;
  if(plan.action.type==='take'&&!plan.selected){
    applySignal(data,plan.id,{type:'selection',ids:plan.action.ids,rollId:s.rollId,turn:s.turn},now);
    plan.selected=true;plan.dueAt=now+TIMING.selection;return true;
  }
  rt.automatic=null;applyGameAction(data,plan.id,plan.action,now,rng);return true;
}
export function runtimeView(data,now=Date.now()){
  const rt=runtime(data);return {key:rt.key,serverNow:now,opensAt:rt.opensAt,deadline:rt.deadline,startedAt:rt.startedAt};
}
