import { COLORS, randomInt, validClaim } from '../src/engine.js';

// This module receives publicView(state, botId), never the bank, deck or secret bids.
function preferences(view, player) {
  const free=player.dice.filter(d=>!d.card), card=view.active;
  return Object.fromEntries(COLORS.map(color=>{
    const required=!card?0:card.color==='wild'?(view.wildRule.counts?.[color]||0):card.color===color?card.count:0;
    return [color,Math.max(0,required-free.filter(d=>d.color===color).length)];
  }));
}
export function chooseDice(dice,target,weights={}) {
  if(!Number.isSafeInteger(target)||target<=0||target>216)return null;
  const best=Array(target+1).fill(null);best[0]={ids:[],weight:0};
  for(const die of dice)for(let sum=target;sum>=die.value;sum--){
    const previous=best[sum-die.value];if(!previous)continue;
    const weight=previous.weight+die.value+(weights[die.color]||0)*3+.1;
    if(!best[sum]||weight>best[sum].weight)best[sum]={ids:[...previous.ids,die.id],weight};
  }
  return best[target]?.ids||null;
}
function chooseClaim(view,player) {
  const free=player.dice.filter(d=>!d.card).sort((a,b)=>b.value-a.value),card=view.active,rule=view.wildRule;
  let dice;
  if(card.color!=='wild')dice=free.filter(d=>d.color===card.color).slice(0,card.count);
  else if(rule.kind==='mixed')dice=COLORS.flatMap(color=>free.filter(d=>d.color===color).slice(0,rule.counts[color]));
  else if(rule.kind==='any')dice=free.slice(0,rule.count);
  else dice=COLORS.map(color=>free.filter(d=>d.color===color).slice(0,rule.count)).filter(ds=>ds.length===rule.count).sort((a,b)=>b.reduce((n,d)=>n+d.value,0)-a.reduce((n,d)=>n+d.value,0))[0]||[];
  return validClaim(dice,card,rule)?dice.map(d=>d.id):null;
}
export function botAction(view,id,rng=randomInt) {
  const player=view.players.find(p=>p.id===id);if(!player)return null;
  const first=view.players[view.first]?.id;
  if(view.phase==='roll'&&first===id)return {type:'roll'};
  if(view.phase==='roundEnd'&&first===id)return {type:'next'};
  if(view.phase==='bidding'&&!view.submitted.includes(id)){
    const total=view.table.reduce((n,d)=>n+d.value,0),weights=preferences(view,player);
    const desired=Math.max(1,Math.round(total/view.capacity)+(rng(7)-3));
    for(let distance=0;distance<=total;distance++)for(const target of new Set([desired-distance,desired+distance]))
      if(chooseDice(view.table,target,weights))return {type:'bid',value:target};
    return {type:'bid',value:0};
  }
  if(view.phase==='collect'&&view.order[view.turn]===id){
    const ids=chooseDice(view.table,view.bids[id],preferences(view,player));return ids?{type:'take',ids}:null;
  }
  if(view.phase==='claim'&&view.pending?.playerId===id){
    const ids=chooseClaim(view,player);return ids?{type:'claim',ids}:null;
  }
  return null;
}
