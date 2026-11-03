'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const video=$('#video'), ov=$('#overlay'), octx=ov.getContext('2d');
const pages=[]; let cur=-1, stream=null, auto=true, batch=false, torch=false, loopOn=false, hist=[], lastCap=0, busy=false;
function show(id){$$('.screen').forEach(e=>e.classList.toggle('on',e.id===id)); if(id==='cam')startLoop(); else loopOn=false; if(id==='pages')renderTray();}
function setStatus(t,c){const s=$('#status');s.textContent=t;s.style.color=c||'#fff'}
function counts(){$$('.cnt').forEach(e=>e.textContent=pages.length)}
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});

async function startCam(){
  $('#homeMsg').textContent='';
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){$('#homeMsg').textContent='Camera not available. Open this link in Safari over https.';return}
  try{
    if(!stream) stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
    video.srcObject=stream; await video.play(); show('cam');
    try{const tr=stream.getVideoTracks()[0],cap=tr.getCapabilities?tr.getCapabilities():{};$('#torchBtn').hidden=!cap.torch;try{await tr.applyConstraints({advanced:[{focusMode:'continuous'}]})}catch(e){}}catch(e){}
  }catch(e){$('#homeMsg').textContent=(e.name==='NotAllowedError'?'Camera blocked. Tap "aA" > Website Settings > Camera > Allow, then reload.':'Camera error: '+e.message)}
}
$('#start').onclick=startCam;
$('#autoBtn').onclick=()=>{auto=!auto;$('#autoBtn').textContent='Auto: '+(auto?'ON':'OFF');hist=[]};
$('#modeBtn').onclick=()=>{batch=!batch;$('#modeBtn').textContent=batch?'Batch':'Single'};
$('#torchBtn').onclick=async()=>{const tr=stream&&stream.getVideoTracks()[0];if(!tr)return;try{torch=!torch;await tr.applyConstraints({advanced:[{torch}]});$('#torchBtn').classList.toggle('sel',torch)}catch(e){torch=false;setStatus('Flash not supported on this browser','#fc3')}};
$('#shutter').onclick=()=>capture(lastQuad);
$('#doneBtn').onclick=()=>show('pages'); $('#goPages').onclick=()=>show('pages');
$('#pagesBack').onclick=()=>stream?show('cam'):startCam(); $('#retake').onclick=()=>stream?show('cam'):startCam();
$('#editBack').onclick=()=>show('pages');
$('#clearAll').onclick=()=>{if(pages.length&&confirm('Delete all pages?')){pages.length=0;counts();renderTray()}};
$('#filePick').onchange=e=>{const f=e.target.files[0];if(!f)return;const im=new Image();im.onload=()=>{const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;c.getContext('2d').drawImage(im,0,0);addPage(c,null)};im.src=URL.createObjectURL(f)};

