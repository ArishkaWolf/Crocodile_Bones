import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomConnection} from '../src/connection.js';
test('an uncertain action retries the same request ID and refreshes its server clock without replaying unchanged state',async()=>{
  const saved={window:globalThis.window,document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
  globalThis.window=new EventTarget();globalThis.document=new EventTarget();globalThis.document.hidden=false;
  globalThis.sessionStorage={setItem(){},removeItem(){}};
  const bodies=[];let delivered=0,clocks=0;
  const state={version:1,phase:'roll',hostId:'a',players:[{id:'a',online:true,ready:true,controlReason:null}],timing:{key:'roll:1',deadline:30000,serverNow:1000,opensAt:1000,startedAt:1000},social:{revision:0}};
  globalThis.fetch=async(url,options)=>{bodies.push(JSON.parse(options.body));if(bodies.length===1)throw Error('response lost');return new Response(JSON.stringify({state}));};
  const connection=new RoomConnection({onStatus(){},onState(){delivered++;},onTiming(){clocks++;}});
  connection.identity={id:'a',token:'test-token'};connection.code='ABC234';
  try{
    await connection.action({type:'roll'});
    assert.equal(bodies.length,2);assert.deepEqual(bodies[0],bodies[1]);assert.ok(bodies[0].requestId);
    assert.equal(delivered,1);assert.equal(connection.clock.serverNow,1000);
    connection.receive({state:{...state,timing:{...state.timing,serverNow:1500}}});
    assert.equal(clocks,2);assert.equal(delivered,1);
    connection.receive({state:{...state,roomRevision:2,players:[{...state.players[0],controlReason:'afk'}]}});
    assert.equal(delivered,2);
    connection.receive({state:{...state,roomRevision:1}});
    assert.equal(connection.state.players[0].controlReason,'afk');assert.equal(delivered,2);
  }finally{connection.close(false);Object.assign(globalThis,saved);}
});
