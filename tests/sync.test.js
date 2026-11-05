// Login + sync test with a mock Supabase (auth, put_docs RPC, user_docs, private_docs).
// Two "devices" share one mock server. Run after scripts/build_web.py.
const http=require('http'),fs=require('fs'),path=require('path'); const {JSDOM}=require('jsdom');
const WEB=path.join(__dirname,'..','web'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0; const ok=(c,m)=>{if(c){pass++;console.log('  ok  ',m)}else{fail++;console.log('  FAIL',m)}};

// ---- mock server ----
const server={users:{'me@x.com':'u-me','friend@x.com':'u-friend'},rows:new Map(),priv:[],clock:0,codes:{}};
function tick(){server.clock++;return new Date(Date.UTC(2026,0,1,0,0,0)+server.clock).toISOString()}
function mockClient(device){
  let session=null; const subs=[];
  const setSession=s=>{session=s;subs.forEach(f=>f(s?'SIGNED_IN':'SIGNED_OUT',s))};
  const uid=()=>session&&session.user.id;
  function query(table){
    const st={filters:[],order:null,limit:1000};
    const q={select(){return q},order(c,o){st.order=[c,o];return q},limit(n){st.limit=n;return q},gt(c,v){st.filters.push(r=>r[c]>v);return q},
      then(res,rej){return Promise.resolve().then(()=>{
        if(!uid())return {data:null,error:{message:'not signed in'}};
        let out;
        if(table==='user_docs')out=[...server.rows.values()].filter(r=>r.user_id===uid()).filter(r=>st.filters.every(f=>f(r)));
        else out=server.priv.filter(r=>r.owner===uid());
        if(st.order)out.sort((a,b)=>a[st.order[0]]<b[st.order[0]]?-1:1);
        return {data:JSON.parse(JSON.stringify(out.slice(0,st.limit))),error:null};
      }).then(res,rej)}};
    return q;
  }
  return {
    auth:{
      getSession:async()=>({data:{session}}),
      onAuthStateChange:f=>{subs.push(f);return {data:{subscription:{unsubscribe(){}}}}},
      signInWithOtp:async({email})=>{if(!server.users[email])server.users[email]='u-'+email;server.codes[email]='123456';return {error:null}},
      verifyOtp:async({email,token})=>{if(server.codes[email]!==token)return {data:{},error:{message:'Token has expired or is invalid'}};const s={user:{id:server.users[email],email}};setSession(s);return {data:{user:s.user,session:s},error:null}},
      signOut:async()=>{setSession(null);return {error:null}}
    },
    rpc:async(fn,{docs})=>{
      if(device.offline)return {error:{message:'Failed to fetch'}};
      if(!uid())return {error:{message:'not signed in'}};
      for(const d of docs){const k=uid()+'|'+d.path,cur=server.rows.get(k);
        if(!cur||cur.updated_at<d.updated_at)server.rows.set(k,{user_id:uid(),path:d.path,body:d.body,updated_at:d.updated_at,server_at:tick()})}
      return {error:null}},
    from:t=>device.offline?{select(){return this},order(){return this},limit(){return this},gt(){return this},then(r){return Promise.resolve({data:null,error:{message:'Failed to fetch'}}).then(r)}}:query(t)
  };
}
// ---- pages ----
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';fs.readFile(path.join(WEB,u),(e,b)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200);r.end(b)})});
async function device(port,name){
  const html=fs.readFileSync(path.join(WEB,'index.html'),'utf8').replace(/<script src=[^>]+><\/script>/g,'').replace(/<link rel="stylesheet"[^>]+>/g,'').replace('"supabaseAnonKey": ""','"supabaseAnonKey": "test-anon"');
  const dev={name,offline:false,errors:[]};
  const dom=new JSDOM(html,{runScripts:'dangerously',url:`http://127.0.0.1:${port}/`,pretendToBeVisual:true,beforeParse(w){
    w.scrollTo=()=>{}; w.fetch=(u,o)=>fetch(new URL(u,`http://127.0.0.1:${port}/`),o);
    w.supabase={createClient:()=>mockClient(dev)}; w.addEventListener('error',e=>dev.errors.push(e.message));}});
  await sleep(400);
  const w=dom.window; Object.assign(dev,{w,S:()=>w.eval('S'),A:()=>w.KAIROS_WEB.account,click:async s=>{w.document.querySelector(s).click();await sleep(60)}});
  return dev;
}
async function answer(d,g){if(d.S().view!=='study')await d.click('[data-study-all]');await d.click('[data-reveal]');const id=d.S().study.cur;await d.click(`[data-grade="${g}"]`);return id}
async function login(d,email){d.w.eval(`S.view='home';S.panels.add('conta');render()`);await sleep(40);d.w.document.getElementById('acct-email').value=email;await d.click('[data-acct="send"]');await sleep(40);d.w.document.getElementById('acct-code').value='123456';await d.click('[data-acct="verify"]');await sleep(150)}

srv.listen(0,async()=>{
  const port=srv.address().port;
  try{
    console.log('1. anonymous use, then first login migrates progress');
    const A=await device(port,'A');
    ok(A.A().configured()&&!A.A().user(),'login available but optional');
    ok(A.w.document.body.textContent.includes('só neste aparelho'),'header says progress is only on this device');
    await A.click('[data-study-all]'); const a1=await answer(A,3);
    ok(A.S().revs.has(a1),'anonymous answer saved locally');
    await login(A,'me@x.com');
    ok(A.A().user()&&A.A().user().email==='me@x.com','login with email code');
    ok(server.rows.has('u-me|reviews/'+a1),'anonymous progress uploaded on first login');
    ok(A.w.document.body.textContent.includes('sincronizado'),'header says synced');

    console.log('2. second device pulls');
    const B=await device(port,'B'); await login(B,'me@x.com');
    ok(B.S().revs.has(a1),'device B sees the answer from A');
    await B.click('[data-study-all]'); const b1=await answer(B,4); await B.A().syncNow();
    await A.A().syncNow(); await sleep(60);
    ok(A.S().revs.has(b1),'device A sees the answer from B');
    const day=A.w.eval('dayKey(Date.now())');
    ok(A.S().log.length===2&&B.S().log.length>=1,'A log merges both answers');
    await B.A().syncNow(); await sleep(60);
    ok(B.S().log.length===2,'B log merges both answers');

    console.log('3. offline answers sync later; newest write wins');
    B.offline=true; const b2=await answer(B,3); await B.A().syncNow();
    ok(B.A().state().pending>0&&B.A().state().error,'offline: change kept as pending');
    B.offline=false; await B.A().syncNow(); await A.A().syncNow(); await sleep(60);
    ok(A.S().revs.has(b2)&&B.A().state().pending===0,'back online: pending change synced');
    const k='u-me|reviews/'+a1, before=server.rows.get(k).updated_at;
    A.w.eval(`S.view='study';S.study={deckSet:new Set([...S.decks.keys()]),label:'x',cur:${JSON.stringify(a1)},revealed:true,flip:0};render()`); await sleep(40);
    await A.click('[data-grade="1"]'); await A.A().syncNow(); await B.A().syncNow(); await sleep(60);
    ok(server.rows.get(k).updated_at>before&&B.S().revs.get(a1).reps===A.S().revs.get(a1).reps&&A.S().revs.get(a1).reps===2,'newer answer on A replaces the old one on B');

    console.log('4. private decks for the owner only');
    server.priv.push({owner:'u-me',coll:'decks',id:'p1',body:{name:'Pessoal::Teste',created:1}},{owner:'u-me',coll:'cards',id:'p1-001',body:{deck:'p1',front:'Q priv',back:'A',tags:['fundamentos'],created:1}});
    await A.A().syncNow(); await sleep(60);
    ok(A.S().decks.get('p1')&&A.S().decks.get('p1').private&&A.S().cards.has('p1-001'),'owner sees the private deck after sync');
    const C=await device(port,'C'); await login(C,'friend@x.com');
    ok(!C.S().decks.has('p1')&&!C.S().revs.has(a1),'another user sees neither private decks nor my progress');

    console.log('5. sign out clears the device');
    A.w.eval(`S.view='home';S.panels.add('conta');render()`);await sleep(40);await A.click('[data-acct="signout"]'); await sleep(100);
    ok(!A.A().user()&&A.S().revs.size===0&&!A.S().decks.has('p1'),'sign out removes progress and private decks from the device');
    ok(A.S().decks.size>=7,'public decks remain');
    await login(A,'me@x.com');
    ok(A.S().revs.has(a1)&&A.S().revs.has(b1),'signing in again restores progress');
    ok([A,B,C].every(d=>d.errors.length===0),'no script errors '+JSON.stringify([A,B,C].map(d=>d.errors)));
  }catch(e){console.error(e);fail++}
  console.log(`\n${pass} passed, ${fail} failed`); srv.close(); process.exit(fail?1:0);
});