// ---------- detection: web/detect.js (Hough lines -> quad scoring; same code as test/regress.js) ----------
let lastQuad=null; const DW=300;
const dc=document.createElement('canvas'), dctx=dc.getContext('2d',{willReadFrequently:true});
const mc=document.createElement('canvas'), mctx=mc.getContext('2d');
let emptyRun=0,lastFaint=false,frameN=0,dtAvg=60;
function detect(src,w,h,live){
  const dh=Math.round(DW*h/w);
  mc.width=DW*2;mc.height=dh*2;mctx.imageSmoothingEnabled=true;mctx.imageSmoothingQuality='high';mctx.drawImage(src,0,0,mc.width,mc.height);
  dc.width=DW;dc.height=dh;dctx.imageSmoothingEnabled=true;dctx.imageSmoothingQuality='high';dctx.drawImage(mc,0,0,DW,dh);
  // speed: on a run of empty frames, pay the faint (chroma) 2nd pass only every 3rd frame unless the page was last found by it
  const nf=live&&!lastFaint&&emptyRun>=2&&(frameN++%3!==0);
  // v8: outer-page pass (colour edges + background model + fold merge + outward snap, ~2x cost) runs on every 3rd live frame; its result is HELD
  // for OUTER_HOLD ms so the cheap classic pass cannot flip the outline back to an inner panel of the same page.
  const outerNow=!live||(outerN++%3===0);const now=performance.now();
  let r=PaperDetect.detectDoc(dctx.getImageData(0,0,DW,dh),{noFaint:nf,outer:outerNow,outerW:live?240:[200,240,300]});
  if(live){if(r&&r.outer)outerHold={pts:r.pts,score:r.score,t:now};
    else if(outerHold&&now-outerHold.t<OUTER_HOLD){if(!r||r.pts.every(p=>PaperDetect.inQuad(p,outerHold.pts,0.03*DW)))r=r?Object.assign({},r,{pts:outerHold.pts,score:Math.max(r.score,outerHold.score),held:1}):(now-outerHold.t<OUTER_HOLD*0.5?{pts:outerHold.pts,score:outerHold.score,sharp:99,held:1}:null);else outerHold=null}
    else outerHold=null;
    emptyRun=r?0:emptyRun+1;lastFaint=!!(r&&r.faint)}if(!r)return null;
  const k=w/DW;return {pts:r.pts.map(p=>[p[0]*k,p[1]*k]),score:r.score,sharp:r.sharp,outer:!!(r.outer||r.held)}}
let outerHold=null,outerN=0;const OUTER_HOLD=700;
// Auto Crop on a captured still: same v8 detector, multi-scale outer pass, on a 360px copy. Prefer it over the live quad when it is the larger outer page.
function detectStill(c){const W=360,h=Math.round(W*c.height/c.width),t=document.createElement('canvas');t.width=W;t.height=h;const x=t.getContext('2d',{willReadFrequently:true});x.imageSmoothingQuality='high';x.drawImage(c,0,0,W,h);
  const r=PaperDetect.detectDoc(x.getImageData(0,0,W,h),{outer:true,outerW:[200,240,300]});if(!r)return null;const k=c.width/W;return r.pts.map(p=>[p[0]*k,p[1]*k])}
function polyArea(q){let a=0;for(let i=0;i<4;i++){const p=q[i],r=q[(i+1)%4];a+=p[0]*r[1]-r[0]*p[1]}return Math.abs(a)/2}

// One-Euro filter per corner coordinate + lock hysteresis (outline stays put while hand shakes)
function OneEuro(minCut,beta){let xp=null,dxp=0,tp=0;const al=(c,dt)=>{const r=2*Math.PI*c*dt;return r/(r+1)};
  return {reset(){xp=null;dxp=0},f(x,t){if(xp===null){xp=x;tp=t;return x}const dt=Math.max(1e-3,(t-tp)/1000);tp=t;const dx=(x-xp)/dt;dxp=dxp+al(1,dt)*(dx-dxp);
    const c=minCut+beta*Math.abs(dxp);xp=xp+al(c,dt)*(x-xp);return xp}}}
const filt=[...Array(8)].map(()=>OneEuro(1.2,0.004));
// thresholds (detector itself returns null below PaperDetect.T.minScore=0.6)
const SHOW=0.6, UNLOCK=0.55, LOCK=0.72, AUTO=0.75, AUTO_MS=800, MISS_CLEAR=3;
let shrink=0;const SHRINK_N=8;let smQ=null, lockScore=0, miss=0, good=0, locked=false, hiSince=0;
function track(q,t,diag){
  const ok=q&&q.score>=SHOW&&q.score>=(locked?UNLOCK:SHOW);
  // once locked on a page, a smaller quad lying inside it (inner panel / ad box) is ignored for up to SHRINK_N frames
  if(ok&&locked&&smQ&&polyArea(q.pts)<0.75*polyArea(smQ)&&q.pts.every(p=>PaperDetect.inQuad(p,smQ,0.03*diag))){if(++shrink<SHRINK_N){miss=0;return smQ}}else shrink=0;
  if(ok){
    if(smQ){let mv=0;for(let i=0;i<4;i++)mv=Math.max(mv,Math.hypot(q.pts[i][0]-smQ[i][0],q.pts[i][1]-smQ[i][1]));
      if(mv>0.18*diag){filt.forEach(f=>f.reset());lockScore=0;good=0;locked=false;hiSince=0}}
    miss=0;good++;lockScore=lockScore*0.6+q.score*0.4;
    smQ=q.pts.map((p,i)=>[filt[2*i].f(p[0],t),filt[2*i+1].f(p[1],t)]);
    if(q.score>=AUTO){if(!hiSince)hiSince=t}else hiSince=0;
  }else{miss++;good=0;hiSince=0;lockScore*=0.7;
    if(miss>=MISS_CLEAR||!locked){smQ=null;locked=false;lockScore=0;filt.forEach(f=>f.reset())}}
  locked=!!smQ&&(locked?lockScore>=UNLOCK:(good>=3&&lockScore>=LOCK));return smQ}

