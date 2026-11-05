// Tests the tag filter and encrypted private decks end to end:
// key made in the browser -> chunk encrypted by scripts/encrypt_private.py -> decrypted in the page.
// Works on a temporary copy of the repo. Run: node tests/private.test.js
const fs=require('fs'),path=require('path'),os=require('os'),http=require('http'),{execFileSync}=require('child_process');
const {JSDOM}=require('jsdom'); const {webcrypto}=require('crypto'); const util=require('util');
const ROOT=path.join(__dirname,'..'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0; const ok=(c,m)=>{if(c){pass++;console.log('  ok  ',m)}else{fail++;console.log('  FAIL',m)}};

const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'kairos-'));
for(const p of ['app.html','scripts','web-src','data'])fs.cpSync(path.join(ROOT,p),path.join(TMP,p),{recursive:true});
fs.rmSync(path.join(TMP,'data','private'),{recursive:true,force:true}); fs.mkdirSync(path.join(TMP,'data','private'));
fs.writeFileSync(path.join(TMP,'data','private','index.json'),'{"files": []}');
const build=()=>execFileSync('python3',[path.join(TMP,'scripts','build_web.py')]);
build();
const WEB=path.join(TMP,'web');
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';fs.readFile(path.join(WEB,u),(e,b)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200);r.end(b)})});

async function open(port,storage){
  const html=fs.readFileSync(path.join(WEB,'index.html'),'utf8').replace(/<script src=[^>]+><\/script>/g,'').replace(/<link rel="stylesheet"[^>]+>/g,'');
  const errors=[];
  const dom=new JSDOM(html,{runScripts:'dangerously',url:`http://127.0.0.1:${port}/`,pretendToBeVisual:true,beforeParse(w){
    w.scrollTo=()=>{}; w.fetch=(u,o)=>fetch(new URL(u,`http://127.0.0.1:${port}/`),o);
    Object.defineProperty(w,'crypto',{value:webcrypto}); w.TextEncoder=util.TextEncoder; w.TextDecoder=util.TextDecoder;
    if(storage)for(const[k,v]of Object.entries(storage))w.localStorage.setItem(k,v);
    w.addEventListener('error',e=>errors.push(e.message));}});
  await sleep(500);
  const w=dom.window;
  return {w,S:()=>w.eval('S'),errors,store:()=>{const o={};for(let i=0;i<w.localStorage.length;i++){const k=w.localStorage.key(i);o[k]=w.localStorage.getItem(k)}return o}};
}

srv.listen(0,async()=>{
  const port=srv.address().port;
  try{
    console.log('1. tag filter');
    let P=await open(port);
    const total=P.S().cards.size;
    const amcCount=[...P.S().cards.values()].filter(c=>(c.tags||[]).includes('amc')).length;
    const before=P.w.eval('(()=>{let n=0;for(const v of deckCounts().values())n+=v.n;return n})()');
    P.w.document.querySelector('[data-tag="amc"]').click(); await sleep(50);
    const after=P.w.eval('(()=>{let n=0;for(const v of deckCounts().values())n+=v.n;return n})()');
    ok(amcCount>0&&before-after===amcCount,`turning off "amc" hides its ${amcCount} cards from the counts`);
    ok(JSON.parse(P.store()['kairos.filter']).off.includes('amc'),'filter saved on the device');
    P.w.document.querySelector('[data-study-all]').click(); await sleep(30);
    let seen=new Set(), leaked=false;
    for(let i=0;i<25&&P.S().study.cur;i++){const c=P.S().cards.get(P.S().study.cur);if((c.tags||[]).includes('amc'))leaked=true;seen.add(P.S().study.cur);
      P.w.document.querySelector('[data-reveal]').click();await sleep(40);P.w.document.querySelector('[data-grade="4"]').click();await sleep(40)}
    ok(seen.size>0&&!leaked,'study queue never shows a filtered card');
    P.w.eval("S.view='home';render()"); await sleep(30);
    P.w.document.querySelector('[data-tag-reset]').click(); await sleep(30);
    ok(JSON.parse(P.store()['kairos.filter']).off.length===0,'"Mostrar tudo" clears the filter');

    console.log('2. key on device, encrypted chunk, decryption');
    await P.w.eval('KAIROS_WEB.keys.generate()');
    const pub=JSON.parse(P.w.eval('KAIROS_WEB.keys.publicText()'));
    ok(pub.kid&&pub.n&&!('d' in pub),'public key text has no private part');
    fs.writeFileSync(path.join(TMP,'data','public-key.json'),JSON.stringify(pub));
    const plain={decks:{'priv-1':{name:'Pessoal::Segredo',desc:'teste',created:1}},cards:{'priv-1-001':{deck:'priv-1',front:'Pergunta secreta',back:'Resposta secreta',tags:['fundamentos'],source:'t',created:1,suspended:false}}};
    const plainPath=path.join(TMP,'plain.json'); fs.writeFileSync(plainPath,JSON.stringify(plain));
    execFileSync('python3',[path.join(TMP,'scripts','encrypt_private.py'),plainPath,'chunk-001']);
    build();
    const enc=fs.readFileSync(path.join(WEB,'data','private','chunk-001.enc.json'),'utf8');
    ok(!enc.includes('secreta')&&!enc.includes('Segredo'),'published chunk has no plaintext');
    const withKey=P.store(); P.w.close();
    const P2=await open(port,withKey); await sleep(800);
    ok(P2.S().decks.has('priv-1')&&P2.S().decks.get('priv-1').private===true,'device with the key sees the private deck');
    ok(P2.S().cards.get('priv-1-001')&&P2.S().cards.get('priv-1-001').front==='Pergunta secreta','private card decrypted');
    ok(P2.w.eval('KAIROS_WEB.privateStatus.opened')===1,'status: 1 chunk opened');
    ok(P2.S().cards.size===total+1,'public cards still present');

    console.log('3. backup to another device');
    const code=await P2.w.eval("KAIROS_WEB.keys.exportBackup('senha-longa-de-teste')");
    ok(/^KAIROS1\./.test(code),'backup code generated');
    const P3=await open(port); await sleep(300);
    ok(!P3.S().decks.has('priv-1'),'device without the key does not see the private deck');
    ok(P3.w.eval('KAIROS_WEB.privateStatus.files')===1,'device without the key knows one locked chunk exists');
    let bad=false; try{await P3.w.eval("KAIROS_WEB.keys.importBackup("+JSON.stringify(code)+",'senha-errada-123')")}catch(e){bad=true}
    ok(bad,'wrong backup password is rejected');
    await P3.w.eval("KAIROS_WEB.keys.importBackup("+JSON.stringify(code)+",'senha-longa-de-teste').then(()=>KAIROS_WEB.reload())"); await sleep(800);
    ok(P3.S().decks.has('priv-1'),'after import, the second device sees the private deck');

    console.log('4. later chunk deletes a card');
    fs.writeFileSync(plainPath,JSON.stringify({cards:{'priv-1-001':null}}));
    execFileSync('python3',[path.join(TMP,'scripts','encrypt_private.py'),plainPath,'chunk-002']); build();
    await P3.w.eval('KAIROS_WEB.reload()'); await sleep(800);
    ok(!P3.S().cards.has('priv-1-001')&&P3.S().decks.has('priv-1'),'null in a later chunk deletes the card');
    ok([P,P2,P3].every(x=>x.errors.length===0),'no script errors');
  }catch(e){console.error(e);fail++}
  console.log(`\n${pass} passed, ${fail} failed`); srv.close(); fs.rmSync(TMP,{recursive:true,force:true}); process.exit(fail?1:0);
});
