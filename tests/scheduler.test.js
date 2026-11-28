import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createGameServer} from '../server/node.js';
import {localDatabase} from '../server/local-db.js';

test('Node scheduler rolls for a bot without any requests or polling from browsers',async()=>{
  const DB=localDatabase(':memory:'),server=createGameServer({database:DB});
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}/api/rooms`;
    const host=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({capacity:3,profile:{name:'A',avatar:1}})}).then(r=>r.json());
    const code=host.state.code;
    const act=action=>fetch(`${base}/${code}/action`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${host.identity.token}`,'X-Player-Id':host.identity.id},body:JSON.stringify({action,requestId:crypto.randomUUID()})}).then(r=>r.json());
    await act({type:'addBot'});await act({type:'addBot'});await act({type:'configure',first:1});await act({type:'ready',value:true});
    const started=await act({type:'start'});assert.equal(started.state.phase,'roll');
    let state,until=Date.now()+5000;
    do{await delay(80);state=JSON.parse((await DB.prepare('SELECT data FROM rooms WHERE code = ?').bind(code).first()).data).state;}while(state.phase==='roll'&&Date.now()<until);
    assert.equal(state.phase,'bidding');assert.equal(state.rollId,1);assert.equal(state.table.length,6);
  }finally{const closed=once(server,'close');server.close();server.closeAllConnections();await closed;DB.close();}
});