function startLoop(){if(loopOn)return;loopOn=true;hist=[];requestAnimationFrame(tick)}
let lastT=0;
function tick(t){
  if(!loopOn)return; requestAnimationFrame(tick);
  if(t-lastT<Math.max(66,dtAvg*1.6)||!video.videoWidth||busy)return; lastT=t;
  const vw=video.videoWidth,vh=video.videoHeight, W=ov.clientWidth,H=ov.clientHeight, dpr=devicePixelRatio||1;
  if(ov.width!==W*dpr){ov.width=W*dpr;ov.height=H*dpr}
  const diag=Math.hypot(vw,vh), t0=performance.now(), raw=detect(video,vw,vh,true), q=track(raw,t,diag); dtAvg=dtAvg*0.8+(performance.now()-t0)*0.2; octx.setTransform(dpr,0,0,dpr,0,0); octx.clearRect(0,0,W,H);
  if(!q){lastQuad=null;hist=[];setStatus('Looking for a page…');return}
  const s=Math.max(W/vw,H/vh), ox=(W-vw*s)/2, oy=(H-vh*s)/2;
  hist.push({q,t}); while(hist.length&&t-hist[0].t>900)hist.shift();
  let mv=0; for(const h of hist)for(let i=0;i<4;i++)mv=Math.max(mv,Math.hypot(h.q[i][0]-q[i][0],h.q[i][1]-q[i][1])/diag);
  const sharpOk=!raw||raw.sharp>15, stable=mv<0.025, ready=locked&&stable&&sharpOk&&hiSince&&t-hiSince>=AUTO_MS;
  lastQuad=q.map(p=>p.slice());
  octx.beginPath(); q.forEach((p,i)=>{const x=ox+p[0]*s,y=oy+p[1]*s;i?octx.lineTo(x,y):octx.moveTo(x,y)}); octx.closePath();
  octx.lineJoin='round';octx.lineWidth=locked?6:4; octx.strokeStyle=locked?'#19d36b':'#ffcc33'; octx.fillStyle=locked?'#19d36b33':'#ffcc3322'; octx.fill(); octx.stroke();
  if(locked){octx.fillStyle='#fff';q.forEach(p=>{octx.beginPath();octx.arc(ox+p[0]*s,oy+p[1]*s,6,0,7);octx.fill()})}
  if(!locked)setStatus('Page found… hold steady','#fc3');
  else if(!sharpOk)setStatus('Hold still — blurry','#fc3');
  else setStatus(auto?'Locked. Capturing…':'Locked. Tap the shutter','#5f5');
  if(auto&&ready&&t-lastCap>2500){lastCap=t;if(capture(lastQuad,true)===false)lastCap=t-1700}
}

// ---------- capture + warp ----------
// focus gate: directional 2nd/1st-derivative energy ratio inside the page on a ~640px copy. Enhance cannot recover motion/defocus blur.
const BLUR_MIN=0.55, BLUR_WARN=0.75; // PaperDetect.sharpness scale (test/focus_test.js): crisp 1.2-1.9, real KFC frame 0.81, 5px motion ~0.4, gaussian ~0.07
function focusOf(c,quad){const k=Math.min(1,640/Math.max(c.width,c.height)),w=Math.round(c.width*k),h=Math.round(c.height*k),t=document.createElement('canvas');t.width=w;t.height=h;const x=t.getContext('2d',{willReadFrequently:true});x.drawImage(c,0,0,w,h);
  return PaperDetect.sharpness(x.getImageData(0,0,w,h),quad?quad.map(p=>[p[0]*k,p[1]*k]):null)}
