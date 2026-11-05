// Test of the GitHub Pages build: run `python3 scripts/build_web.py` first.
// Serves web/ over HTTP, runs index.html in jsdom, checks data load, study, persistence.
const http=require('http'),fs=require('fs'),path=require('path'); const {JSDOM}=require('jsdom');
const WEB=path.join(__dirname,'..','web'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0; const ok=(c,m)=>{if(c){pass++;console.log('  ok  ',m)}else{fail++;console.log('  FAIL',m)}};
const srv=http.createServer((q,r)=>{const f=path.join(WEB,decodeURIComponent(q.url.split('?')[0])==='/'?'index.html':decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(f,(e,b)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200);r.end(b)})});
async function open(port,storage){
  const html=fs.readFileSync(path.join(WEB,'index.html'),'utf8').replace(/<script src=[^>]+><\/script>/g,'').replace(/<link rel="stylesheet"[^>]+>/g,'');
  const errors=[];
  const dom=new JSDOM(html,{runScripts:'dangerously',url:`http://127.0.0.1:${port}/`,pretendToBeVisual:true,
    beforeParse(w){w.scrollTo=()=>{};w.fetch=(u,o)=>fetch(new URL(u,`http://127.0.0.1:${port}/`),o);
      if(storage)for(const[k,v]of Object.entries(storage))w.localStorage.setItem(k,v);
      w.addEventListener('error',e=>errors.push(e.message))}});
  await sleep(400);
  const w=dom.window; return {w,S:()=>w.eval('S'),click:s=>w.document.querySelector(s).click(),app:()=>w.document.getElementById('app').textContent,errors};
}
srv.listen(0,async()=>{
  const port=srv.address().port;
  try{
    console.log('1. load');
    let P=await open(port);
    ok(P.S().decks.size===7,'7 decks loaded from data/decks.json');
    ok(P.S().cards.size>=300,'cards loaded from data/cards.json ('+P.S().cards.size+')');
    ok(P.app().includes('Kairos')&&!P.app().includes('Não foi possível'),'home renders');
    console.log('2. study and persist');
    P.click('[data-study-all]'); await sleep(50);
    const first=P.S().study.cur; P.click('[data-reveal]'); await sleep(30); P.click('[data-grade="3"]'); await sleep(100);
    ok(P.S().revs.has(first),'answer recorded');
    const store=P.w.localStorage.getItem('kairos.local.v1');
    ok(store&&JSON.parse(store)['reviews/'+first],'progress saved in localStorage');
    ok(!P.w.document.querySelector('.sync'),'no pending-sync banner (local store accepts writes)');
    const saved={}; for(let i=0;i<P.w.localStorage.length;i++){const k=P.w.localStorage.key(i);saved[k]=P.w.localStorage.getItem(k)}
    P.w.close();
    console.log('3. reopen');
    const P2=await open(port,saved);
    ok(P2.S().revs.has(first),'progress survives reload');
    ok(P2.S().log.length===1,'today log survives reload');
    console.log('4. local card edit');
    P2.w.eval(`S.edit={id:${JSON.stringify(first)}}`); P2.w.eval('render()'); await sleep(30);
    P2.w.document.getElementById('e-front').value='Pergunta editada'; P2.click('[data-save]'); await sleep(80);
    ok(P2.S().cards.get(first).front==='Pergunta editada','edit applied');
    ok(JSON.parse(P2.w.localStorage.getItem('kairos.local.v1'))['cards/'+first].front==='Pergunta editada','edit stored on device');
    ok(P.errors.length===0&&P2.errors.length===0,'no script errors '+JSON.stringify(P.errors.concat(P2.errors)));
  }catch(e){console.error(e);fail++}
  console.log(`\n${pass} passed, ${fail} failed`); srv.close(); process.exit(fail?1:0);
});
