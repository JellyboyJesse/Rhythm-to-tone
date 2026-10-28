/* Headless checks for Rhythm Into Tone.
   Serve the repo first:   python3 -m http.server 8765
   Then run:               node tests/check.cjs   (optionally: BASE=http://localhost:8765/ node tests/check.cjs)
   Needs Playwright with Chromium. Screenshots go to tests/out/. */
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path');
const BASE=process.env.BASE||'http://localhost:8765/';
const OUT=path.join(__dirname,'out');fs.mkdirSync(OUT,{recursive:true});
let failed=0;
function check(name,ok,detail){console.log((ok?'PASS ':'FAIL ')+name+(detail!==undefined?'  ('+detail+')':''));if(!ok)failed++;}
const ignorable=t=>/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_NAME|net::ERR_/.test(t);

(async()=>{
  const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
  const errs=[];
  const watch=(p,tag)=>{p.on('pageerror',e=>errs.push(tag+': '+e.message));p.on('console',m=>{if(m.type()==='error'&&!ignorable(m.text()))errs.push(tag+': '+m.text());});};
  const ctx=await browser.newContext({viewport:{width:1280,height:900}});
  const inst=await ctx.newPage();watch(inst,'instrument');
  await inst.goto(BASE);await inst.waitForTimeout(500);
  await inst.evaluate(()=>{try{localStorage.clear();}catch(e){}});await inst.reload();await inst.waitForTimeout(400);

  /* 1. the engine's output matches the maths: rings 1:2:3:4 at 100 Hz -> divisor sums x click spectrum */
  const m=await inst.evaluate(()=>{
    const sr=48000,e=new Engine(sr);
    const S=JSON.parse(JSON.stringify(state));S.base.speed=100;S.base.F=700;S.base.sigma=1.2;S.lfo={};S.seq.playing=false;
    S.rings=[1,2,3,4].map(n=>({on:true,steps:n,hits:n,rot:0,level:1}));
    applyMsg(e,{S,jump:true});const N=sr,out=new Float32Array(N);for(let i=0;i<N;i+=128)e.render(out.subarray(i,i+128),128,i/sr);
    const H=[];for(let n=1;n<=10;n++){let re=0,im=0;for(let i=sr/2;i<N;i++){const a=2*Math.PI*n*100*i/sr;re+=out[i]*Math.cos(a);im+=out[i]*Math.sin(a);}H.push(Math.hypot(re,im));}
    const s=0.0012,G=nu=>Math.abs(Math.exp(-2*Math.PI**2*s*s*(nu-700)**2)-Math.exp(-2*Math.PI**2*s*s*(nu+700)**2));
    const P=H.map((_,i)=>[1,2,3,4].filter(k=>(i+1)%k===0).reduce((a,k)=>a+k,0)*G((i+1)*100));
    const mh=Math.max(...H),mp=Math.max(...P);let err=0;H.forEach((h,i)=>err=Math.max(err,Math.abs(h/mh-P[i]/mp)));
    let leak=0;{let re=0,im=0;for(let i=sr/2;i<N;i++){const a=2*Math.PI*150*i/sr;re+=out[i]*Math.cos(a);im+=out[i]*Math.sin(a);}leak=Math.hypot(re,im)/mh;}
    /* sequencer inside the engine: melody example, speed per step (glides on steps 4 and 5) */
    const e2=new Engine(sr),S2=JSON.parse(JSON.stringify(S));S2.seq=exampleSeq('melody');S2.seq.playing=true;applyMsg(e2,{S:S2,jump:true});
    const sd=60/96/2,buf=new Float32Array(128),got=[];let t=0;
    for(let k=0;k<8;k++){while(t<(k+0.6)*sd){e2.render(buf,128,t);t+=128/sr;}got.push({step:e2.step,f:Math.exp(e2.lf)});}
    const want=[45,48,52,57,55,52,50,48].map(m=>440*Math.pow(2,(m-69)/12));
    let stepOk=got.every((g,k)=>g.step===k),pitchErr=0;[0,1,2,5,6,7].forEach(k=>pitchErr=Math.max(pitchErr,Math.abs(got[k].f/want[k]-1)));
    /* rests are silent */
    const e3=new Engine(sr),S3=JSON.parse(JSON.stringify(S));S3.base.speed=4;S3.seq=defaultSeq();S3.seq.gate.fill(false);S3.seq.playing=true;applyMsg(e3,{S:S3,jump:true});
    let rest=0;t=0;for(let n=0;n<sr;n+=128){e3.render(buf,128,t);t+=128/sr;if(t>0.05)for(const v of buf)rest=Math.max(rest,Math.abs(v));}
    /* stress: every LFO at half depth, lanes locking ring structure, glides, at four speeds */
    const shapes=['sine','tri','saw','square','random','drift'],stress=[];
    for(const sp of [0.5,12,220,900]){const e4=new Engine(sr),S4=JSON.parse(JSON.stringify(S));S4.base.speed=sp;
      S4.rings=[{on:true,steps:8,hits:3,rot:0,level:1},{on:true,steps:8,hits:5,rot:2,level:.8},{on:true,steps:5,hits:2,rot:0,level:1},{on:true,steps:16,hits:9,rot:3,level:.6}];
      let i=0;for(const k of Object.keys(LFOSPEC)){S4.lfo[k]={shape:shapes[i%6],rate:0.3+i*0.9,depth:LFOSPEC[k].max*0.5,seed:hashKey(k)};i++;}
      S4.seq=exampleSeq('bars');S4.seq.lanes[0]={key:'r1steps',snap:false,vals:Array.from({length:16},(_,j)=>j/15)};S4.seq.clock='tempo';S4.seq.bpm=240;S4.seq.div=4;S4.seq.playing=true;S4.seq.gate[3]=false;S4.seq.glide.fill(true);
      applyMsg(e4,{S:S4,jump:true});let bad=0,peak=0;t=0;
      for(let n=0;n<sr*4;n+=128){e4.render(buf,128,t);t+=128/sr;for(const v of buf){if(!isFinite(v))bad++;else peak=Math.max(peak,Math.abs(v));}}
      stress.push({sp,bad,peak});}
    return{err,leak,stepOk,pitchErr,rest,stress,worklet:WORKLET_SRC.length};
  });
  check('engine harmonics match divisor sums x click spectrum',m.err<0.01,'max error '+m.err.toFixed(4));
  check('no energy between harmonics',m.leak<1e-6,m.leak.toExponential(1));
  check('sequencer steps in order inside the engine',m.stepOk);
  check('sequencer pitches land on the notes',m.pitchErr<0.01,(m.pitchErr*100).toFixed(2)+'%');
  check('rest steps are silent',m.rest===0,m.rest);
  for(const s of m.stress)check(`stress at ${s.sp} loops/s: finite and within limiter`,s.bad===0&&s.peak<=1.0001,'peak '+s.peak.toFixed(3));

  /* 2. sound starts on the AudioWorklet */
  await inst.click('#start');await inst.waitForTimeout(800);
  const note=await inst.textContent('#engineNote');
  check('Start sound uses the AudioWorklet engine',/AudioWorklet/.test(note),note);

  /* 3. sequencer in its own tab stays in sync */
  const seq=await ctx.newPage();watch(seq,'sequencer');
  await seq.goto(BASE+'#sequencer');await seq.waitForTimeout(1300);
  check('sequencer tab connects to the instrument',/Connected/.test(await seq.textContent('[data-r=conn]')));
  await seq.click('[data-ex=melody]');await seq.waitForTimeout(300);
  const lanes=await inst.evaluate(()=>state.seq.lanes.map(l=>l.key+':'+l.vals.filter(v=>v!==null).length).join(' '));
  check('example sequence reaches the instrument',lanes.startsWith('speed:8 F:8'),lanes);
  await seq.click('[data-r=play]');
  const seen=new Set();for(let i=0;i<12;i++){await seq.waitForTimeout(220);seen.add(await inst.textContent('#tbStep'));}
  check('instrument plays through the steps',seen.size>=5,[...seen].join(' '));
  const cv=await seq.$$('.lane canvas:not(.trig)'),bb=await cv[2].boundingBox();
  await seq.mouse.move(bb.x+5,bb.y+bb.height*0.3);await seq.mouse.down();await seq.mouse.move(bb.x+bb.width*0.45,bb.y+bb.height*0.7,{steps:8});await seq.mouse.up();await seq.waitForTimeout(250);
  const drawn=await inst.evaluate(()=>state.seq.lanes[2].vals.filter(v=>v!==null).length);
  check('drawing in a lane reaches the instrument',drawn>=6,drawn+' steps');
  const tb=await (await seq.$('canvas.trig')).boundingBox();await seq.mouse.click(tb.x+tb.width*(2.5/16),tb.y+28);await seq.waitForTimeout(200);
  check('tapping a gate reaches the instrument',(await inst.evaluate(()=>state.seq.gate[2]))===false);
  await seq.screenshot({path:path.join(OUT,'sequencer-desktop.png'),fullPage:true});
  await inst.bringToFront();await inst.click('#tbPlay');await inst.waitForTimeout(500);
  check('Stop on the instrument updates the sequencer',(await seq.textContent('[data-r=play]'))==='Play');

  /* 4. docked sequencer, LFOs, reset, saved state */
  await inst.click('#seqDock');await inst.waitForTimeout(900);
  check('docked sequencer connects',/Connected/.test(await inst.textContent('#dock [data-r=conn]')));
  await inst.click('#pSound .lfob[data-key=F]');await inst.click('#scatter');await inst.waitForTimeout(300);
  check('LFOs can be added',/active/.test(await inst.textContent('#lfoCount'))&&!/none/.test(await inst.textContent('#lfoCount')));
  await inst.screenshot({path:path.join(OUT,'instrument-desktop.png'),fullPage:true});
  await inst.click('#reset');await inst.click('#reset');await inst.waitForTimeout(200);
  check('Reset patch clears LFOs and restores speed',/none/.test(await inst.textContent('#lfoCount'))&&(await inst.evaluate(()=>state.base.speed))===0.5);
  await inst.click('[data-go="110"]');await inst.waitForTimeout(700);
  const p2=await ctx.newPage();await p2.goto(BASE);await p2.waitForTimeout(400);
  check('settings survive a reload',(await p2.evaluate(()=>state.base.speed))===110);await p2.close();

  /* 5. fallback engine when AudioWorklet is missing */
  const fb=await ctx.newPage();watch(fb,'fallback');
  await fb.addInitScript(()=>{Object.defineProperty(BaseAudioContext.prototype,'audioWorklet',{get(){return undefined;}});});
  await fb.goto(BASE);await fb.waitForTimeout(300);await fb.click('#start');await fb.waitForTimeout(600);await fb.click('#tbPlay');
  const fs2=new Set();for(let i=0;i<6;i++){await fb.waitForTimeout(250);fs2.add(await fb.textContent('#tbStep'));}
  check('fallback engine plays the sequence',/fallback/.test(await fb.textContent('#engineNote'))&&fs2.size>=3,[...fs2].join(' '));
  await fb.close();

  /* 6. phone width, light and dark */
  for(const scheme of ['light','dark']){
    const ph=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,colorScheme:scheme});
    for(const [name,url] of [['instrument',BASE],['sequencer',BASE+'#sequencer']]){
      const p=await ph.newPage();watch(p,'phone '+name);await p.goto(url);await p.waitForTimeout(500);
      const w=await p.evaluate(()=>document.documentElement.scrollWidth);
      check(`${name} at 390 px (${scheme}) has no sideways scroll`,w<=390,w+' px');
      await p.screenshot({path:path.join(OUT,`${name}-phone-${scheme}.png`),fullPage:true});await p.close();}
    await ph.close();}

  check('no page errors',errs.length===0,errs.join(' | ')||'none');
  await browser.close();
  console.log(failed?`\n${failed} CHECK(S) FAILED`:'\nALL CHECKS PASSED');
  process.exit(failed?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