function capture(quad,isAuto){
  if(!video.videoWidth)return; const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;
  c.getContext('2d').drawImage(video,0,0);
  const fv=focusOf(c,quad);if(isAuto&&fv<BLUR_MIN){setStatus('Too blurry — hold still / tap to focus','#f66');return false} const f=$('#flash');f.style.opacity=1;setTimeout(()=>f.style.opacity=0,150);
  if(navigator.vibrate)navigator.vibrate(40);
  addPage(c,quad,fv); setStatus('Captured page '+pages.length+'. Next page or tap Done.','#5f5'); hist=[];
}
function addPage(full,quad,fv){
  const sq=detectStill(full);if(sq&&(!quad||polyArea(sq)>=polyArea(quad)*1.1&&quad.every(p=>PaperDetect.inQuad(p,sq,0.03*full.width))||!quad))quad=sq; // still re-detect: take the full outer page
  const warped=quad?warp(full,quad):full;
  const p={full,quad,autoQuad:quad,warped,mode:'magic',img:null,server:null,focus:fv};pages.push(p);counts();
  p.img=render(p); if(!$('#cam').classList.contains('on')||!batch){openCrop(pages.length-1)}
}
function solve(A,b){const n=b.length;for(let i=0;i<n;i++){let mx=i;for(let r=i+1;r<n;r++)if(Math.abs(A[r][i])>Math.abs(A[mx][i]))mx=r;[A[i],A[mx]]=[A[mx],A[i]];[b[i],b[mx]]=[b[mx],b[i]];
  for(let r=i+1;r<n;r++){const f=A[r][i]/A[i][i];for(let c=i;c<n;c++)A[r][c]-=f*A[i][c];b[r]-=f*b[i]}}
  const x=new Array(n);for(let i=n-1;i>=0;i--){let s=b[i];for(let c=i+1;c<n;c++)s-=A[i][c]*x[c];x[i]=s/A[i][i]}return x}
function homog(from,to){const A=[],b=[];for(let i=0;i<4;i++){const[x,y]=from[i],[u,v]=to[i];
  A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v)}return solve(A,b).concat(1)}
function warp(src,q){
  // true page aspect from perspective geometry (Zhang-He), not bounding box / longest sides
  const os=PaperEnhance.outSize(q,src.width,src.height,2000),W=os.w,H=os.h;
  const M=homog([[0,0],[W-1,0],[W-1,H-1],[0,H-1]],q);
  const sw=src.width,shh=src.height,sd=src.getContext('2d').getImageData(0,0,sw,shh).data;
  const out=document.createElement('canvas');out.width=W;out.height=H;const oc=out.getContext('2d'),od=oc.createImageData(W,H),o=od.data;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const z=M[6]*x+M[7]*y+1,sx=(M[0]*x+M[1]*y+M[2])/z,sy=(M[3]*x+M[4]*y+M[5])/z;
    const x0=Math.max(0,Math.min(sw-2,sx|0)),y0=Math.max(0,Math.min(shh-2,sy|0)),fx=sx-x0,fy=sy-y0,i=(y0*sw+x0)*4,j=(y*W+x)*4;
    for(let c=0;c<3;c++)o[j+c]=(sd[i+c]*(1-fx)+sd[i+4+c]*fx)*(1-fy)+(sd[i+sw*4+c]*(1-fx)+sd[i+sw*4+4+c]*fx)*fy; o[j+3]=255}
  oc.putImageData(od,0,0);return out}

