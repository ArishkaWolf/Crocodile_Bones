export function timeRemaining(clock,now=performance.now()){
  if(!clock?.deadline)return null;
  const serverNow=clock.serverNow+Math.max(0,now-clock.receivedAt);
  return {seconds:Math.max(0,Math.ceil((clock.deadline-Math.max(serverNow,clock.opensAt))/1000)),waiting:serverNow<clock.opensAt,progress:Math.max(0,Math.min(1,(clock.deadline-Math.max(serverNow,clock.opensAt))/(clock.deadline-clock.startedAt)))};
}
export function turnLabel(state,{rolling=false,revealing=false}={}){
  const first=state.players[state.first];
  if(rolling||state.phase==='roll')return `Бросает ${first.name}`;
  if(revealing)return 'Открываем ставки';
  if(state.phase==='collect')return `Ходит ${state.players.find(p=>p.id===state.order[state.turn])?.name||''}`;
  if(state.phase==='claim')return `Карту получает ${state.players.find(p=>p.id===state.pending?.playerId)?.name||''}`;
  if(state.phase==='bidding')return 'Тайные ставки';
  if(state.phase==='roundEnd')return 'Раунд завершён';
  return 'Итоги партии';
}
