import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAPI,tickRoom} from '../server/api.js';
import {localDatabase} from '../server/local-db.js';
import {TIMING} from '../server/runtime.js';
function fixture(){
  const DB=localDatabase(':memory:');let now=Date.now();
  return {DB,get now(){return now;},advance(ms){now+=ms;},async call(path='',identity,action,requestId=crypto.randomUUID()){
    const method=action?'POST':'GET',body=action?.type?{action,requestId}:action;
    const req=new Request('https://game.example/api/rooms'+path,{method,headers:{'Content-Type':'application/json',...(identity?{Authorization:`Bearer ${identity.token}`,'X-Player-Id':identity.id}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const response=await handleAPI(req,{DB,now:()=>now});return {status:response.status,...await response.json()};
  }};
}
async function started(f){
  const host=await f.call('',null,{capacity:3,profile:{name:'Арина',avatar:1}}),path='/'+host.state.code;
  await f.call(path+'/action',host.identity,{type:'addBot'});await f.call(path+'/action',host.identity,{type:'addBot'});
  await f.call(path+'/action',host.identity,{type:'ready',value:true});
  await f.call(path+'/action',host.identity,{type:'start'});return {host,path};
}
test('only host can add bots; lobby bots are ready and a human can replace one with no bot credential exposed',async()=>{
  const f=fixture();try{
    const host=await f.call('',null,{capacity:3,profile:{name:'A',avatar:1}}),path='/'+host.state.code;
    assert.equal((await f.call(path+'/action',null,{type:'addBot'})).status,401);
    const added=await f.call(path+'/action',host.identity,{type:'addBot'});
    assert.equal(added.state.players[1].bot,true);assert.equal(added.state.players[1].ready,true);assert.equal(added.state.players[1].online,true);
    await f.call(path+'/action',host.identity,{type:'addBot'});
    const guest=await f.call(path+'/join',null,{profile:{name:'Друг',avatar:6}});
    assert.equal(guest.status,200);assert.equal(guest.state.players.length,3);assert.equal(guest.state.players.filter(p=>p.bot).length,1);
    assert.equal((await f.call(path+'/action',guest.identity,{type:'addBot'})).status,403);
    const snapshot=await f.call(path,host.identity);
    assert.equal('automatic' in snapshot.state.timing,false);assert.equal('tokens' in snapshot,false);
    assert.equal('bank' in snapshot.state,false);assert.equal('deck' in snapshot.state,false);
    assert.equal(JSON.stringify(snapshot).includes(guest.identity.token),false);
    const configured=await f.call(path+'/action',host.identity,{type:'configure',first:1});
    assert.equal(configured.state.players.find(p=>p.bot).ready,true);
  }finally{f.DB.close();}
});
test('server timeout hands over to a bot; resume restores control and duplicate requests do not reset the timer',async()=>{
  const f=fixture();try{
    const {host,path}=await started(f);
    // A heartbeat immediately before the deadline distinguishes AFK from a dropped connection.
    f.advance(TIMING.roll-1000);await f.call(path,host.identity);f.advance(1001);
    const expired=await f.call(path,host.identity);
    assert.equal(expired.state.players[0].controlReason,'afk');
    const late=await f.call(path+'/action',host.identity,{type:'roll'});
    assert.equal(late.status,409);assert.equal(late.state.players[0].control,'bot');
    const id=crypto.randomUUID(),resumed=await f.call(path+'/action',host.identity,{type:'resume'},id);
    assert.equal(resumed.state.players[0].control,'human');const deadline=resumed.state.timing.deadline;
    f.advance(1000);const duplicate=await f.call(path+'/action',host.identity,{type:'resume'},id);
    assert.equal(duplicate.state.timing.deadline,deadline);
    const rolled=await f.call(path+'/action',host.identity,{type:'roll'});
    assert.equal(rolled.state.rollId,1);assert.equal(rolled.state.table.length,6);
    assert.equal(rolled.state.timing.deadline-rolled.state.timing.opensAt,TIMING.bidding);
  }finally{f.DB.close();}
});
test('concurrent maintenance commits an automatic roll once; reconnect uses original identity and preserves the hand',async()=>{
  const f=fixture();try{
    const {host,path}=await started(f),code=host.state.code;
    f.advance(TIMING.disconnect);await tickRoom(f.DB,code,f.now);
    f.advance(TIMING.think);await Promise.all(Array.from({length:6},()=>tickRoom(f.DB,code,f.now)));
    const read=await f.call(path,host.identity);
    assert.equal(read.state.rollId,1);assert.equal(read.state.table.length,6);assert.equal(read.state.players[0].id,host.identity.id);
    assert.equal(read.state.players[0].control,'human');assert.equal(read.state.players[0].controlReason,null);
    assert.equal((await f.call(path,{id:host.identity.id,token:'wrong'})).status,401);
    const requestId=crypto.randomUUID();await f.call(path+'/action',host.identity,{type:'bid',value:1},requestId);
    const again=await f.call(path+'/action',host.identity,{type:'bid',value:1},requestId);
    assert.equal(again.state.submitted.filter(id=>id===host.identity.id).length,1);
  }finally{f.DB.close();}
});
test('an absent lobby host transfers room controls to a connected human and returns as a guest',async()=>{
  const f=fixture();try{
    const host=await f.call('',null,{capacity:3,profile:{name:'A',avatar:1}}),path='/'+host.state.code;
    const guest=await f.call(path+'/join',null,{profile:{name:'B',avatar:2}});
    f.advance(TIMING.disconnect+1);
    const view=await f.call(path,guest.identity);assert.equal(view.state.hostId,guest.identity.id);
    assert.equal((await f.call(path,host.identity)).state.hostId,guest.identity.id);
    assert.equal((await f.call(path+'/action',guest.identity,{type:'addBot'})).status,200);
  }finally{f.DB.close();}
});