// ---------- enhance (enhance.js: shadow/paper normalisation with capped gain, ink-preserving curve) ----------
function render(p){
  const s=p.warped,W=s.width,H=s.height,c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');x.drawImage(s,0,0);
  if(p.mode==='original')return c.toDataURL('image/jpeg',.92);
  const id=x.getImageData(0,0,W,H);PaperEnhance.enhance(id.data,W,H,p.mode);
  x.putImageData(id,0,0);return c.toDataURL(p.mode==='bw'?'image/png':'image/jpeg',.92)}

// ---------- edit / tray / pdf ----------
function openEdit(i){cur=i;const p=pages[i];const ob=$('#ocrOut');if(ob)ob.hidden=true;$('#editTitle').textContent='Page '+(i+1);$('#pageImg').src=p.server||p.img;
  $$('.modes button[data-m]').forEach(b=>b.classList.toggle('sel',b.dataset.m===p.mode&&!p.server));$('#editMsg').textContent=(p.quad?'':'No page edge found — full photo kept. ')+(p.focus!=null&&p.focus<BLUR_WARN?'⚠ Photo looks blurry (focus '+p.focus.toFixed(2)+') — Enhance cannot fix blur; tap Retake for a sharp scan.':'');show('edit')}
$$('.modes button[data-m]').forEach(b=>b.onclick=()=>{const p=pages[cur];p.mode=b.dataset.m;p.server=null;$('#editMsg').textContent='Working…';
  setTimeout(()=>{p.img=render(p);openEdit(cur);$('#editMsg').textContent=''},20)});
($('#rotBtn')||{}).onclick=()=>{const p=pages[cur],s=p.warped,c=document.createElement('canvas');c.width=s.height;c.height=s.width;const x=c.getContext('2d');x.translate(c.width,0);x.rotate(Math.PI/2);x.drawImage(s,0,0);p.warped=c;p.server=null;p.img=render(p);openEdit(cur)};
$('#srvBtn').onclick=async()=>{const p=pages[cur];$('#editMsg').textContent='Sending to server (Python pipeline)…';
  try{const blob=await new Promise(r=>p.full.toBlob(r,'image/jpeg',.92));const m=({original:'color',lighten:'color'})[p.mode]||p.mode;
    const r=await fetch('api/scan?mode='+m,{method:'POST',body:blob});if(!r.ok)throw new Error('HTTP '+r.status);
    const bl=await r.blob();p.server=await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(bl)});
    openEdit(cur);$('#editMsg').textContent='Server result ('+m+', confidence '+r.headers.get('X-Confidence')+'). Tap a mode to go back to phone result.'}
  catch(e){$('#editMsg').textContent='Server failed: '+e.message}};
function renderTray(){const t=$('#tray');t.innerHTML='';$('#pagesMsg').textContent=pages.length?'':'No pages yet. Go back to the camera.';
  pages.forEach((p,i)=>{const d=document.createElement('div');d.className='th';d.innerHTML=`<img src="${p.server||p.img}"><div>Page ${i+1}</div><div class="row"><button data-a="up">◀</button><button data-a="del">🗑</button><button data-a="dn">▶</button></div>`;
    d.querySelector('img').onclick=()=>openEdit(i);
    d.querySelectorAll('button').forEach(b=>b.onclick=()=>{const a=b.dataset.a;if(a==='del'){pages.splice(i,1)}else{const j=a==='up'?i-1:i+1;if(j<0||j>=pages.length)return;[pages[i],pages[j]]=[pages[j],pages[i]]}counts();renderTray()});t.appendChild(d)})}
