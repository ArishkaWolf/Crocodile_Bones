import test from 'node:test';
import assert from 'node:assert/strict';
import {rankResults,ResultsSequence} from '../src/results.js';
const p=(id,values)=>({id,name:id,avatar:1,cards:[],dice:values.map(([value,card])=>({value,card}))});
test('results keep first place left and reveal from lowest score, counting card dice twice',()=>{
  const ranking=rankResults([p('a',[[6,null]]),p('b',[[4,'2blue']]),p('c',[[2,null]])]);
  assert.deepEqual(ranking.map(x=>[x.player.id,x.points,x.place,x.group]),[['b',8,1,2],['a',6,2,1],['c',2,3,0]]);
});
test('equal scores share both place and reveal; the sequence survives rerenders and cancels on rematch',()=>{
  const state={code:'ABCDEF',rollId:4,log:[{id:12}],players:[p('a',[[5,null]]),p('b',[[5,null]]),p('c',[[1,null]])]};
  let now=0,scheduled=0,canceled=0;
  const seq=new ResultsSequence({now:()=>now,onChange(){},onReveal(){},schedule(){return ++scheduled},cancel(){canceled++}});
  seq.ensure(state,true);assert.equal(scheduled,6);assert.equal(seq.frame().entries.some(p=>p.front),false);
  now=950;assert.deepEqual(seq.frame().entries.filter(p=>p.front).map(p=>p.player.id),['c']);
  seq.ensure(state,true);assert.equal(scheduled,6);
  now=2100;assert.deepEqual(seq.frame().winners.map(p=>p.place),[1,1]);assert.equal(seq.frame().winners.every(p=>p.front),true);assert.equal(seq.frame().complete,false);
  seq.finish();assert.equal(seq.frame().complete,true);assert.equal(canceled,6);
  seq.reset();seq.ensure(state,true);assert.equal(scheduled,12);
});
