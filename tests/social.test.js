import test from 'node:test';
import assert from 'node:assert/strict';
import { applySignal, socialView } from '../server/social.js';
import { createRoom, reduceGame, publicView } from '../src/engine.js';

function game() {
  let state=createRoom({code:'ABCDEF',capacity:3,player:{id:'a',name:'A',avatar:1}});
  for(const id of ['b','c']) state=reduceGame(state,'a',{type:'join',player:{id,name:id,avatar:2}});
  for(const p of state.players) state=reduceGame(state,p.id,{type:'ready',value:true});
  state=reduceGame(state,'a',{type:'start'},()=>0); state=reduceGame(state,'a',{type:'roll'},()=>0);
  state=reduceGame(state,'a',{type:'bid',value:1}); state=reduceGame(state,'b',{type:'bid',value:999}); state=reduceGame(state,'c',{type:'bid',value:999});
  return {state};
}

test('shared selection belongs to the active turn, never changes dice or bids and clears with the turn',()=>{
  const data=game(), before=structuredClone(data.state), ids=[data.state.table[0].id];
  const signal={type:'selection',ids,rollId:data.state.rollId,turn:data.state.turn};
  assert.throws(()=>applySignal(data,'b',signal),/свой ход/);
  assert.throws(()=>applySignal(data,'a',{...signal,ids:['missing']}),/недоступны/);
  assert.throws(()=>applySignal(data,'a',{...signal,rollId:0}),/свой ход/);
  applySignal(data,'a',signal,1000);
  assert.deepEqual(socialView(data,90000).selection,{playerId:'a',ids});
  assert.deepEqual(data.state,before);
  applySignal(data,'a',{...signal,ids:[]},2000);
  assert.deepEqual(socialView(data,2000).selection.ids,[]);
  applySignal(data,'a',signal,3000);
  data.state=reduceGame(data.state,'a',{type:'take',ids});
  assert.equal(socialView(data,3000).selection,null);
  const take=data.state.log.find(ev=>ev.type==='take'); assert.equal(take.playerId,'a'); assert.equal(take.dice[0].id,ids[0]);
});

test('stickers are bounded, temporary and rate limited; a burned bid permits one table slam per round',()=>{
  const data=game();
  assert.throws(()=>applySignal(data,'a',{type:'reaction',sticker:26}),/стикер/);
  assert.throws(()=>applySignal(data,'unknown',{type:'reaction',sticker:1}),/комнате/);
  applySignal(data,'a',{type:'reaction',sticker:25},1000);
  assert.throws(()=>applySignal(data,'a',{type:'reaction',sticker:2},1500),/секунду/);
  assert.equal(socialView(data,2000).reactions[0].sticker,25);
  assert.equal(socialView(data,6000).reactions.length,0);
  assert.throws(()=>applySignal(data,'a',{type:'slam'},6000),/сгорела/);
  data.state=reduceGame(data.state,'a',{type:'take',ids:[data.state.table[0].id]});
  applySignal(data,'b',{type:'slam'},6000);
  assert.equal(socialView(data,6000).reactions[0].kind,'slam');
  assert.deepEqual(socialView(data,6000).slammed,['b']);
  assert.throws(()=>applySignal(data,'b',{type:'slam'},7000),/сгорела/);
  const view=publicView(data.state,'a');
  assert.equal(view.players.some(p=>Object.hasOwn(p,'score')),false);
});