$('#pdfBtn').onclick=async()=>{if(!pages.length){$('#pagesMsg').textContent='Scan a page first.';return}
  $('#pagesMsg').textContent='Making PDF…';await new Promise(r=>setTimeout(r,30));
  const {jsPDF}=window.jspdf;const doc=new jsPDF({unit:'mm',format:'a4',compress:true});
  for(let i=0;i<pages.length;i++){const u=pages[i].server||pages[i].img;const im=await new Promise(r=>{const m=new Image();m.onload=()=>r(m);m.src=u});
    if(i)doc.addPage('a4');const r=Math.min(210/im.width,297/im.height),w=im.width*r,h=im.height*r;doc.addImage(u,u.startsWith('data:image/png')?'PNG':'JPEG',(210-w)/2,(297-h)/2,w,h)}
  const blob=doc.output('blob'),name='scan_'+new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')+'.pdf',file=new File([blob],name,{type:'application/pdf'});
  if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:name});$('#pagesMsg').textContent='Done. Choose "Save to Files".';return}catch(e){if(e.name==='AbortError'){$('#pagesMsg').textContent='';return}}}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();$('#pagesMsg').textContent='PDF ready ('+pages.length+' pages).'};

// ---------- crop screen (CamScanner-style) ----------
let cp=null, cq=null, cdrag=-1, cscale=1, autoQ=null;
const cv=$('#cropCv'), cx=cv.getContext('2d');
function fullQ(c){return [[0,0],[c.width,0],[c.width,c.height],[0,c.height]]}
function openCrop(i){cur=i;cp=pages[i];autoQ=cp.autoQuad||null;cq=(cp.quad||autoQ||fullQ(cp.full)).map(p=>p.slice());
  $('#cropTitle').textContent=(i+1)+'/'+pages.length;$('#autoCrop').classList.toggle('sel',!!cp.quad);show('crop');requestAnimationFrame(drawCrop)}
function drawCrop(){const f=cp.full,wr=$('#cropWrap'),W=wr.clientWidth-16,H=wr.clientHeight-16;cscale=Math.min(W/f.width,H/f.height);
  cv.width=f.width*cscale;cv.height=f.height*cscale;cx.drawImage(f,0,0,cv.width,cv.height);
  const P=cq.map(p=>[p[0]*cscale,p[1]*cscale]);cx.fillStyle='#0007';cx.beginPath();cx.rect(0,0,cv.width,cv.height);P.forEach((p,i)=>i?cx.lineTo(...p):cx.moveTo(...p));cx.closePath();cx.fill('evenodd');
  cx.strokeStyle='#19d36b';cx.lineWidth=3;cx.beginPath();P.forEach((p,i)=>i?cx.lineTo(...p):cx.moveTo(...p));cx.closePath();cx.stroke();
  cx.fillStyle='#fff';cx.strokeStyle='#19d36b';
  P.forEach(p=>{cx.beginPath();cx.arc(p[0],p[1],11,0,7);cx.fill();cx.stroke()});
  for(let i=0;i<4;i++){const a=P[i],b=P[(i+1)%4];cx.beginPath();cx.arc((a[0]+b[0])/2,(a[1]+b[1])/2,8,0,7);cx.fill();cx.stroke()}}
function cpt(e){const r=cv.getBoundingClientRect(),t=e.touches?e.touches[0]:e;return[(t.clientX-r.left)/cscale,(t.clientY-r.top)/cscale]}
function cdown(e){e.preventDefault();const p=cpt(e);let best=-1,bd=40/cscale;
  for(let i=0;i<8;i++){const q=i<4?cq[i]:[(cq[i-4][0]+cq[(i-3)%4][0])/2,(cq[i-4][1]+cq[(i-3)%4][1])/2];const d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<bd){bd=d;best=i}}cdrag=best;cdown.last=p}
function cmove(e){if(cdrag<0)return;e.preventDefault();const p=cpt(e),f=cp.full,cl=q=>{q[0]=Math.max(0,Math.min(f.width,q[0]));q[1]=Math.max(0,Math.min(f.height,q[1]))};
  if(cdrag<4){cq[cdrag]=p;cl(cq[cdrag])}else{const i=cdrag-4,j=(i+1)%4,dx=p[0]-cdown.last[0],dy=p[1]-cdown.last[1];[i,j].forEach(k=>{cq[k][0]+=dx;cq[k][1]+=dy;cl(cq[k])})}
  cdown.last=p;$('#autoCrop').classList.remove('sel');drawCrop()}
