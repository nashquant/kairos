// Tests the notebook (caderno): list, note view, card -> note links, reread after a miss, study by note, questions.
// Run after scripts/build_web.py.
const http=require('http'),fs=require('fs'),path=require('path'); const {JSDOM}=require('jsdom');
const WEB=path.join(__dirname,'..','web'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0; const ok=(c,m)=>{if(c){pass++;console.log('  ok  ',m)}else{fail++;console.log('  FAIL',m)}};
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';fs.readFile(path.join(WEB,u),(e,b)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200);r.end(b)})});
async function open(port){
  const html=fs.readFileSync(path.join(WEB,'index.html'),'utf8').replace(/<script src=[^>]+><\/script>/g,'').replace(/<link rel="stylesheet"[^>]+>/g,'').replace(/"supabaseAnonKey": "[^"]*"/,'"supabaseAnonKey": ""');
  const errors=[];
  const dom=new JSDOM(html,{runScripts:'dangerously',url:`http://127.0.0.1:${port}/`,pretendToBeVisual:true,beforeParse(w){
    w.scrollTo=()=>{}; w.Element.prototype.scrollIntoView=function(){}; w.fetch=(u,o)=>fetch(new URL(u,`http://127.0.0.1:${port}/`),o);
    w.addEventListener('error',e=>errors.push(e.message));}});
  await sleep(500);
  const w=dom.window, $=s=>w.document.querySelector(s);
  return {w,$,S:()=>w.eval('S'),errors,click:async s=>{$(s).click();await sleep(80)},text:()=>w.document.getElementById('app').textContent};
}
srv.listen(0,async()=>{
  const port=srv.address().port;
  const notes=JSON.parse(fs.readFileSync(path.join(WEB,'data','notes.json'),'utf8'));
  const nid=Object.keys(notes)[0], note=notes[nid];
  try{
    console.log('1. notebook list');
    const P=await open(port);
    ok(P.S().notes.size===Object.keys(notes).length,'notes loaded from data/notes.json');
    ok(!!P.$('[data-go="notebook"]'),'home shows the Caderno button');
    await P.click('[data-go="notebook"]');
    ok(P.text().includes(note.title),'notebook lists the note');

    console.log('2. note view');
    await P.click(`[data-open-note="${nid}"]`);
    ok(P.S().view==='note','note view opens');
    ok(note.sections.every(s=>P.$('#sec-'+s.id)),'every section renders with an anchor');
    const linked=P.w.eval(`noteCards(${JSON.stringify(nid)}).length`);
    ok(linked>0&&P.text().includes('Estudar as '+linked+' cartas'),'note shows its '+linked+' linked cards');
    ok(P.w.document.querySelectorAll('.objs li').length===(note.objectives||[]).length,'objectives render');
    await P.click('[data-note-tab="resumo"]');
    ok(P.$('.summary')&&P.S().note.tab==='resumo','summary tab renders');
    await P.click('[data-note-tab="nota"]');
    const before=P.$('.note'); P.w.eval('render()'); await sleep(60);
    ok(P.$('.note')===before,'re-render without change keeps the note DOM (no MathJax reset)');
    await P.click('[data-note-back]');
    ok(P.S().view==='notebook','back returns to the notebook');

    console.log('3. study the cards of one note');
    await P.click(`[data-open-note="${nid}"]`);
    await P.click(`[data-study-note="${nid}"]`);
    const st=P.S().study;
    ok(st&&st.idSet&&st.idSet.size===linked,'study session limited to the note cards');
    const cur=st.cur; const card=P.S().cards.get(cur);
    ok(card&&card.note&&card.note.startsWith(nid+'#'),'first card belongs to the note');

    console.log('4. miss -> reread banner -> note at section');
    await P.click('[data-reveal]');
    ok(!!P.$(`.meta [data-open-note]`),'revealed card offers the notebook link');
    await P.click('[data-grade="1"]');
    ok(P.S().study.missed===cur&&!!P.$('.reread'),'after "Errei" the reread banner shows');
    await P.click('.reread [data-open-note]'); await sleep(80);
    ok(P.S().view==='note'&&P.S().note.back==='study','reread opens the note, back goes to study');
    const sec=card.note.split('#')[1];
    ok(P.$('#sec-'+sec)&&P.$('#sec-'+sec).classList.contains('hit'),'the linked section is highlighted');
    await P.click('[data-note-back]');
    ok(P.S().view==='study'&&P.S().study.idSet.size===linked,'back resumes the same study session');
    await P.click('[data-missed-close]');
    ok(!P.$('.reread'),'banner closes');

    console.log('5. questions: multiple choice graded by the app');
    const qs=note.questions||[]; const mcs=qs.filter(q=>q.type==='mc');
    P.w.eval("S.view='notebook';render()"); await sleep(60);
    ok(P.$('[data-quiz-all]')&&P.text().includes(qs.length+' questões pendentes'),'notebook shows '+qs.length+' pending questions for the note');
    await P.click(`[data-open-note="${nid}"]`); await P.click('[data-note-tab="questoes"]');
    await P.click(`[data-quiz-note="${nid}"]`);
    let z=P.S().quiz;
    ok(P.S().view==='quiz'&&z.total===qs.length,'quiz starts with every new question');
    // answer until we meet a multiple-choice question
    const byId=Object.fromEntries(qs.map(q=>[q.id,q]));
    const answerOpen=async g=>{await P.click('[data-q-show]');await P.click(`[data-q-grade="${g}"]`)};
    while(byId[P.S().quiz.cur].type!=='mc')await answerOpen(2);
    let q=byId[P.S().quiz.cur], right=q.options.findIndex(o=>o.ok), wrong=q.options.findIndex(o=>!o.ok);
    const shown=[...P.w.document.querySelectorAll('.opt')].map(b=>+b.dataset.opt);
    ok(shown.length===q.options.length&&new Set(shown).size===shown.length,'all options shown once');
    await P.click(`[data-opt="${wrong}"]`);
    const r1=P.S().qrev.get(q.id);
    ok(r1&&r1.lastOk===0&&r1.state!=='review','wrong pick recorded as a miss');
    ok(P.$('.opt.bad')&&P.$('.opt.ok')&&P.w.document.querySelectorAll('.why').length===q.options.length,'feedback marks right, wrong and explains every option');
    const pos=P.S().quiz.queue.indexOf(q.id);
    ok(pos===Math.min(3,P.S().quiz.queue.length-1),'missed question re-queued after 3 others (pos '+pos+')');
    ok(JSON.parse(P.w.localStorage.getItem('kairos.local.v1'))['qrev/'+q.id],'question progress saved on device');
    await P.click('[data-q-next]');
    while(P.S().quiz.cur!==q.id){const c=byId[P.S().quiz.cur];if(c.type==='mc')await P.click(`[data-opt="${c.options.findIndex(o=>o.ok)}"]`),await P.click('[data-q-next]');else await answerOpen(2)}
    await P.click(`[data-opt="${right}"]`);
    const r2=P.S().qrev.get(q.id);
    ok(r2.lastOk===1&&r2.state==='review'&&r2.due-Date.now()>12*3600e3,'right pick after a miss goes to days');
    await P.click('[data-q-next]');

    console.log('6. open questions: self-grade');
    while(P.S().quiz.cur){const c=byId[P.S().quiz.cur];if(c.type==='mc'){await P.click(`[data-opt="${c.options.findIndex(o=>o.ok)}"]`);await P.click('[data-q-next]')}else{await P.click('[data-q-show]');await P.click('[data-q-grade="2"]')}}
    ok(P.text().includes('Fim da sessão'),'session ends');
    const openQs=qs.filter(q=>q.type==='open');
    ok(openQs.every(o=>{const r=P.S().qrev.get(o.id);return r&&r.state==='review'&&r.lastOk===0.5}),'"Moderado" goes to days with half credit (last answer)');
    const newMc=mcs.find(m=>m.id!==q.id), rr=P.S().qrev.get(newMc.id);
    ok(rr.due-rr.last>=3*864e5,'first-try right on a new question: 3+ days');
    ok(P.S().qrev.size===qs.length,'every question has progress');
    await P.click('[data-quiz-back]');
    ok(P.S().view==='note'&&P.S().note.tab==='questoes','back returns to the note questions tab');
    ok(P.text().includes('%'),'objective scores show');
    ok(P.w.eval(`pendingCount(noteQuestions(${JSON.stringify(nid)}))`)===0,'no questions of this note pending after the session');

    console.log('7. deck study ignores notes');
    P.w.eval("S.view='home';render()"); await sleep(60);
    await P.click('[data-study-all]');
    ok(P.S().study.idSet===null,'normal study has no card filter');
    ok(P.errors.length===0,'no script errors '+JSON.stringify(P.errors));
  }catch(e){console.error(e);fail++}
  console.log(`\n${pass} passed, ${fail} failed`); srv.close(); process.exit(fail?1:0);
});
