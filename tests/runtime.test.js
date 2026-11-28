import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,publicView,validClaim} from '../src/engine.js';
import {TIMING,addBot,applyGameAction,advanceRuntime,syncRuntime,resumePlayer,playerControl,phaseKey} from '../server/runtime.js';
import {chooseDice,botAction} from '../server/bots.js';
import {timeRemaining,turnLabel} from '../src/session-ui.js';

const START=1_000_000;
function room(capacity=3){
  const data={state:createRoom({code:'ABC234',capacity,player:{id:'host',name:'Арина',avatar:1}}),seen:{host:START},tokens:{},requests:[]};
  for(let i=1;i<capacity;i++)addBot(data,START);
  applyGameAction(data,'host',{type:'ready',value:true},START);
  applyGameAction(data,'host',{type:'start'},START);
  return data;
}
function conserve(s){
  const dice=[...s.bank,...s.table,...s.players.flatMap(p=>p.dice)];
  assert.equal(dice.length,36);assert.equal(new Set(dice.map(d=>d.id)).size,36);
  const cards=[s.active,...s.deck,...s.players.flatMap(p=>p.cards)].filter(Boolean);
  assert.equal(cards.length,10);assert.equal(new Set(cards.map(c=>c.id)).size,10);
}
test('a live but idle player times out, can resume, and cannot extend a deadline by repeated resume',()=>{
  const data=room(),deadline=data.runtime.deadline;
  data.seen.host=deadline-1;advanceRuntime(data,deadline-1);
  assert.equal(playerControl(data,data.state.players[0],deadline-1).control,'human');
  data.seen.host=deadline;advanceRuntime(data,deadline);
  assert.equal(data.state.phase,'roll');assert.equal(data.runtime.afk.includes('host'),true);
  assert.equal(data.runtime.automatic.id,'host');
  assert.equal(resumePlayer(data,'host',deadline+100),true);
  assert.equal(data.runtime.automatic,null);assert.equal(data.runtime.deadline,deadline+100+TIMING.roll);
  const reset=data.runtime.deadline;
  assert.equal(resumePlayer(data,'host',deadline+1000),false);assert.equal(data.runtime.deadline,reset);
  advanceRuntime(data,deadline+TIMING.think+500);assert.equal(data.state.phase,'roll');
});
test('a disconnected player gets a temporary bot; heartbeat restores the same seat and cancels its pending action',()=>{
  const data=room();advanceRuntime(data,START+TIMING.disconnect);
  assert.equal(data.runtime.automatic.id,'host');
  assert.equal(playerControl(data,data.state.players[0],START+TIMING.disconnect).controlReason,'disconnected');
  const id=data.state.players[0].id;
  data.seen.host=START+TIMING.disconnect+100;syncRuntime(data,START+TIMING.disconnect+100);
  assert.equal(data.state.players[0].id,id);assert.equal(data.runtime.automatic,null);
  assert.equal(data.runtime.afk.includes(id),false);
  assert.equal(playerControl(data,data.state.players[0],START+TIMING.disconnect+100).control,'human');
});
test('bidding has one shared deadline; a heartbeat, another bid or emotion does not restart it',()=>{
  const data=room();applyGameAction(data,'host',{type:'roll'},START);
  assert.equal(data.runtime.opensAt,START+3500);
  const deadline=data.runtime.deadline;
  const bot=data.state.players[1];applyGameAction(data,bot.id,{type:'bid',value:0},START+6000);
  data.seen.host=START+7000;syncRuntime(data,START+7000);
  assert.equal(data.runtime.deadline,deadline);assert.equal(data.runtime.afk.includes('host'),false);
  const other=data.state.players[2];applyGameAction(data,other.id,{type:'bid',value:0},START+8000);
  data.seen.host=deadline;advanceRuntime(data,deadline);
  assert.equal(data.runtime.afk.includes('host'),true);
});
test('bots show a shared selection before taking dice; returning human keeps their dice and cancels the selection',()=>{
  const data=room();applyGameAction(data,'host',{type:'roll'},START);
  for(const p of data.state.players)applyGameAction(data,p.id,{type:'bid',value:p.id==='host'?data.state.table[0].value:0},START);
  const deadline=data.runtime.deadline;data.seen.host=deadline;advanceRuntime(data,deadline);
  advanceRuntime(data,deadline+TIMING.think);
  assert.ok(data.social.selection.ids.length);assert.equal(data.state.players[0].dice.length,0);
  resumePlayer(data,'host',deadline+TIMING.think+100);
  assert.equal(data.social.selection,undefined);assert.equal(data.runtime.automatic,null);
  assert.equal(data.state.players[0].dice.length,0);
});
test('claim clocks identify consecutive cards for the same player separately',()=>{
  const data=room(),s=data.state;s.phase='claim';s.pending={playerId:'host',cardId:'2blue'};
  syncRuntime(data,START);const key=phaseKey(s),deadline=data.runtime.deadline;
  s.pending.cardId='3blue';syncRuntime(data,START+5000);
  assert.notEqual(phaseKey(s),key);assert.equal(data.runtime.deadline,deadline+5000);
});
test('bot chooses exact sums and the highest unlocked dice for a mandatory card',()=>{
  const dice=[{id:'a',value:6,color:'blue',card:null},{id:'b',value:2,color:'blue',card:null},{id:'c',value:4,color:'blue',card:null},{id:'locked',value:6,color:'blue',card:'3blue'}];
  assert.deepEqual(chooseDice(dice.slice(0,3),8),['a','b']);assert.equal(chooseDice(dice,1),null);
  const data=room();data.state.phase='claim';data.state.active={id:'2blue',color:'blue',count:2};data.state.pending={playerId:'host',cardId:'2blue'};data.state.players[0].dice=dice;
  const view=publicView(data.state,'host'),action=botAction(view,'host');
  assert.deepEqual(action,{type:'claim',ids:['a','c']});
  assert.equal(validClaim(dice.filter(d=>action.ids.includes(d.id)),view.active,view.wildRule),true);
  assert.equal('bank' in view,false);assert.equal('deck' in view,false);
});
test('server bots finish complete three- and four-player games after everyone disconnects without losing dice or cards',()=>{
  for(const capacity of [3,4])for(let game=0;game<20;game++){
    const data=room(capacity);let now=START,steps=0;
    while(data.state.phase!=='finished'&&steps++<5000){now+=500;advanceRuntime(data,now);conserve(data.state);}
    assert.equal(data.state.phase,'finished',`capacity=${capacity}, phase=${data.state.phase}`);
    assert.equal(data.state.round,capacity===3?6:4);
    assert.equal(data.state.submitted.length,capacity);
    assert.ok(data.state.players.reduce((n,p)=>n+p.dice.length,0)>0);
  }
});
test('mobile labels include the actor; countdown uses elapsed monotonic time and includes animation grace',()=>{
  const data=room(),s=data.state;assert.equal(turnLabel(s),'Бросает Арина');
  s.phase='collect';s.order=['host'];assert.equal(turnLabel(s),'Ходит Арина');
  const clock={receivedAt:100,serverNow:2000,startedAt:5500,opensAt:5500,deadline:50500};
  assert.deepEqual(timeRemaining(clock,100),{seconds:45,waiting:true,progress:1});
  assert.equal(timeRemaining(clock,14600).seconds,34);assert.equal(timeRemaining(clock,100000).seconds,0);
});
