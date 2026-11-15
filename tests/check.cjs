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
  const watch=(p,tag)=>{p.on('pageerror',e=>{errs.push(tag+': '+e.message);if(process.env.DEBUG)console.log('PAGE ERROR',tag,e.stack||e.message);});p.on('console',m=>{if(m.type()==='error'&&!ignorable(m.text()))errs.push(tag+': '+m.text());});};
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
    /* per-dot pitch, length and level (with a rotated ring): the engine against the page's own spectrum formula */
    const z16=a=>Array.from({length:16},(_,i)=>a[i]===undefined?0:a[i]),o16=a=>Array.from({length:16},(_,i)=>a[i]===undefined?1:a[i]);
    const e5=new Engine(sr),S5=JSON.parse(JSON.stringify(S));
    S5.rings=[{on:true,steps:4,hits:4,rot:1,level:1,dp:z16([0,7,12,-5]),dl:z16([0,0.5,-0.5,0.25]),da:o16([1,0.5,0.8,0.3]),
        pld:z16([0,5]),plr:Array(16).fill(0.02),pls:Array(16).fill('square'),lld:z16([0,0,0.5]),llr:Array(16).fill(0.02),lls:Array(16).fill('square')},   /* square LFOs slow enough to hold one value for the whole test */
      {on:true,steps:5,hits:3,rot:2,level:0.7,dp:z16([3,-2,9]),dl:z16([-0.3,0,0.4]),da:o16([0.9,0,1])},
      {on:false,steps:1,hits:0,rot:0,level:1},{on:false,steps:1,hits:0,rot:0,level:1}];
    applyMsg(e5,{S:S5,jump:true});const out5=new Float32Array(N);for(let i=0;i<N;i+=128)e5.render(out5.subarray(i,i+128),128,i/sr);
    const D5=dotList(effParams(S5,0,-1,newEff()),0.5),H5=[],P5=[];
    for(let n=1;n<=24;n++){let re=0,im=0;for(let i=sr/2;i<N;i++){const a=2*Math.PI*n*100*i/sr;re+=out5[i]*Math.cos(a);im+=out5[i]*Math.sin(a);}H5.push(Math.hypot(re,im));P5.push(heardMag(D5,n,n*100));}
    const lfoMoved=dotList(effParams(S5,0,-1,newEff()),0.5).some(o=>o.ri===0&&o.d===1&&Math.abs(o.F/700-Math.pow(2,12/12))<1e-6)&&D5.mod;
    const mh5=Math.max(...H5),mp5=Math.max(...P5);let dotErr=0;H5.forEach((h,i)=>dotErr=Math.max(dotErr,Math.abs(h/mh5-P5[i]/mp5)));
    /* wheels inside dots, three levels deep, with inner turns that overlap the next dot: the engine against the page's spectrum formula */
    const R=o=>Object.assign({on:true,steps:1,hits:1,rot:0,level:1},o),OFF={on:false,steps:1,hits:0,rot:0,level:1};
    const e6=new Engine(sr),S6=JSON.parse(JSON.stringify(S));
    const deep={rings:[R({steps:3,hits:2,dp:z16([0,-5]),da:o16([1,0.6])}),OFF,OFF,OFF]};
    const wA={rings:[R({steps:5,hits:3,rot:1,level:0.8,dp:z16([0,4,7]),dl:z16([0,-0.4]),da:o16([1,0.6,0.8]),dk:['click','wheel'],dt:[0.25,0.5],kids:[null,deep]}),R({steps:2,hits:1,level:0.5,dp:z16([12])}),OFF,OFF]};
    const wB={rings:[R({steps:7,hits:4,rot:2,dp:z16([12,0,-3,2]),da:o16([1,0,0.5,0.9])}),OFF,OFF,OFF]};
    S6.rings=[R({steps:4,hits:3,rot:1,dp:z16([0,5,-7]),dl:z16([0,0.3]),da:o16([1,0.7,0.9]),dk:['wheel','wheel','click'],dt:[0.4,0.07,0.25],kids:[wA,wB,null]}),
      R({steps:5,hits:3,rot:1,level:0.6,dp:z16([0,4,7]),dl:z16([0,-0.4]),da:o16([1,0.6,0.8])}),OFF,OFF];
    applyMsg(e6,{S:S6,jump:true});const out6=new Float32Array(N);for(let i=0;i<N;i+=128)e6.render(out6.subarray(i,i+128),128,i/sr);
    const D6=dotList(effParams(S6,0,-1,newEff()),0.5),H6=[],P6=[];
    for(let n=1;n<=24;n++){let re=0,im=0;for(let i=sr/2;i<N;i++){const a=2*Math.PI*n*100*i/sr;re+=out6[i]*Math.cos(a);im+=out6[i]*Math.sin(a);}H6.push(Math.hypot(re,im));P6.push(heardMag(D6,n,n*100));}
    const mh6=Math.max(...H6),mp6=Math.max(...P6);let nestErr=0;H6.forEach((h,i)=>nestErr=Math.max(nestErr,Math.abs(h/mh6-P6[i]/mp6)));
    /* a slow outer wheel: each inner click lands at its exact time (one dot at 2 loops/s holding a 4-hit wheel over half a loop -> clicks every 62.5 ms, from the first crossing at 0.5 s) */
    const e7=new Engine(sr),S7=JSON.parse(JSON.stringify(S));S7.base.speed=2;S7.base.sigma=0.5;
    S7.rings=[R({dk:['wheel'],dt:[0.5],kids:[{rings:[R({steps:4,hits:4}),OFF,OFF,OFF]}]}),OFF,OFF,OFF];
    applyMsg(e7,{S:S7,jump:true});const out7=new Float32Array(N);for(let i=0;i<N;i+=128)e7.render(out7.subarray(i,i+128),128,i/sr);
    const peaks=[];for(let k=0;k<4;k++){const c=Math.round((0.5+0.0625*k+0.0015)*sr);let en=0,far=0;for(let i=c-60;i<=c+60;i++)en+=out7[i]*out7[i];for(let i=c+400;i<=c+520;i++)far+=out7[i]*out7[i];peaks.push(en>1e-3&&far<en*1e-6);}
    /* a sample dot and an impulse dot. The recording is a 441 Hz sine, 1 s at 44100 Hz. Ring 1's dot plays the slice from 0.25 for 0.1 of it,
       an octave up: 50 ms of 882 Hz, starting when the dot fires at 0.5 s. Ring 2's dot is an impulse, half a loop later (0.75 s at 2 loops/s). */
    const e8=new Engine(sr),S8=JSON.parse(JSON.stringify(S));S8.base.speed=2;
    const tone=new Float32Array(44100);for(let i=0;i<tone.length;i++)tone[i]=Math.sin(2*Math.PI*441*i/44100);
    S8.rings=[R({dk:['sample'],ds:[2],dss:[0.25],dsn:[0.1],dp:z16([12])}),R({steps:2,hits:1,rot:1,dk:['impulse']}),OFF,OFF];
    applyMsg(e8,{smp:{i:2,d:tone,sr:44100}});applyMsg(e8,{S:S8,jump:true});const out8=new Float32Array(N);for(let i=0;i<N;i+=128)e8.render(out8.subarray(i,i+128),128,i/sr);
    const en=(a,b)=>{let v=0;for(let i=Math.round(a*sr);i<Math.round(b*sr);i++)v+=out8[i]*out8[i];return v;};
    const tn=(f,a,b)=>{let re=0,im=0;for(let i=Math.round(a*sr);i<Math.round(b*sr);i++){const w=2*Math.PI*f*i/sr;re+=out8[i]*Math.cos(w);im+=out8[i]*Math.sin(w);}return Math.hypot(re,im);};
    const smpIn=en(0.505,0.545),smpOut=en(0.56,0.74),smpPitch=tn(882,0.505,0.545)/(tn(441,0.505,0.545)+1e-12);
    let ipk=0,ipi=0;for(let i=Math.round(0.74*sr);i<Math.round(0.78*sr);i++)if(Math.abs(out8[i])>ipk){ipk=Math.abs(out8[i]);ipi=i;}
    const impAt=ipi/sr,impWide=en(0.752,0.78)/(en(0.749,0.752)+1e-12);
    /* instruments. One dot at 2 loops/s plays a note held for a quarter of the loop (125 ms), first crossing at 0.5 s.
       A: a sine oscillator with root A4 (440 Hz), attack 10 ms, release 50 ms. B: a 0.1 s recording looped, so it sounds for longer than it is.
       C: two dots 62.5 ms apart with long notes: Poly keeps two voices, Mono keeps one. */
    const run=(S9,pre)=>{const e=new Engine(sr);if(pre)pre(e);applyMsg(e,{S:S9,jump:true});const o=new Float32Array(N);for(let i=0;i<N;i+=128)e.render(o.subarray(i,i+128),128,i/sr);return{e,o};};
    const E2=(o,a,b)=>{let v=0;for(let i=Math.round(a*sr);i<Math.round(b*sr);i++)v+=o[i]*o[i];return v;};
    const TN=(o,f,a,b)=>{let re=0,im=0;for(let i=Math.round(a*sr);i<Math.round(b*sr);i++){const w=2*Math.PI*f*i/sr;re+=o[i]*Math.cos(w);im+=o[i]*Math.sin(w);}return Math.hypot(re,im);};
    const SI=JSON.parse(JSON.stringify(S));SI.base.speed=2;SI.rings=[R({dk:['inst'],di:[3]}),OFF,OFF,OFF];SI.inst=Array(8).fill(null);
    SI.inst[3]=Object.assign(newInst('t'),{src:'osc',wave:'sine',note:69,a:0.01,d:0.05,s:0.8,r:0.05,ft:'off',vel:1,level:1});
    const A=run(SI).o,iBefore=E2(A,0.3,0.499),iHeld=E2(A,0.52,0.62),iAfter=E2(A,0.9,0.99),iPitch=TN(A,440,0.52,0.62)/(TN(A,880,0.52,0.62)+TN(A,220,0.52,0.62)+1e-12);
    const SJ=JSON.parse(JSON.stringify(SI));SJ.inst[3]=Object.assign(newInst('t'),{src:'smp',ss:1,mode:'loop',st:0,ls:0,le:1,a:0.002,d:0.05,s:1,r:0.02,ft:'off',vel:1,level:1});
    const short=new Float32Array(4410);for(let i=0;i<short.length;i++)short[i]=Math.sin(2*Math.PI*400*i/44100);
    const Bo=run(SJ,e=>applyMsg(e,{smp:{i:1,d:short,sr:44100}})).o,loopLate=E2(Bo,0.605,0.62),loopEnd=E2(Bo,0.75,0.9);
    SJ.inst[3].mode='held';const Ho=run(SJ,e=>applyMsg(e,{smp:{i:1,d:short,sr:44100}})).o,heldLate=E2(Ho,0.605,0.62);
    const SK=JSON.parse(JSON.stringify(SI));SK.rings=[R({steps:8,hits:2,dk:['inst','inst'],di:[3,3],dl:z16([2,2]),dp:z16([0,7])}),OFF,OFF,OFF];
    const voices=vm=>{SK.inst[3].vm=vm;const e=new Engine(sr);applyMsg(e,{S:SK,jump:true});const o=new Float32Array(128);let mx=0;for(let i=0;i<Math.round(0.6*sr);i+=128){e.render(o,128,i/sr);mx=Math.max(mx,e.vo.filter(v=>v.on).length);}return mx;};
    const vPoly=voices('poly'),vMono=voices('mono'),vLeg=voices('legato');
    SI.inst[3].ft='lp';SI.inst[3].fc=200;SI.inst[3].fe=0;SI.inst[3].fk=0;SI.inst[3].wave='saw';SI.inst[3].note=45;const Lp=run(SI).o;
    SI.inst[3].ft='off';const Lo=run(SI).o,filtCut=TN(Lp,1100,0.52,0.62)/(TN(Lo,1100,0.52,0.62)+1e-12);
    /* wavetable and modulators, on the same one-note pattern (root A4 = 440 Hz) */
    const WT=(o)=>{const X=JSON.parse(JSON.stringify(SI));X.inst[3]=Object.assign(newInst('t'),{src:'wt',wt:'saw',wp:0,note:69,a:0.005,d:0.05,s:1,r:0.03,ft:'off',vel:1,level:1},o);return X;};
    const flat=v=>Object.assign(newMod('draw'),{pts:Array(16).fill(v),sync:'note',depth:0.5});
    const w0=run(WT({wp:0})).o,w1=run(WT({wp:1})).o,wtSine=TN(w0,880,0.52,0.62)/(TN(w0,440,0.52,0.62)+1e-12),wtSaw=TN(w1,880,0.52,0.62)/(TN(w1,440,0.52,0.62)+1e-12);
    const mq=run(WT({mods:[Object.assign(flat(1),{dest:'pitch'}),null,null,null]})).o,modPitch=TN(mq,880,0.52,0.62)/(TN(mq,440,0.52,0.62)+1e-12);
    const mwp=run(WT({mods:[Object.assign(flat(1),{dest:'wp',depth:1}),null,null,null]})).o,modPos=TN(mwp,880,0.52,0.62)/(TN(mwp,440,0.52,0.62)+1e-12);
    const mrl=run(WT({mods:[Object.assign(flat(1),{dest:'r',depth:1}),null,null,null]})).o,modRel=E2(mrl,0.70,0.80)/(E2(w0,0.70,0.80)+1e-12);
    const XW=WT({mods:[Object.assign(newMod('wheel'),{ring:1,val:'dp',dest:'pitch',depth:1}),null,null,null]});XW.rings[1]=R({level:0,dp:z16([12])});
    const mhw=run(XW).o,modWheel=TN(mhw,880,0.52,0.62)/(TN(mhw,440,0.52,0.62)+1e-12);
    const XR=WT({mods:[Object.assign(newMod('rand'),{dest:'pitch',depth:1}),null,null,null]}),er9=run(XR).e,randSet=er9.vo.some(v=>v.rv[0]!==0);
    /* the fuller instrument: each change is made to a plain 440 Hz sine and found in the spectrum of the held note */
    const OS=o=>{const X=JSON.parse(JSON.stringify(SI));X.inst[3]=Object.assign(newInst('t'),{src:'osc',wave:'sine',note:69,a:0.005,d:0.05,s:1,r:0.03,ft:'off',vel:1,level:1},o);return X;};
    const BIN=(o,f)=>TN(o,f,0.52,0.62),base=run(OS({})).o,b440=BIN(base,440);
    const f2={o2:BIN(run(OS({o2l:1,o2w:'sine',o2s:12,o2f:0})).o,880)/b440,fm:BIN(run(OS({fm:1,o2w:'sine',o2s:12,o2f:0})).o,1320)/b440,ring:BIN(run(OS({ring:1,o2w:'sine',o2s:12,o2f:0})).o,1320)/b440,
      sub:BIN(run(OS({sub:1})).o,220)/b440,drive:BIN(run(OS({drive:1})).o,1320)/b440,clean:BIN(base,1320)/b440+BIN(base,880)/b440+BIN(base,220)/b440};
    const eu=run(OS({uni:3,udet:50})).e,uv=eu.vo.find(v=>v.I),uniOk=uv.un===3&&uv.ur[0]<0.99&&Math.abs(uv.ur[1]-1)<1e-9&&uv.ur[2]>1.01;
    const saw=o=>OS(Object.assign({wave:'saw',note:45,fe:0,fk:0,fq:0.2},o)),s0=BIN(run(saw({})).o,1100);
    const fl={lp:BIN(run(saw({ft:'lp',fc:200})).o,1100)/s0,lp4:BIN(run(saw({ft:'lp4',fc:200})).o,1100)/s0,notch:BIN(run(OS({ft:'nt',fc:440,fe:0,fk:0,fq:0})).o,440)/b440};
    const comb=run(saw({ft:'cb',fc:440,fq:0.8})).o,combOk=comb.every(isFinite)&&E2(comb,0.52,0.62)>0.5;
    const lp=o=>run(OS(Object.assign({a:0.005,d:0.02,s:0},o))).o,loopOn=E2(lp({eloop:true}),0.59,0.62),loopOff=E2(lp({}),0.59,0.62);
    const straight=E2(run(OS({elin:true,r:0.03})).o,0.67,0.8);
    const presetsOk=INST_PRESETS.every(([n,o])=>{const X=OS({});X.inst[3]=sanInst(Object.assign(newInst(n),o));const r=run(X).o;return r.every(isFinite)&&E2(r,0.5,0.99)>0.01;});
    return{f2,uniOk,fl,combOk,loopOn,loopOff,straight,presetsOk,wtSine,wtSaw,modPitch,modPos,modRel,modWheel,randSet,iBefore,iHeld,iAfter,iPitch,loopLate,loopEnd,heldLate,vPoly,vMono,vLeg,filtCut,smpIn,smpOut,smpPitch,impAt,ipk,impWide,err,leak,stepOk,pitchErr,rest,stress,dotErr,lfoMoved,dots:D5.length,nestErr,nestDots:D6.length,nestTimes:peaks.every(Boolean),e6drop:e6.dropped,worklet:WORKLET_SRC.length};
  });
  check('engine harmonics match divisor sums x click spectrum',m.err<0.01,'max error '+m.err.toFixed(4));
  check('no energy between harmonics',m.leak<1e-6,m.leak.toExponential(1));
  check('per-dot pitch, length, level and dot LFOs match the spectrum formula',m.dotErr<0.01&&m.dots===6&&m.lfoMoved,'max error '+m.dotErr.toFixed(4)+', '+m.dots+' sounding dots, LFO applied: '+m.lfoMoved);
  check('wheels inside dots match the spectrum formula',m.nestErr<0.01&&m.nestDots===12&&m.e6drop===0,'max error '+m.nestErr.toFixed(4)+', '+m.nestDots+' sounding clicks');
  check('inner-wheel clicks land at their exact times',m.nestTimes);
  check('a sample dot plays its slice at the right time and speed',m.smpIn>1&&m.smpOut<m.smpIn*1e-6&&m.smpPitch>20,'energy '+m.smpIn.toFixed(1)+' in the slice, '+m.smpOut.toExponential(1)+' after it, 882 Hz over 441 Hz = '+m.smpPitch.toFixed(0));
  check('an impulse dot is one short spike at the right time',m.ipk>0.1&&Math.abs(m.impAt-(0.75+8/48000))<2/48000&&m.impWide<1e-6,'peak '+m.ipk.toFixed(2)+' at '+m.impAt.toFixed(5)+' s');
  check('an instrument dot plays a note with its envelope',m.iBefore<1e-9&&m.iHeld>1&&m.iAfter<m.iHeld*1e-5&&m.iPitch>20,'energy '+m.iHeld.toFixed(1)+' while held, '+m.iAfter.toExponential(1)+' after the release, 440 Hz over its neighbours = '+m.iPitch.toFixed(0));
  check('a looped sample outlasts its recording; a held one stops at its end',m.loopLate>0.5&&m.heldLate<m.loopLate*1e-4&&m.loopEnd<m.loopLate*1e-5,'looped '+m.loopLate.toFixed(2)+', held '+m.heldLate.toExponential(1)+', after release '+m.loopEnd.toExponential(1));
  check('poly keeps overlapping notes, mono and legato keep one voice',m.vPoly===2&&m.vMono===1&&m.vLeg===1,'voices: poly '+m.vPoly+', mono '+m.vMono+', legato '+m.vLeg);
  check('the low-pass filter removes the high harmonics',m.filtCut<0.1,'harmonic at 1.1 kHz kept: '+(m.filtCut*100).toFixed(1)+'%');
  check('a wavetable morphs from a sine to a saw with Position',m.wtSine<0.01&&m.wtSaw>0.4&&m.wtSaw<0.6,'2nd harmonic: '+m.wtSine.toFixed(3)+' at position 0, '+m.wtSaw.toFixed(2)+' at position 1');
  check('a drawn modulator moves pitch and wavetable position',m.modPitch>20&&m.modPos>0.4,'pitch up an octave: 880 over 440 = '+m.modPitch.toFixed(0)+'; position: 2nd harmonic '+m.modPos.toFixed(2));
  check('a modulator on Release lengthens the note',m.modRel>100,'energy after the note, with over without: '+m.modRel.toExponential(1));
  check('a wheel modulator reads a ring\'s dots; a random one draws a value per note',m.modWheel>20&&m.randSet,'880 over 440 = '+m.modWheel.toFixed(0));
  check('second oscillator, FM, ring, sub and drive each add their partials',m.f2.o2>0.8&&m.f2.fm>0.1&&m.f2.ring>0.3&&m.f2.sub>0.8&&m.f2.drive>0.05&&m.f2.clean<0.01,'osc 2 '+m.f2.o2.toFixed(2)+', FM '+m.f2.fm.toFixed(2)+', ring '+m.f2.ring.toFixed(2)+', sub '+m.f2.sub.toFixed(2)+', drive '+m.f2.drive.toFixed(2)+', plain sine '+m.f2.clean.toFixed(4));
  check('unison spreads its copies in pitch',m.uniOk);
  check('the 24 dB low-pass cuts more than the 12 dB one; the notch removes its frequency; the comb is stable',m.fl.lp4<m.fl.lp*0.3&&m.fl.notch<0.05&&m.combOk,'1.1 kHz kept: 12 dB '+(m.fl.lp*100).toFixed(1)+'%, 24 dB '+(m.fl.lp4*100).toFixed(2)+'%; notch keeps '+(m.fl.notch*100).toFixed(1)+'%');
  check('a looping envelope keeps repeating while held; a straight release ends on time',m.loopOn>m.loopOff*100&&m.loopOn>0.01&&m.straight<1e-9,'late in the note: loop '+m.loopOn.toFixed(3)+', no loop '+m.loopOff.toExponential(1)+'; after a straight release '+m.straight.toExponential(1));
  check('every preset makes a sound',m.presetsOk);
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
  await inst.$eval('label[for=F]',el=>el.dispatchEvent(new MouseEvent('click',{altKey:true,bubbles:true,cancelable:true})));await inst.click('#mLfo summary');await inst.click('#scatter');await inst.click('#mLfo summary');await inst.waitForTimeout(300);
  check('LFOs can be added',/active/.test(await inst.textContent('#lfoCount'))&&!/none/.test(await inst.textContent('#lfoCount')));
  await inst.screenshot({path:path.join(OUT,'instrument-desktop.png'),fullPage:true});
  await inst.$eval('#reset',el=>{el.click();el.click();});await inst.waitForTimeout(200);
  check('Reset patch clears LFOs and restores speed',/none/.test(await inst.textContent('#lfoCount'))&&(await inst.evaluate(()=>state.base.speed))===0.5);
  await inst.evaluate(()=>{state.base.speed=110;});await inst.$eval('#F',el=>el.dispatchEvent(new Event('input')));await inst.waitForTimeout(700);
  const p2=await ctx.newPage();await p2.goto(BASE);await p2.waitForTimeout(400);
  check('settings survive a reload',(await p2.evaluate(()=>state.base.speed))===110);await p2.close();

  /* 4b. clicking a dot on the wheel opens its editor */
  await inst.$eval('#reset',el=>{el.click();el.click();});await inst.waitForTimeout(300);
  await inst.evaluate(()=>document.querySelector('#wheel').scrollIntoView({block:'center'}));await inst.waitForTimeout(150);
  {const wb=await (await inst.$('#wheel')).boundingBox(),R=Math.min(wb.width,wb.height)/2-34,gap=(R-R*0.3)/4;
    await inst.mouse.click(wb.x+wb.width/2,wb.y+wb.height/2-(R-gap*0.15));await inst.waitForTimeout(250);
    check('clicking a dot selects it',/Ring 1 · dot 1 of 1/.test(await inst.textContent('#dotTitle')),await inst.textContent('#dotTitle'));
    await inst.$eval('#dP',el=>{el.value=7;el.dispatchEvent(new Event('input'));});
    await inst.$eval('#dA',el=>{el.value=40;el.dispatchEvent(new Event('input'));});await inst.waitForTimeout(200);
    check('dot pitch and level are stored',await inst.evaluate(()=>state.rings[0].dp[0]===7&&state.rings[0].da[0]===0.4));
    await inst.$eval('label[for=dP]',el=>el.dispatchEvent(new MouseEvent('click',{altKey:true,bubbles:true,cancelable:true})));await inst.waitForTimeout(200);
    check('a dot LFO can be added',await inst.evaluate(()=>state.rings[0].pld[0]===2&&!document.querySelector('#dlfo-p').hidden)&&/1 active/.test(await inst.textContent('#lfoCount')));
    await inst.screenshot({path:path.join(OUT,'instrument-dot.png')});
    await inst.click('#dK [data-k="wheel"]');await inst.$eval('#dT',el=>{el.value=500;el.dispatchEvent(new Event('input'));});await inst.waitForTimeout(250);
    check('a wheel can be put inside a dot',await inst.evaluate(()=>state.rings[0].dk[0]==='wheel'&&!!state.rings[0].kids[0]&&Math.abs(state.rings[0].dt[0]-0.5)<1e-9&&!document.querySelector('#dTc').hidden)&&/wheel/.test(await inst.textContent('#dWv'))&&/0\.50 loop/.test(await inst.textContent('#dTv')),await inst.textContent('#dWv')+' | '+await inst.textContent('#dTv'));
    await inst.screenshot({path:path.join(OUT,'instrument-wheel-in-dot.png')});
    await inst.click('#dOpen');await inst.waitForTimeout(250);
    check('the wheel inside a dot opens',/Top.*Ring 1 · dot 1/.test(await inst.textContent('#path'))&&(await inst.textContent('#r0stepsv'))==='4'&&await inst.evaluate(()=>document.querySelector('#pRings').dataset.inner==='true'),await inst.textContent('#path'));
    await inst.click('#ring0 .stepper button:last-child');await inst.waitForTimeout(200);
    check('ring controls edit the open wheel, not the top one',await inst.evaluate(()=>state.rings[0].kids[0].rings[0].steps===5&&state.rings[0].steps===1));
    {const wb2=await (await inst.$('#wheel')).boundingBox(),R2=Math.min(wb2.width,wb2.height)/2-34,gap2=(R2-R2*0.3)/1;
      await inst.mouse.click(wb2.x+wb2.width/2,wb2.y+wb2.height/2-(R2-gap2*0.15));await inst.waitForTimeout(200);
      await inst.click('#dK [data-k="wheel"]');await inst.click('#dOpen');await inst.waitForTimeout(250);
      check('wheels keep opening further down',/Ring 1 · dot 1.*Ring 1 · dot 1/.test(await inst.textContent('#path'))&&await inst.evaluate(()=>!!state.rings[0].kids[0].rings[0].kids[0]),await inst.textContent('#path'));
      await inst.screenshot({path:path.join(OUT,'instrument-inner-wheel.png')});}
    await inst.click('#path button');await inst.waitForTimeout(250);
    check('the path leads back to the top wheel',await inst.evaluate(()=>document.querySelector('#path').hidden&&document.querySelector('#pRings').dataset.inner==='false')&&(await inst.textContent('#r0stepsv'))==='1');
    await inst.evaluate(()=>document.querySelector('#wheel').scrollIntoView({block:'center'}));await inst.waitForTimeout(150);   /* the sticky top bar must not sit over the dot */
    {const wb3=await (await inst.$('#wheel')).boundingBox(),R3=Math.min(wb3.width,wb3.height)/2-34,gap3=(R3-R3*0.3)/4;
      await inst.mouse.click(wb3.x+wb3.width/2,wb3.y+wb3.height/2-(R3-gap3*0.15));await inst.waitForTimeout(200);}
    {const sr2=22050,n=sr2/2,buf=Buffer.alloc(44+n*2);buf.write('RIFF',0);buf.writeUInt32LE(36+n*2,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);
      buf.writeUInt32LE(sr2,24);buf.writeUInt32LE(sr2*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(n*2,40);
      for(let i=0;i<n;i++)buf.writeInt16LE(Math.round(12000*Math.sin(2*Math.PI*330*i/sr2)*Math.exp(-i/3000)),44+i*2);
      await (await inst.$$('#smps input[type=file]'))[1].setInputFiles({name:'ping.wav',mimeType:'audio/wav',buffer:buf});await inst.waitForTimeout(900);
      check('an audio file loads into a sample slot',await inst.evaluate(()=>!!samples[1]&&samples[1].name==='ping.wav'&&Math.abs(samples[1].d.length/samples[1].sr-0.5)<0.01),await inst.textContent('#smpNote'));
      await inst.click('#dK [data-k="sample"]');await inst.click('#dSl [data-s="1"]');
      await inst.$eval('#dSs',el=>{el.value=250;el.dispatchEvent(new Event('input'));});await inst.waitForTimeout(300);
      check('a dot can be set to play a sample',await inst.evaluate(()=>state.rings[0].dk[0]==='sample'&&state.rings[0].ds[0]===1&&state.rings[0].dss[0]===0.25&&!document.querySelector('#dSc').hidden)&&/ping\.wav/.test(await inst.textContent('#dSlv'))&&/125/.test(await inst.textContent('#dSsv')),await inst.textContent('#dSlv')+' | start '+await inst.textContent('#dSsv')+' | slice '+await inst.textContent('#dSnv'));
      await inst.screenshot({path:path.join(OUT,'instrument-sample-dot.png')});
      const kept=await ctx.newPage();await kept.goto(BASE);await kept.waitForTimeout(700);
      check('samples are kept by the browser across a reload',await kept.evaluate(()=>!!samples[1]&&samples[1].name==='ping.wav'));await kept.close();
      await inst.evaluate(()=>{state.base.speed=4;});await inst.$eval('#dA',el=>{el.value=100;el.dispatchEvent(new Event('input'));});await inst.waitForTimeout(1500);
      check('the scope shows the measured signal',/last 4 s/.test(await inst.textContent('#stWin'))&&parseFloat(await inst.textContent('#stPeak'))>0.01,await inst.textContent('#stWin')+' · peak '+await inst.textContent('#stPeak'));
      check('Impulse is no longer offered for a dot',await inst.evaluate(()=>!document.querySelector('#dK [data-k="impulse"]')&&document.querySelectorAll('#dK button').length===4));
      await inst.click('#sndTabs [data-t="smp"]');await inst.click('#smps .smp:nth-child(2) [data-x]');await inst.waitForTimeout(200);
      check('a sample slot can be cleared',await inst.evaluate(()=>samples[1]===null));}
    {await inst.click('#dK [data-k="inst"]');await inst.click('#dIl [data-s="2"]');await inst.waitForTimeout(200);
      check('a dot can be set to play an instrument',await inst.evaluate(()=>state.rings[0].dk[0]==='inst'&&state.rings[0].di[0]===2&&!!state.inst[2]&&!document.querySelector('#dIc').hidden)&&/Instrument 3/.test(await inst.textContent('#dIlv')),await inst.textContent('#dIlv')+' | '+await inst.textContent('#dPv')+' | '+await inst.textContent('#dLv'));
      const iw=await ctx.newPage();watch(iw,'instrument window');await iw.goto(BASE+'#instrument-3');await iw.waitForTimeout(700);
      check('the instrument window loads the slot from the main window',await iw.inputValue('#i-name')==='Instrument 3'&&/Saved in the patch/.test(await iw.textContent('#i-stat')),await iw.textContent('#i-stat'));
      await iw.click('[data-seg="wave"] [data-v="square"]');await iw.$eval('#i-a',el=>{el.value=500;el.dispatchEvent(new Event('input'));});
      await iw.fill('#i-name','Glass bell');await iw.click('[data-seg="vm"] [data-v="mono"]');await iw.waitForTimeout(400);
      const got=await inst.evaluate(()=>state.inst[2]);
      check('edits in the instrument window reach the patch',got.wave==='square'&&got.name==='Glass bell'&&got.vm==='mono'&&got.a>0.05&&got.a<0.1,got.name+' · '+got.wave+' · '+got.vm+' · attack '+got.a.toFixed(3)+' s');
      check('the main window lists the instrument by name',/Glass bell/.test(await inst.textContent('#insts'))&&/Glass bell/.test(await inst.textContent('#dIlv')));
      await iw.click('#i-aud');await iw.waitForTimeout(200);
      await iw.click('[data-seg="src"] [data-v="smp"]');await iw.click('[data-seg="mode"] [data-v="loop"]');await iw.waitForTimeout(300);
      check('the sample source shows its play modes',await iw.evaluate(()=>!document.querySelector('#i-play').hidden&&document.querySelector('#i-osc').hidden&&!document.querySelector('#i-ls').closest('.ctl').hidden)&&(await inst.evaluate(()=>state.inst[2].src+state.inst[2].mode))==='smploop',await iw.textContent('#i-modeNote'));
      await iw.selectOption('#i-preset','3');await iw.waitForTimeout(300);
      check('a preset loads into the slot',await inst.evaluate(()=>state.inst[2].name==='Bell'&&state.inst[2].fm===0.6&&state.inst[2].o2s===14),await iw.textContent('#i-stat'));
      await iw.click('[data-seg="eloop"] [data-v="true"]');await iw.click('[data-seg="ft"] [data-v="cb"]');await iw.$eval('#i-uni',el=>{});await iw.$eval('#i-drive',el=>{el.value=500;el.dispatchEvent(new Event('input'));});await iw.waitForTimeout(300);
      check('the new controls reach the patch',await inst.evaluate(()=>state.inst[2].eloop===true&&state.inst[2].ft==='cb'&&Math.abs(state.inst[2].drive-0.5)<0.01));
      await iw.fill('#i-name','Glass bell');
      await iw.click('[data-seg="src"] [data-v="wt"]');await iw.click('[data-seg="wt"] [data-v="formant"]');
      await iw.click('.mod[data-q="0"] [data-mseg="type"] [data-v="draw"]');await iw.selectOption('#m0-dest','wp');await iw.click('.mod[data-q="0"] [data-mseg="sync"] [data-v="loop"]');
      await iw.click('.mod[data-q="1"] [data-mseg="type"] [data-v="wheel"]');await iw.waitForTimeout(400);
      {const cb=await (await iw.$('.mod[data-q="0"] canvas')).boundingBox();await iw.mouse.click(cb.x+cb.width*0.5,cb.y+8);await iw.waitForTimeout(300);}
      const gm=await inst.evaluate(()=>state.inst[2]);
      check('the wavetable source and the modulators reach the patch',gm.src==='wt'&&gm.wt==='formant'&&gm.mods[0]&&gm.mods[0].type==='draw'&&gm.mods[0].dest==='wp'&&gm.mods[0].sync==='loop'&&gm.mods[0].pts[8]>0.9&&gm.mods[1]&&gm.mods[1].type==='wheel'&&gm.mods[2]===null,gm.src+' '+gm.wt+' · mod 1 '+(gm.mods[0]&&gm.mods[0].type)+' to '+(gm.mods[0]&&gm.mods[0].dest)+', point 9 = '+(gm.mods[0]&&gm.mods[0].pts[8])+' · mod 2 '+(gm.mods[1]&&gm.mods[1].type));
      await iw.screenshot({path:path.join(OUT,'instrument-window.png'),fullPage:true});
      await iw.setViewportSize({width:390,height:800});await iw.waitForTimeout(200);
      check('the instrument window at 390 px has no sideways scroll',await iw.evaluate(()=>document.documentElement.scrollWidth)<=390);
      await iw.close();
      const saved=await inst.evaluate(()=>{saveNow();return JSON.parse(localStorage.getItem('rit-state-v1')).inst[2].name;});
      check('instruments are saved with the patch',saved==='Glass bell');}
    {check('choosing Instrument for a dot shows the Instruments list',await inst.evaluate(()=>!document.querySelector('#sndInst').hidden&&document.querySelector('#sndClk').hidden));
      await inst.click('#sndTabs [data-t="shp"]');await inst.waitForTimeout(150);
      const cb=await (await inst.$('#shpCv')).boundingBox();await inst.mouse.move(cb.x+4,cb.y+10);await inst.mouse.down();await inst.mouse.move(cb.x+cb.width-4,cb.y+cb.height-10,{steps:6});await inst.mouse.up();await inst.waitForTimeout(200);
      const sh=await inst.evaluate(()=>state.shapes[0]);
      check('drawing makes a custom LFO shape',!!sh&&sh.pts.length===32&&sh.pts[0]>0.8&&sh.pts[31]<-0.8&&sh.pts[15]<sh.pts[5]&&sh.pts[15]>sh.pts[26],sh?sh.name+': '+sh.pts[0]+' … '+sh.pts[15]+' … '+sh.pts[31]:'none');
      await inst.$eval('label[for=F]',el=>el.dispatchEvent(new MouseEvent('click',{altKey:true,bubbles:true,cancelable:true})));await inst.waitForTimeout(150);
      check('the shape appears in every LFO',await inst.evaluate(()=>{const a=[...document.querySelectorAll('.shapes [data-u="0"]')];return a.length>10&&a.every(b=>!b.hidden)&&[...document.querySelectorAll('.shapes [data-u="1"]')].every(b=>b.hidden);}));
      await inst.$eval('#lfo-F [data-shape="U1"]',el=>el.click());await inst.$eval('#ld-F',el=>{el.value=el.max;el.dispatchEvent(new Event('input'));});await inst.waitForTimeout(150);
      const lv=await inst.evaluate(()=>{const L={shape:'U1',rate:1,seed:0};return{sel:state.lfo.F.shape,a:lfoVal(L,0.01),b:lfoVal(L,0.5),c:lfoVal(L,0.97),none:lfoVal({shape:'U5',rate:1,seed:0},0.3)};});
      check('an LFO can use the custom shape',lv.sel==='U1'&&lv.a>0.7&&Math.abs(lv.b)<0.25&&lv.c<-0.7&&lv.none===0,'start '+lv.a.toFixed(2)+', middle '+lv.b.toFixed(2)+', end '+lv.c.toFixed(2));
      await inst.$eval('#lfo-F [data-x]',el=>el.click());
      const fits=async w=>{await inst.setViewportSize({width:w,height:900});await inst.waitForTimeout(250);return inst.evaluate(()=>{const bad=[];document.querySelectorAll('#rings .ring').forEach((r,ri)=>{const it=[...r.querySelectorAll('.head label,.stepper,.lvl input,.lvl output')].filter(e=>e.offsetParent).map(e=>e.getBoundingClientRect());
          for(let i=0;i<it.length;i++)for(let j=i+1;j<it.length;j++){const a=it[i],b=it[j];if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)bad.push(ri);}
          const rb=r.getBoundingClientRect();it.forEach(a=>{if(a.right>rb.right+1||a.left<rb.left-1)bad.push('out'+ri);});});return bad.length;});};
      const ov=[];for(const w of[1024,1180,1240,1280,1366,1440,1680])ov.push(w+':'+await fits(w));await inst.setViewportSize({width:1280,height:900});await inst.waitForTimeout(200);
      check('nothing in the rings panel overlaps at common window widths',ov.every(x=>/:0$/.test(x)),ov.join(' '));}
    {const sw=await ctx.newPage();watch(sw,'sample window');await sw.goto(BASE+'#sample-5');await sw.waitForTimeout(600);
      const sr2=22050,n=sr2,buf=Buffer.alloc(44+n*2);buf.write('RIFF',0);buf.writeUInt32LE(36+n*2,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);
      buf.writeUInt32LE(sr2,24);buf.writeUInt32LE(sr2*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(n*2,40);
      for(let i=0;i<n;i++)buf.writeInt16LE(Math.round(13000*Math.sin(2*Math.PI*330*i/sr2)*(i<n/2?1:0.5)),44+i*2);
      await sw.setInputFiles('#s-file',{name:'tone.wav',mimeType:'audio/wav',buffer:buf});await sw.waitForTimeout(900);
      const mainHas=()=>inst.evaluate(()=>samples[4]?{name:samples[4].name,sec:samples[4].d.length/samples[4].sr,pk:samples[4].d.reduce((m,v)=>Math.max(m,Math.abs(v)),0),first:Math.abs(samples[4].d[2000]),last:Math.abs(samples[4].d[samples[4].d.length-2000]),lp:samples[4].lp}:null);
      let mh=await mainHas();
      check('a file loaded in the sample window reaches the main window',!!mh&&mh.name==='tone.wav'&&Math.abs(mh.sec-1)<0.02,mh?mh.name+' · '+mh.sec.toFixed(2)+' s':'missing');
      await sw.click('#s-detect');await sw.waitForTimeout(200);
      check('the pitch of a recording is detected',/E4/.test(await sw.textContent('#s-pitch')),await sw.textContent('#s-pitch'));
      const wb=await (await sw.$('#s-wave')).boundingBox();
      await sw.mouse.move(wb.x+wb.width*0.25,wb.y+40);await sw.mouse.down();await sw.mouse.move(wb.x+wb.width*0.75,wb.y+60,{steps:5});await sw.mouse.up();await sw.waitForTimeout(200);
      check('dragging on the waveform selects a part',/\(5\d\d\.\d ms\)/.test(await sw.textContent('#s-sel')),await sw.textContent('#s-sel'));
      await sw.click('[data-op="loop"]');await sw.waitForTimeout(400);mh=await mainHas();
      check('a loop set from the selection is stored with the sample',!!mh.lp&&Math.abs(mh.lp[0]-0.25)<0.02&&Math.abs(mh.lp[1]-0.75)<0.02,mh.lp?mh.lp.map(v=>v.toFixed(3)).join(' – '):'none');
      await sw.click('[data-op="trim"]');await sw.waitForTimeout(400);mh=await mainHas();
      check('Trim keeps only the selection',Math.abs(mh.sec-0.5)<0.02,mh.sec.toFixed(3)+' s');
      await sw.click('[data-op="norm"]');await sw.waitForTimeout(400);mh=await mainHas();
      check('Normalise brings the peak to full level',mh.pk>0.96&&mh.pk<=1,'peak '+mh.pk.toFixed(3));
      await sw.click('[data-op="rev"]');await sw.waitForTimeout(400);mh=await mainHas();
      check('Reverse swaps the quiet and loud halves',mh.first<mh.last*0.7,'start '+mh.first.toFixed(2)+', end '+mh.last.toFixed(2));
      await sw.click('[data-op="dbl"]');await sw.waitForTimeout(400);mh=await mainHas();
      check('Double speed halves the length',Math.abs(mh.sec-0.25)<0.02,mh.sec.toFixed(3)+' s');
      await sw.click('#s-undo');await sw.click('#s-undo');await sw.waitForTimeout(500);mh=await mainHas();
      check('Undo steps back through the edits',Math.abs(mh.sec-0.5)<0.02&&mh.first>mh.last,mh.sec.toFixed(3)+' s');
      await sw.click('#s-send [data-s="6"]');await sw.waitForTimeout(400);
      check('Send copies the recording to another slot',await inst.evaluate(()=>!!samples[6]&&Math.abs(samples[6].d.length/samples[6].sr-0.5)<0.02&&/copy/.test(samples[6].name)));
      await sw.click('[data-split="2"]');await sw.waitForTimeout(500);
      check('Split fills empty slots with equal parts',await inst.evaluate(()=>[0,1,2,3,5,7].filter(k=>samples[k]&&/\d\/2$/.test(samples[k].name)&&Math.abs(samples[k].d.length/samples[k].sr-0.25)<0.02).length===2),await sw.textContent('#s-stat'));
      await inst.evaluate(()=>{state.rings[0].dk[0]='sample';state.rings[0].ds[0]=4;bus.post({type:'smp-hello'});});await sw.waitForTimeout(300);
      check('the window lists what plays the slot',/Top · Ring 1 · dot 1/.test(await sw.textContent('#s-users')),await sw.textContent('#s-users'));
      await sw.click('#s-slots [data-s="5"]');await sw.click('#s-src [data-v="out"]');await sw.click('#s-rec');await sw.waitForTimeout(900);await sw.click('#s-recstop');await sw.waitForTimeout(700);
      const ro=await inst.evaluate(()=>samples[5]?{sec:samples[5].d.length/samples[5].sr,e:samples[5].d.reduce((m,v)=>m+v*v,0),name:samples[5].name}:null);
      check('the app\'s output can be recorded into a slot',!!ro&&ro.sec>0.4&&ro.sec<1.6&&ro.e>0.001&&/Recorded/.test(await sw.textContent('#s-stat')),ro?ro.name+' · '+ro.sec.toFixed(2)+' s · energy '+ro.e.toFixed(3):await sw.textContent('#s-stat'));
      await sw.screenshot({path:path.join(OUT,'sample-window.png'),fullPage:true});
      await sw.setViewportSize({width:390,height:800});await sw.waitForTimeout(200);
      check('the sample window at 390 px has no sideways scroll',await sw.evaluate(()=>document.documentElement.scrollWidth)<=390);
      await sw.close();
      await inst.evaluate(()=>{state.rings[0].dk[0]='click';for(const k of[0,2,3,4,5,6,7]){samples[k]=null;smpStore(k);}});await inst.waitForTimeout(300);}
    await inst.click('#dotReset');await inst.keyboard.press('Escape');await inst.waitForTimeout(150);
    check('Reset dot and Esc clear the editor',await inst.evaluate(()=>state.rings[0].dp[0]===0&&state.rings[0].da[0]===1&&state.rings[0].pld[0]===0&&state.rings[0].dk[0]==='click'&&state.rings[0].kids[0]===null&&document.querySelector('#dotEd').hidden));}
    {
      await inst.evaluate(()=>{const r=state.rings[1];r.dk[0]='wheel';r.kids[0]=newWheel();r.kids[0].rings[0].dk[1]='wheel';r.kids[0].rings[0].kids[1]=newWheel();});await inst.waitForTimeout(300);
      const rows=await inst.$$eval('#map .maprow',els=>els.map(e=>e.textContent));
      check('the map lists every wheel',rows.length===3&&/^Top/.test(rows[0])&&/Ring 2 · dot 1/.test(rows[1])&&/Ring 1 · dot 2/.test(rows[2]),rows.join(' | '));
      await inst.click('#map .maprow:nth-child(3)');await inst.waitForTimeout(250);
      check('clicking the map opens that wheel',/Ring 2 · dot 1.*Ring 1 · dot 2/.test(await inst.textContent('#path'))&&await inst.$eval('#map .maprow:nth-child(3)',e=>e.dataset.cur==='true'),await inst.textContent('#path'));
      await inst.click('#map .maprow:nth-child(1)');await inst.waitForTimeout(200);
      await inst.click('#mView summary');await inst.click('#showCirc');await inst.waitForTimeout(150);
      check('the Circles panel can be shown from the View menu',await inst.evaluate(()=>!document.querySelector('#pCirc').hidden));
      await inst.click('#showCirc');await inst.click('#mView summary');
      check('LFO buttons are hidden until needed, and Volume sits in the top bar',await inst.evaluate(()=>getComputedStyle(document.querySelector('.lfob[data-key=r1hits]')).visibility==='hidden'&&!!document.querySelector('#tbVol #O')&&!!document.querySelector('#tuneCtls #D')));
      await inst.evaluate(()=>{state.rings[1].dk[0]='click';state.rings[1].kids[0]=null;});await inst.waitForTimeout(150);}

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


  /* 7. sample playback, pause, sections and the track, dot LFOs */
  {await inst.close();const p=await ctx.newPage();watch(p,'track page');await p.goto(BASE+'#sequencer');await p.waitForTimeout(300);   /* the sequencer page does not save the patch as it leaves */
    await p.evaluate(()=>{try{localStorage.clear();}catch(e){}});await p.goto('about:blank');await p.goto(BASE);await p.waitForTimeout(500);
    const r=await p.evaluate(()=>{
      const sr=48000,z=()=>({on:false,steps:1,hits:0,rot:0,level:1}),R=o=>Object.assign(sanRing({on:true,steps:1,hits:1},mkRing(1,1,true),0),o);
      const base=()=>{const S=sanitizeState(null);S.base.speed=2;S.base.sigma=0.5;S.rings=[R({}),z(),z(),z()].map((x,i)=>sanRing(x,mkRing(1,1,false),0));return S;};
      const run=(e,sec,t0)=>{const n=Math.round(sec*sr/128)*128,o=new Float32Array(n);for(let i=0;i<n;i+=128)e.render(o.subarray(i,i+128),128,(t0||0)+i/sr);return o;};
      const en=(o,a,b)=>{let v=0;for(let i=Math.round(a*sr);i<Math.round(b*sr)&&i<o.length;i++)v+=o[i]*o[i];return v;};
      const tone=new Float32Array(48000*2);for(let i=0;i<tone.length;i++)tone[i]=0.5*Math.sin(2*Math.PI*300*i/48000);
      const out={};
      /* cut: a 2 s recording fired 8 times a second. With Cut only the newest hit (and one fading) sounds; with Overlap they pile up. */
      const mk=(cut,extra)=>{const S=base();S.base.speed=8;S.rings[0].dk[0]='sample';S.rings[0].ds[0]=3;S.smpp[3]=sanSmpPlay(Object.assign({cut},extra||{}));const e=new Engine(sr);applyMsg(e,{smp:{i:3,d:tone,sr:48000}});applyMsg(e,{S,jump:true});return e;};
      let e=mk(true);run(e,1.03);out.cutVoices=e.vo.filter(o=>o.on).length;
      e=mk(false);run(e,1.03);out.overVoices=e.vo.filter(o=>o.on).length;
      /* replacing the recording fades what was playing; Stop all silences everything */
      e=mk(true);run(e,0.3);applyMsg(e,{smp:{i:3,d:new Float32Array(4800),sr:48000}});run(e,0.01,0.3);out.oldLeft=e.vo.filter(o=>o.on&&o.d===tone).length;
      e=mk(false);run(e,0.6);applyMsg(e,{stop:true});applyMsg(e,{pause:true});const q=run(e,0.1,0.6);out.stopTail=en(q,0.02,0.1);
      /* envelope on a sample: Held for 1/8 of a 0.5 s turn with a 20 ms release. One dot at 2 loops a second fires at 0.5 s. */
      {const S=base();S.rings[0].dk[0]='sample';S.rings[0].ds[0]=3;S.smpp[3]=sanSmpPlay({mode:'held',hold:0.125,a:0.002,r:0.02});const e2=new Engine(sr);applyMsg(e2,{smp:{i:3,d:tone,sr:48000}});applyMsg(e2,{S,jump:true});
        const o=run(e2,0.95);out.heldIn=en(o,0.51,0.56);out.heldAfter=en(o,0.7,0.95);}
      /* pause: the playhead stands still and nothing new fires; un-pausing carries on from the same place */
      {const S=base();const e2=new Engine(sr);applyMsg(e2,{S,jump:true});run(e2,0.3);const m0=e2.master;applyMsg(e2,{pause:true});const o=run(e2,1,0.3);out.pauseMove=Math.abs(e2.master-m0);out.pauseSound=en(o,0.1,1);
        applyMsg(e2,{pause:false});const o2=run(e2,0.4,1.3);out.resume=en(o2,0.15,0.3);out.pauseT=e2.t;}
      /* the track: section A (2 loops/s, 1 trip, played twice) then B (4 loops/s, 1 trip). It should end 2×0.5 + 0.25 = 1.25 s in, and the first click must sound at once. */
      {const S=base();const A=sanitizeState(S),B=sanitizeState(S);B.base.speed=4;B.base.F=1400;
        S.sections=[{name:'A',trips:1,base:A.base,rings:A.rings,lfo:{},seq:A.seq},{name:'B',trips:1,base:B.base,rings:B.rings,lfo:{},seq:B.seq}];S.track={items:[{s:0,rep:2},{s:1,rep:1}],loop:false};
        const e2=new Engine(sr);applyMsg(e2,{S,jump:true});applyMsg(e2,{track:{play:true,from:0,loop:false}});
        const buf=new Float32Array(128);let t=0,doneAt=-1,first=0;const seen=[];
        while(t<2){e2.render(buf,128,t);if(t<0.01)for(const v of buf)first=Math.max(first,Math.abs(v));t+=128/sr;const ti=e2.tOn?e2.tI:-1;if(seen[seen.length-1]!==ti)seen.push(ti);if(doneAt<0&&e2.done)doneAt=t;}
        out.trackDone=doneAt;out.trackSeen=seen.join(',');out.trackFirst=first;out.trackSpeed=e2.E.speed;}
      /* a dot's level LFO: a very slow square holds one value for the test, so the click is at level 0.5 ± 0.3 */
      {const pk=ald=>{const S=base();S.rings[0].da[0]=0.5;S.rings[0].ald[0]=ald;S.rings[0].alr[0]=0.02;S.rings[0].als[0]='square';const e2=new Engine(sr);applyMsg(e2,{S,jump:true});const o=run(e2,0.6);let m=0;for(const v of o)m=Math.max(m,Math.abs(v));
          return{m,want:dotAmp(S.rings[0],0,0,0.5,{shape:'sine',rate:1,seed:0})};};const a=pk(0),b=pk(0.3);out.lvlRatio=b.m/a.m;out.lvlWant=b.want/0.5;}
      /* eight modulators, and one of the new destinations (the eighth modulator opens the noise level) */
      {const I=sanInst(Object.assign(newInst('t'),{src:'osc',wave:'sine',note:69,ft:'off',a:0.002,s:1,nz:0}));out.modSlots=I.mods.length;
        const lvl=on=>{const S=base();S.rings[0].dk[0]='inst';S.rings[0].di[0]=0;S.inst[0]=JSON.parse(JSON.stringify(I));if(on)S.inst[0].mods[7]=sanMod({type:'lfo',dest:'nz',depth:1,sync:'hz',rate:0.02,shape:'square'});
          const e2=new Engine(sr);applyMsg(e2,{S,jump:true});const o=run(e2,0.62);let hi=0;for(let i=Math.round(0.52*sr)+1;i<o.length;i++)hi+=(o[i]-o[i-1])**2;return hi;};
        out.nzOff=lvl(false);out.nzOn=lvl(true);}
      /* old patches: no smpp, no sections, four modulators */
      {const S=sanitizeState({rings:[{on:true,steps:4,hits:4}],inst:[{name:'x',mods:[{type:'lfo',dest:'fc'}]}]});out.oldOk=S.smpp.length===8&&S.smpp[0].cut===true&&S.sections.length===0&&S.cur===-1&&S.inst[0].mods.length===8&&S.inst[0].mods[0].dest==='fc'&&S.rings[0].ald.length===16;}
      return out;});
    check('Cut: a new hit on a sample stops the one before it',r.cutVoices<=2&&r.overVoices>=6,`${r.cutVoices} voices with Cut, ${r.overVoices} with Overlap`);
    check('replacing a recording fades out what was playing it',r.oldLeft===0,r.oldLeft+' voices left on the old audio after 10 ms');
    check('Stop all silences everything',r.stopTail<1e-9,'energy after 20 ms '+r.stopTail.toExponential(1));
    check('a sample follows its envelope: held, then released',r.heldIn>0.1&&r.heldAfter<r.heldIn*1e-5,'held '+r.heldIn.toFixed(2)+', after '+r.heldAfter.toExponential(1));
    check('Pause freezes the playhead and the clock, and un-pausing carries on',r.pauseMove<1e-9&&r.pauseSound<1e-9&&r.resume>1e-4&&r.pauseT<0.75,`moved ${r.pauseMove}, sound ${r.pauseSound.toExponential(1)}, after resume ${r.resume.toExponential(1)}, clock ${r.pauseT.toFixed(2)} s`);
    check('the track plays its sections in order and switches as the playhead crosses the top',Math.abs(r.trackDone-1.25)<0.01&&r.trackSeen==='0,1,-1'&&r.trackFirst>0.01&&Math.abs(r.trackSpeed-4)<1e-6,`ended at ${r.trackDone.toFixed(4)} s, parts ${r.trackSeen}, first click ${r.trackFirst.toFixed(3)}`);
    check('a dot\'s level LFO moves its level',Math.abs(r.lvlRatio-r.lvlWant)<0.01&&Math.abs(r.lvlWant-1)>0.3,`engine ×${r.lvlRatio.toFixed(3)}, maths ×${r.lvlWant.toFixed(3)}`);
    check('eight modulators, and a modulator can reach the noise level',r.modSlots===8&&r.nzOn>r.nzOff*20,`${r.modSlots} slots, roughness ${r.nzOff.toExponential(1)} → ${r.nzOn.toExponential(1)}`);
    check('older patches load with the new settings filled in',r.oldOk);
    /* the page */
    check('the timeline counts the sounds of one trip',(await p.textContent('#tlN'))==='10'&&/2\.00 s/.test(await p.textContent('#tlTrip')),(await p.textContent('#tlN'))+' sounds · '+(await p.textContent('#tlTrip')));
    const ink=await p.evaluate(()=>{const c=document.querySelector('#tl'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>40)n++;return n;});
    check('the timeline is drawn',ink>300,ink+' px');
    await p.click('#pause');await p.waitForTimeout(150);
    const tb=await p.locator('#tl').boundingBox();await p.mouse.click(tb.x+tb.width*0.5+3,tb.y+50);await p.waitForTimeout(150);
    check('clicking a sound on the timeline selects its dot',await p.evaluate(()=>!document.querySelector('#dotEd').hidden),await p.textContent('#dotTitle'));
    check('Pause is shown as on',(await p.getAttribute('#pause','aria-pressed'))==='true'&&(await p.textContent('#tlNote'))==='paused');
    await p.keyboard.press('k');await p.waitForTimeout(100);
    check('K lets it run again',(await p.getAttribute('#pause','aria-pressed'))==='false');
    await p.evaluate(()=>document.querySelector('#dA').dispatchEvent(new MouseEvent('click',{bubbles:true,altKey:true})));await p.waitForTimeout(100);
    check('Alt-click on a dot\'s Level gives it an LFO',await p.evaluate(()=>!document.querySelector('#dlfo-a').hidden&&state.rings.some(r=>r.ald.some(v=>v>0))));
    await p.click('#dotClose');
    /* sections */
    await p.evaluate(()=>{state.base.speed=4;});
    await p.click('#secAdd');await p.waitForTimeout(100);await p.fill('#secName','Intro');
    await p.click('#secAdd');await p.waitForTimeout(100);await p.fill('#secName','Fast');
    await p.focus('#speed');await p.evaluate(()=>{const s=document.querySelector('#speed');s.value=String(Math.round(Math.log(8/0.25)/Math.log(1000/0.25)*1000));s.dispatchEvent(new Event('input',{bubbles:true}));});
    await p.click('#secTp');await p.waitForTimeout(100);
    const s1=await p.evaluate(()=>({n:state.sections.length,cur:state.cur,sp:[state.sections[0].base.speed,state.sections[1].base.speed],same:state.rings===state.sections[1].rings,trips:state.sections[1].trips,names:state.sections.map(x=>x.name).join(',')}));
    check('the wheel can be saved as sections, and editing the wheel edits the selected one',s1.n===2&&s1.cur===1&&s1.sp[0]===4&&Math.abs(s1.sp[1]-8)<0.2&&s1.same&&s1.trips===2&&s1.names==='Intro,Fast',JSON.stringify(s1));
    await p.click('#secList button:nth-child(1)');await p.waitForTimeout(100);
    check('choosing a section puts it back on the wheel',await p.evaluate(()=>state.cur===0&&state.base.speed===4&&state.rings===state.sections[0].rings));
    await p.waitForTimeout(600);
    const kept=await ctx.newPage();await kept.goto(BASE);await kept.waitForTimeout(400);
    check('sections are saved with the patch',await kept.evaluate(()=>state.sections.length===2&&state.cur===0&&state.rings===state.sections[0].rings&&state.sections[0].name==='Intro'));await kept.close();
    await p.click('#secList button:nth-child(2)');await p.click('#secBounce');await p.waitForTimeout(1500);
    check('a section can be bounced to a sample slot',await p.evaluate(()=>!!samples[0]&&samples[0].name==='Fast'&&samples[0].d.length>1000),await p.textContent('#trkNote'));
    await p.evaluate(()=>{samples[0]=null;return smpStore(0);});
    /* each ring alone, added up, is the whole section before the limiter */
    const stems=await p.evaluate(()=>{const sr=44100,mk=solo=>{const S=JSON.parse(JSON.stringify(state));S.track={items:[{s:0,rep:1}],loop:false};const e=new Engine(sr);e.solo=solo;e.raw=true;applyMsg(e,{S,jump:true});applyMsg(e,{track:{play:true,from:0,loop:false}});
        const o=new Float32Array(sr);for(let i=0;i+128<=sr;i+=128)e.render(o.subarray(i,i+128),128,i/sr);return{o,body:e.n/sr};};
      const all=mk(-1),parts=[0,1,2,3].map(mk);let err=0,pk=0;for(let i=0;i<sr;i++){const v=parts[0].o[i]+parts[1].o[i]+parts[2].o[i]+parts[3].o[i];err=Math.max(err,Math.abs(v-all.o[i]));pk=Math.max(pk,Math.abs(all.o[i]));}return{err,pk,body:all.body};});
    check('the four rings rendered alone add up to the whole section',stems.err<1e-6&&stems.pk>0.05&&Math.abs(stems.body-0.25)<0.001,`largest difference ${stems.err.toExponential(1)}, peak ${stems.pk.toFixed(2)}, section ${stems.body.toFixed(4)} s`);
    /* send both sections to the arranger: Intro is 0.25 s (4 loops/s, 1 trip), Fast is 0.25 s (8 loops/s, 2 trips) */
    await p.evaluate(()=>{try{localStorage.removeItem('rit-arr-v1');}catch(e){}return arrWipe();});
    await p.click('#secList button:nth-child(1)');await p.click('#arrSend');await p.waitForFunction(()=>/Sent/.test(document.querySelector('#trkNote').textContent),null,{timeout:20000});
    await p.click('#secList button:nth-child(2)');await p.click('#arrSend');await p.waitForFunction(()=>/Sent “Fast”/.test(document.querySelector('#trkNote').textContent),null,{timeout:20000});
    const sent=await p.evaluate(()=>{const A=arrLoad();return{n:A.clips.length,lanes:A.clips.map(c=>c.lane).join(''),t:A.clips.map(c=>c.t.toFixed(3)).join(' '),body:A.clips.map(c=>c.body.toFixed(3)).join(' ')};});
    check('Send to the arranger makes one clip per ring, and the next section follows the last',sent.n===8&&sent.lanes==='01230123'&&sent.t==='0.000 0.000 0.000 0.000 0.250 0.250 0.250 0.250'&&/^(0\.250 ?){8}$/.test(sent.body),JSON.stringify(sent));
    await p.click('#secDel');await p.click('#secDel');await p.waitForTimeout(100);
    check('a section can be deleted',await p.evaluate(()=>state.sections.length===1&&state.cur===0&&state.rings===state.sections[0].rings));
    /* the arranger window */
    const aw=await ctx.newPage();watch(aw,'arranger');await aw.goto(BASE+'#arrange');await aw.waitForTimeout(900);
    check('the arranger shows the clips that were sent',(await aw.textContent('#a-n'))==='8'&&await aw.evaluate(()=>{const c=document.querySelector('#a-cv'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>60)n++;return n>2000;}),(await aw.textContent('#a-n'))+' clips · '+await aw.textContent('#a-len'));
    const mix0=await aw.evaluate(()=>{const M=__arr.mix();let l=0,r=0;for(let i=0;i<M.n;i++){l+=M.L[i]*M.L[i];r+=M.R[i]*M.R[i];}return{n:M.n,l,r};});
    await aw.evaluate(()=>{const s=document.querySelector('[data-pan="0"]');s.value='-100';s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));
      const m=document.querySelector('[data-m="1"]');m.click();document.querySelector('[data-m="2"]').click();document.querySelector('[data-m="3"]').click();});
    const mix1=await aw.evaluate(()=>{const M=__arr.mix();let l=0,r=0;for(let i=0;i<M.n;i++){l+=M.L[i]*M.L[i];r+=M.R[i]*M.R[i];}return{l,r};});
    check('lanes mix to stereo: centre is equal in both ears, panned left is left only',Math.abs(mix0.l-mix0.r)<mix0.l*1e-6&&mix0.l>0.01&&mix1.l>1e-4&&mix1.r<mix1.l*1e-9,`centre L ${mix0.l.toFixed(3)} R ${mix0.r.toFixed(3)}; panned L ${mix1.l.toExponential(1)} R ${mix1.r.toExponential(1)}`);
    await aw.evaluate(()=>{for(const k of[1,2,3])document.querySelector(`[data-m="${k}"]`).click();});
    /* select the first clip, split it in the middle, delete the second half, undo */
    await aw.evaluate(()=>{__arr.select(__arr.A.clips[0].id);__arr.cur=0.1;});await aw.click('#a-split');
    const sp=await aw.evaluate(()=>{const A=__arr.A,a=A.clips[0],b=A.clips[A.clips.length-1];return{n:A.clips.length,a:a.len,bt:b.t,boff:b.off,sum:a.len+b.len};});
    check('Split cuts a clip at the cursor',sp.n===9&&Math.abs(sp.a-0.1)<1e-6&&Math.abs(sp.bt-0.1)<1e-6&&Math.abs(sp.boff-0.1)<1e-6,JSON.stringify(sp));
    await aw.click('#a-del');const afterDel=await aw.evaluate(()=>__arr.A.clips.length);await aw.click('#a-undo');await aw.click('#a-undo');
    check('Delete and Undo work',afterDel===8&&await aw.evaluate(()=>__arr.A.clips.length===8&&Math.abs(__arr.A.clips[0].len-arrLoad().clips[0].len)<1e-9&&__arr.A.clips[0].len>0.2));
    /* drag a clip later by 100 px, copy and paste, crossfade */
    const cb=await aw.locator('#a-cv').boundingBox();const t0=await aw.evaluate(()=>__arr.A.clips[4].t);
    await aw.uncheck('#a-snap');const px=await aw.evaluate(()=>{const A=__arr.A,c=A.clips[4],w=document.querySelector('#a-cv').getBoundingClientRect().width,e=Math.max(...A.clips.map(q=>q.t+q.len)),pps=Math.min(2000,Math.max(2,(w-24)/Math.max(2,e)));return{x:(c.t+c.len/2)*pps,pps};});
    await aw.mouse.move(cb.x+px.x,cb.y+22+36);await aw.mouse.down();await aw.mouse.move(cb.x+px.x+50,cb.y+22+36,{steps:4});await aw.mouse.move(cb.x+px.x+100,cb.y+22+36,{steps:4});await aw.mouse.up();
    const moved=await aw.evaluate(()=>__arr.A.clips[4].t);
    check('a clip can be dragged along its lane',Math.abs((moved-t0)-100/px.pps)<0.02&&moved>t0,`${t0.toFixed(3)} s → ${moved.toFixed(3)} s`);
    await aw.evaluate(()=>{__arr.select(__arr.A.clips[0].id);__arr.cur=0.15;});await aw.click('#a-copy');await aw.click('#a-paste');await aw.click('#a-xf');
    const xf=await aw.evaluate(()=>{const A=__arr.A,a=A.clips[0],b=A.clips[A.clips.length-1];return{n:A.clips.length,fo:a.fo,fi:b.fi,ov:a.t+a.len-b.t};});
    check('Copy, Paste and Crossfade the overlap',xf.n===9&&xf.ov>0.05&&Math.abs(xf.fo-xf.ov)<1e-6&&Math.abs(xf.fi-xf.ov)<1e-6,JSON.stringify(xf));
    const adl=aw.waitForEvent('download',{timeout:15000}).catch(()=>null);await aw.click('#a-wav');const af=await adl;let ainfo=null;
    if(af){const bf=fs.readFileSync(await af.path());ainfo={ch:bf.readUInt16LE(22),sr:bf.readUInt32LE(24),sec:(bf.length-44)/4/bf.readUInt32LE(24)};}
    const alen=await aw.evaluate(()=>Math.max(...__arr.A.clips.map(q=>q.t+q.len)));
    check('the arrangement exports as a stereo WAV of its own length',!!ainfo&&ainfo.ch===2&&ainfo.sr===44100&&Math.abs(ainfo.sec-alen)<0.01,ainfo?`${ainfo.ch} channels · ${ainfo.sec.toFixed(3)} s`:'no file');
    await aw.click('#a-play');await aw.waitForTimeout(250);const pl=await aw.textContent('#a-play');await aw.click('#a-play');
    check('the arranger plays and stops',pl==='Stop'&&(await aw.textContent('#a-play'))==='Play');
    await aw.screenshot({path:path.join(OUT,'arranger.png'),fullPage:true});
    await aw.setViewportSize({width:390,height:844});await aw.waitForTimeout(200);
    check('the arranger at 390 px has no sideways scroll',await aw.evaluate(()=>document.documentElement.scrollWidth)<=390);
    await aw.evaluate(()=>{try{localStorage.removeItem('rit-arr-v1');}catch(e){}return arrWipe();});await aw.close();
    /* sample window: the playback settings */
    const sw=await ctx.newPage();watch(sw,'sample playback');await sw.goto(BASE+'#sample-3');await sw.waitForTimeout(900);
    await sw.click('#s-pb [data-seg="mode"] [data-v="loop"]');await sw.click('#s-pb [data-seg="cut"] [data-v="false"]');
    await sw.evaluate(()=>{const s=document.querySelector('#i-a');s.value='500';s.dispatchEvent(new Event('input',{bubbles:true}));});
    await sw.evaluate(()=>document.querySelector('#i-fc').dispatchEvent(new MouseEvent('click',{bubbles:true,altKey:true})));await sw.waitForTimeout(400);
    const pbk=await p.evaluate(()=>({mode:state.smpp[2].mode,cut:state.smpp[2].cut,a:state.smpp[2].a,mod:state.smpp[2].mods[0]&&state.smpp[2].mods[0].dest,other:state.smpp[1].mode}));
    check('playback settings edited in the sample window reach the patch',pbk.mode==='loop'&&pbk.cut===false&&pbk.a>0.02&&pbk.mod==='fc'&&pbk.other==='one',JSON.stringify(pbk));
    check('the playback panels show what applies to a sample',await sw.evaluate(()=>document.querySelector('#i-p1').hidden&&!document.querySelector('#i-cutrow').hidden&&!document.querySelector('#i-hold').closest('.ctl').hidden&&document.querySelector('.iw-top[hidden]')!==null));
    await sw.click('#s-slots [data-s="1"]');await sw.waitForTimeout(200);
    check('the playback panels follow the slot',await sw.evaluate(()=>document.querySelector('#s-pb [data-seg="mode"] [aria-pressed="true"]').dataset.v)==='one');
    await sw.screenshot({path:path.join(OUT,'sample-window-playback.png'),fullPage:true});
    await sw.setViewportSize({width:390,height:844});await sw.waitForTimeout(200);
    check('the sample window with playback at 390 px has no sideways scroll',await sw.evaluate(()=>document.documentElement.scrollWidth)<=390);
    await sw.close();await p.close();}

  check('no page errors',errs.length===0,errs.join(' | ')||'none');
  await browser.close();
  console.log(failed?`\n${failed} CHECK(S) FAILED`:'\nALL CHECKS PASSED');
  process.exit(failed?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
