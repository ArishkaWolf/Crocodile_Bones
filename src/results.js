import { score } from './engine.js';

// Best place is on the left; equal scores share a reveal and a place.
export function rankResults(players) {
  const sorted = players.map(player => ({player,points:score(player)})).sort((a,b)=>b.points-a.points);
  const ascending = [...new Set(sorted.map(p=>p.points))].sort((a,b)=>a-b);
  return sorted.map(item=>({...item,place:sorted.findIndex(p=>p.points===item.points)+1,group:ascending.indexOf(item.points)}));
}

export class ResultsSequence {
  constructor({onChange,onReveal,now=()=>performance.now(),schedule=(fn,delay)=>setTimeout(fn,delay),cancel=id=>clearTimeout(id)}) {
    Object.assign(this,{onChange,onReveal,now,schedule,cancel});this.timers=[];this.key=null;
  }
  ensure(state,motion) {
    const key=`${state.code}:${state.rollId}:${state.log.at(-1)?.id}`;
    if(this.key===key) {if(!motion)this.finish();return;}
    this.reset();this.key=key;this.ranking=rankResults(state.players);this.started=this.now();this.motion=motion;
    this.groups=1+Math.max(...this.ranking.map(p=>p.group));
    if(!motion)return;
    for(let group=0;group<this.groups;group++) {
      const at=500+group*1150;
      for(const offset of [0,420,900]) this.timers.push(this.schedule(()=>{
        if(offset===420)this.onReveal(group===this.groups-1);
        this.onChange();
      },at+offset+16));
    }
  }
  frame() {
    const age=this.now()-this.started;
    const entries=this.ranking.map(item=>{
      const elapsed=age-(500+item.group*1150);
      return {...item,elapsed,front:!this.motion||elapsed>=420,open:!this.motion||elapsed>=900,flipping:this.motion&&elapsed>=0&&elapsed<900};
    });
    return {entries,complete:entries.every(p=>p.open),winners:entries.filter(p=>p.place===1)};
  }
  finish() {this.timers.forEach(this.cancel);this.timers=[];this.motion=false;}
  reset() {this.timers.forEach(this.cancel);this.timers=[];this.key=null;}
}
