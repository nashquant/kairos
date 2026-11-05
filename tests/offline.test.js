// Offline-queue test for Kairos. Runs the real page script in jsdom with a mock db.
const fs=require('fs'); const {JSDOM}=require('jsdom');
let html=fs.readFileSync(require('path').join(__dirname,'..','app.html'),'utf8')
  .replace('WRITE_TIMEOUT=10000','WRITE_TIMEOUT=300').replace('RETRY_MS=15000','RETRY_MS=500')
  .replace(/<script src=[^>]+><\/script>/,'').replace(/<link[^>]+>/g,'');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0; const ok=(c,m)=>{if(c){pass++;console.log('  ok  ',m)}else{fail++;console.log('  FAIL',m)}};

function makeDb(store){
  const ls={coll:[],doc:[]}; const st={mode:'online',calls:0};
  const snapColl=p=>({docs:[...store.entries()].filter(([k])=>k.split('/')[0]===p).map(([k,v])=>({id:k.split('/')[1],exists:true,data:()=>JSON.parse(JSON.stringify(v))})),metadata:{fromCache:false,hasPendingWrites:false},size:0,empty:false});
  const snapDoc=p=>({id:p.split('/')[1],exists:store.has(p),data:()=>store.has(p)?JSON.parse(JSON.stringify(store.get(p))):undefined,metadata:{fromCache:false}});
  const emit=()=>{for(const l of ls.coll)if(!l.dead)l.next(snapColl(l.p));for(const l of ls.doc)if(!l.dead)l.next(snapDoc(l.p))};
  const write=(p,v)=>{st.calls++;
    if(st.mode==='reject')return Promise.reject({code:'unavailable',message:'offline'});
    if(st.mode==='hang')return new Promise(()=>{});
    if(v===null)store.delete(p);else store.set(p,v); setTimeout(emit,5); return Promise.resolve();};
  const db={
    collection:p=>({onSnapshot(next,err){const l={p,next,err};ls.coll.push(l);setTimeout(()=>!l.dead&&next(snapColl(p)),5);return()=>{l.dead=true}}}),
    doc:p=>({set:v=>write(p,v),delete:()=>write(p,null),onSnapshot(next,err){const l={p,next,err};ls.doc.push(l);setTimeout(()=>!l.dead&&next(snapDoc(p)),5);return()=>{l.dead=true}}}),
  };
  const killAll=()=>{for(const l of [...ls.coll,...ls.doc])if(!l.dead){l.dead=true;l.err({code:'unavailable',message:'host gone'})}};
  return {db,st,emit,killAll,live:()=>[...ls.coll,...ls.doc].filter(l=>!l.dead).length};
}
async function page(store,storage){
  const m=makeDb(store);
  const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://example.test/',pretendToBeVisual:true,
    beforeParse(w){w.scrollTo=()=>{};w.claude={use:async n=>n==='db'?m.db:null}; if(storage)for(const[k,v]of Object.entries(storage))w.localStorage.setItem(k,v)}});
  await sleep(120);
  const w=dom.window; const S=()=>w.eval('S'); const ob=()=>JSON.parse(w.localStorage.getItem('kairos.outbox')||'[]');
  const click=sel=>{const el=w.document.querySelector(sel);if(!el)throw new Error('no '+sel);el.click()};
  const text=()=>w.document.getElementById('app').textContent;
  return {m,w,S,ob,click,text};
}
(async()=>{
  const store=new Map([['decks/d1',{name:'Teste::A',created:1}],
    ['cards/c1',{deck:'d1',front:'Q1',back:'A1',tags:[],created:1}],['cards/c2',{deck:'d1',front:'Q2',back:'A2',tags:[],created:2}],
    ['cards/c3',{deck:'d1',front:'Q3',back:'A3',tags:[],created:3}],['cards/c4',{deck:'d1',front:'Q4',back:'A4',tags:[],created:4}]]);
  console.log('1. online answer');
  let P=await page(store);
  ok(P.text().includes('Kairos')&&P.S().cards.size===4,'home loads with 4 cards');
  P.click('[data-study-all]'); await sleep(50); P.click('[data-reveal]'); await sleep(50); P.click('[data-grade="3"]'); await sleep(100);
  ok(store.has('reviews/c1'),'review c1 reached the server');
  ok(P.ob().length===0,'outbox empty when online');
  ok(!P.w.document.querySelector('.sync'),'no sync banner when online');

  console.log('2. offline (writes rejected)');
  P.m.st.mode='reject';
  P.click('[data-reveal]'); await sleep(50); P.click('[data-grade="3"]'); await sleep(100);
  ok(!store.has('reviews/c2'),'c2 not on server');
  ok(P.ob().some(o=>o.p==='reviews/c2')&&P.ob().some(o=>o.p.startsWith('log/')),'c2 review and log are in localStorage outbox');
  ok(P.S().revs.has('c2'),'c2 progress shown locally');
  ok((P.w.document.querySelector('.sync')||{}).textContent?.includes('1 resposta'),'banner shows 1 pending answer');
  P.m.emit(); await sleep(50);
  ok(P.S().revs.has('c2'),'server snapshot without c2 does not revert it (overlay)');
  ok(P.S().log.length===2,'today log keeps both answers (overlay)');
  P.m.killAll(); await sleep(50);
  console.log('    err=',P.S().err,'|',P.text().slice(0,200).replace(/\s+/g,' '));ok(!P.text().includes('Recarregue'),'listener loss does not block the app');
  ok(P.w.document.querySelector('[data-reveal]')||P.w.document.querySelector('.grade'),'study screen still usable');

  console.log('3. back online');
  P.m.st.mode='online'; await sleep(900);
  ok(P.m.live()>0,'listeners re-opened after loss');
  ok(store.has('reviews/c2'),'c2 synced to server');
  ok((store.get('log/'+P.w.eval('dayKey(Date.now())'))||{entries:[]}).entries.length===2,'server log has 2 entries');
  ok(P.ob().length===0,'outbox drained');
  ok(!P.w.document.querySelector('.sync'),'banner gone');

  console.log('4. hanging connection');
  P.m.st.mode='hang';
  P.click('[data-reveal]'); await sleep(50); P.click('[data-grade="4"]'); await sleep(450);
  ok(P.ob().some(o=>o.p==='reviews/c3'),'c3 kept in outbox after write timeout');
  ok(P.S().offline===true,'offline flag set');
  P.m.st.mode='online'; await sleep(900);
  ok(store.has('reviews/c3')&&P.ob().length===0,'c3 synced after retry');

  console.log('5. tab closed with pending answers, reopened online');
  P.m.st.mode='reject';
  P.click('[data-reveal]'); await sleep(50); P.click('[data-grade="1"]'); await sleep(100);
  const saved={'kairos.outbox':P.w.localStorage.getItem('kairos.outbox')};
  ok(JSON.parse(saved['kairos.outbox']).some(o=>o.p==='reviews/c4'),'c4 pending before close');
  P.w.close();
  const P2=await page(store,saved); await sleep(200);
  ok(store.has('reviews/c4')&&P2.ob().length===0,'pending c4 synced on next open');
  ok(store.get('log/'+P2.w.eval('dayKey(Date.now())')).entries.length===4,'server log has all 4 answers');

  console.log('6. undo while offline');
  P2.m.st.mode='reject';
  P2.click('[data-study-all]'); await sleep(50);
  const cur=P2.S().study.cur;
  if(cur){P2.click('[data-reveal]');await sleep(30);P2.click('[data-grade="3"]');await sleep(80);
    P2.w.eval('undo()'); await sleep(80);
    P2.m.st.mode='online'; await sleep(900);
    ok(P2.ob().length===0,'outbox drained after undo');
    ok(store.get('log/'+P2.w.eval('dayKey(Date.now())')).entries.length===4,'undone answer not in server log');
  } else ok(true,'(no card due for undo test; skipped)');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
