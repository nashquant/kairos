// Tests learning-step modes, flagging, auto-resolve after a fix, and restore of deleted public cards.
// Run after scripts/build_web.py.
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'); const {JSDOM}=require('jsdom');
const SRC=path.join(__dirname,'..','web'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0; const ok=(c,m)=>{if(c){pass++;console.log('  ok  ',m)}else{fail++;console.log('  FAIL',m)}};
const DAY=864e5, MIN=6e4;

// Serve a copy of web/ so the test can "fix" a card on the server side.
const WEB=fs.mkdtempSync(path.join(os.tmpdir(),'kairos-web-')); fs.cpSync(SRC,WEB,{recursive:true});
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';fs.readFile(path.join(WEB,u),(e,b)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200);r.end(b)})});
async function open(port,storage){
  const html=fs.readFileSync(path.join(WEB,'index.html'),'utf8').replace(/<script src=[^>]+><\/script>/g,'').replace(/<link rel="stylesheet"[^>]+>/g,'').replace(/"supabaseAnonKey": "[^"]*"/,'"supabaseAnonKey": ""');
  const errors=[];
  const dom=new JSDOM(html,{runScripts:'dangerously',url:`http://127.0.0.1:${port}/`,pretendToBeVisual:true,beforeParse(w){
    w.scrollTo=()=>{}; w.fetch=(u,o)=>fetch(new URL(u,`http://127.0.0.1:${port}/`),o);
    if(storage)for(const[k,v]of Object.entries(storage))w.localStorage.setItem(k,v);
    w.addEventListener('error',e=>errors.push(e.message));}});
  await sleep(500);
  const w=dom.window;
  return {w,S:()=>w.eval('S'),errors,click:async s=>{w.document.querySelector(s).click();await sleep(60)},
    store:()=>{const o={};for(let i=0;i<w.localStorage.length;i++){const k=w.localStorage.key(i);o[k]=w.localStorage.getItem(k)}return o}};
}
srv.listen(0,async()=>{
  const port=srv.address().port;
  try{
    console.log('1. learning steps');
    let P=await open(port);
    const due=(g,steps)=>P.w.eval(`S.settings.steps=${JSON.stringify(steps)};(schedule(null,${g},0).due)`);
    ok(due(3,'errors')===4*DAY,'default: "Bom" on a new card = 4 days (90% retention)');
    ok(due(4,'errors')===14*DAY,'default: "Fácil" on a new card = 14 days');
    ok(due(1,'errors')===1*MIN,'default: "Errei" on a new card = 1 min');
    ok(due(2,'errors')===10*MIN,'default: "Difícil" on a new card = 10 min');
    ok(due(3,'short')===10*MIN,'Anki mode: "Bom" on a new card = 10 min');
    const afterErr=P.w.eval(`S.settings.steps='errors';(()=>{const a=schedule(null,1,0);return schedule(a,3,a.due)})()`);
    ok(afterErr.state==='review'&&afterErr.due-afterErr.last===1*DAY,'default: "Errei" then "Bom" graduates to 1 day');
    P.w.eval("S.settings.retention=0.85");
    ok(due(3,'errors')===6*DAY,'85% retention: "Bom" on a new card = 6 days');
    P.w.eval("S.settings.retention=0.9;S.settings.steps='errors'");
    P.w.eval("S.panels.add('ajustes');render()"); await sleep(40);
    P.w.document.getElementById('set-steps').value='short'; await P.click('[data-save-settings]');
    ok(P.S().settings.steps==='short','setting saves');
    P.w.document.getElementById('set-steps').value='errors'; await P.click('[data-save-settings]');

    console.log('2. flag a card while studying');
    await P.click('[data-study-all]');
    const id=P.S().study.cur, card=P.S().cards.get(id);
    const before=P.w.eval('(()=>{let n=0;for(const v of deckCounts().values())n+=v.n;return n})()');
    await P.click(`[data-flag="${id}"]`);
    ok(!!P.w.document.getElementById('f-note'),'flag sheet opens');
    P.w.document.getElementById('f-note').value='resposta incompleta'; await P.click('[data-flag-save]');
    ok(P.S().study.cur!==id,'study moves to the next card');
    const after=P.w.eval('(()=>{let n=0;for(const v of deckCounts().values())n+=v.n;return n})()');
    ok(before-after===1,'flagged card leaves the counts');
    P.w.eval("S.view='home';render()"); await sleep(50);
    const report=P.w.document.getElementById('flag-report');
    ok(report&&report.value.includes('id: '+id)&&report.value.includes('resposta incompleta'),'home lists the flag with id and note for Claude');
    const saved=P.store(); P.w.close();

    console.log('3. Claude fixes the card -> flag resolves');
    const P2=await open(port,saved);
    ok(P2.w.eval(`isFlagged(${JSON.stringify(id)})`),'flag survives reload');
    const cards=JSON.parse(fs.readFileSync(path.join(WEB,'data','cards.json'),'utf8'));
    cards[id].back=cards[id].back+'\n\nCorrigido.'; fs.writeFileSync(path.join(WEB,'data','cards.json'),JSON.stringify(cards));
    await P2.w.eval('KAIROS_WEB.reload()'); await sleep(150);
    ok(!P2.w.eval(`isFlagged(${JSON.stringify(id)})`),'changed text: card is back in study');
    ok(!P2.w.document.getElementById('flag-report'),'flag list is empty');

    console.log('4. editor: public cards are flagged, not deleted; restore old deletions');
    P2.w.eval(`S.edit={id:${JSON.stringify(id)}};render()`); await sleep(40);
    ok(!P2.w.document.querySelector('[data-del]')&&P2.w.document.querySelector('[data-flag]'),'public card editor offers "Sinalizar problema", no delete');
    P2.w.eval('S.edit=null;render()'); await sleep(20);
    const other=[...P2.S().cards.keys()].find(k=>k!==id&&!k.startsWith('u-'));
    await P2.w.eval(`S.db.doc('cards/'+${JSON.stringify(other)}).delete()`); await sleep(80);
    ok(!P2.S().cards.has(other),'old-style deletion hides the card');
    P2.w.eval("S.view='home';render()"); await sleep(40);
    ok(!!P2.w.document.querySelector(`[data-restore="${other}"]`),'home offers to restore it');
    await P2.click(`[data-restore="${other}"]`); await sleep(120);
    ok(P2.S().cards.has(other)&&P2.S().cards.get(other).front,'restored card is back with repo content');
    ok([P,P2].every(x=>x.errors.length===0),'no script errors '+JSON.stringify([P.errors,P2.errors]));
  }catch(e){console.error(e);fail++}
  console.log(`\n${pass} passed, ${fail} failed`); srv.close(); fs.rmSync(WEB,{recursive:true,force:true}); process.exit(fail?1:0);
});