cv.addEventListener('touchstart',cdown,{passive:false});cv.addEventListener('touchmove',cmove,{passive:false});cv.addEventListener('touchend',()=>cdrag=-1);
cv.addEventListener('mousedown',cdown);addEventListener('mousemove',cmove);addEventListener('mouseup',()=>cdrag=-1);
$('#autoCrop').onclick=()=>{const on=!$('#autoCrop').classList.contains('sel');if(on){const sq=detectStill(cp.full);if(sq)autoQ=sq}cq=(on&&autoQ?autoQ:fullQ(cp.full)).map(p=>p.slice());$('#autoCrop').classList.toggle('sel',on);
  $('#cropMsg').textContent=on&&!autoQ?'No edge found — adjust corners by hand.':'Drag the green corners/edges to fit the page.';drawCrop()};
$('#cropAll').onclick=()=>{cq=fullQ(cp.full);$('#autoCrop').classList.remove('sel');drawCrop()};
function rotFull(dir){const f=cp.full,c=document.createElement('canvas');c.width=f.height;c.height=f.width;const x=c.getContext('2d');
  if(dir>0){x.translate(c.width,0);x.rotate(Math.PI/2)}else{x.translate(0,c.height);x.rotate(-Math.PI/2)}x.drawImage(f,0,0);
  const m=p=>dir>0?[f.height-p[1],p[0]]:[p[1],f.width-p[0]];cq=cq.map(m);let a=cq.slice();if(dir>0)a.unshift(a.pop());else a.push(a.shift());cq=a;if(autoQ){autoQ=autoQ.map(m);let b=autoQ.slice();if(dir>0)b.unshift(b.pop());else b.push(b.shift());autoQ=b}cp.full=c;drawCrop()}
$('#rotL').onclick=()=>rotFull(-1);$('#rotR').onclick=()=>rotFull(1);
$('#cropOk').onclick=()=>{$('#cropMsg').textContent='Cropping…';setTimeout(()=>{cp.quad=PaperDetect.order(cq.map(p=>p.slice()));cp.autoQuad=autoQ;cp.warped=warp(cp.full,cp.quad);cp.server=null;cp.img=render(cp);openEdit(cur)},20)};
$('#cropCancel').onclick=()=>openEdit(cur);
$('#cropBtn').onclick=()=>openCrop(cur);
$('#editOk').onclick=()=>show('pages');
($('#retake2')||{}).onclick=()=>{pages.splice(cur,1);counts();stream?show('cam'):startCam()};
// Extract Text: Tesseract.js (Apache-2.0) lazy-loaded from CDN only when tapped (~2-4 MB incl. eng traineddata, cached by browser). Nothing loads at startup.
let ocrW=null;function loadScript(u){return new Promise((r,j)=>{const s=document.createElement('script');s.src=u;s.onload=r;s.onerror=()=>j(new Error('load failed'));document.head.appendChild(s)})}
$('#ocrBtn').onclick=async()=>{const p=pages[cur],m=$('#editMsg');if(!p)return;
  try{m.textContent='Loading OCR (first time ~3 MB)…';if(!window.Tesseract)await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    if(!ocrW)ocrW=await Tesseract.createWorker('eng',1,{logger:e=>{if(e.status==='recognizing text')m.textContent='Reading text… '+Math.round(e.progress*100)+'%'}});
    const src=p.server||p.img;m.textContent='Reading text…';const {data}=await ocrW.recognize(src);const txt=(data.text||'').trim();
    if(!txt){m.textContent='No text found.';return}
    try{await navigator.clipboard.writeText(txt);m.textContent='Text copied ('+txt.length+' chars, confidence '+Math.round(data.confidence)+'%).'}catch(e){m.textContent='Text extracted:'}
    let box=$('#ocrOut');if(!box){box=document.createElement('textarea');box.id='ocrOut';box.style.cssText='width:100%;height:30vh;font:13px monospace;margin-top:6px';m.after(box)}box.value=txt;box.hidden=false}
  catch(e){m.textContent='OCR failed: '+e.message+' (needs internet the first time)'}};
// manual camera shutter -> go straight to crop; file pick too
