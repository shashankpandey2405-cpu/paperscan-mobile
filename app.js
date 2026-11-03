'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const video=$('#video'), ov=$('#overlay'), octx=ov.getContext('2d');
const pages=[]; let cur=-1, stream=null, auto=true, loopOn=false, hist=[], lastCap=0, busy=false;
const SW=200; const sc=document.createElement('canvas'); const sctx=sc.getContext('2d',{willReadFrequently:true});
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
  }catch(e){$('#homeMsg').textContent=(e.name==='NotAllowedError'?'Camera blocked. Tap "aA" > Website Settings > Camera > Allow, then reload.':'Camera error: '+e.message)}
}
$('#start').onclick=startCam;
$('#autoBtn').onclick=()=>{auto=!auto;$('#autoBtn').textContent='Auto: '+(auto?'ON':'OFF');hist=[]};
$('#shutter').onclick=()=>capture(lastQuad);
$('#doneBtn').onclick=()=>show('pages'); $('#goPages').onclick=()=>show('pages');
$('#pagesBack').onclick=()=>stream?show('cam'):startCam(); $('#retake').onclick=()=>stream?show('cam'):startCam();
$('#editBack').onclick=()=>show('pages');
$('#clearAll').onclick=()=>{if(pages.length&&confirm('Delete all pages?')){pages.length=0;counts();renderTray()}};
$('#filePick').onchange=e=>{const f=e.target.files[0];if(!f)return;const im=new Image();im.onload=()=>{const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;c.getContext('2d').drawImage(im,0,0);const q=detect(c,c.width,c.height);addPage(c,q?q.pts:null)};im.src=URL.createObjectURL(f)};

// ---------- detection (small-frame paper mask -> largest blob -> 4 extreme corners) ----------
let lastQuad=null;
function detect(src,w,h){
  const sh=Math.round(SW*h/w); sc.width=SW; sc.height=sh; sctx.drawImage(src,0,0,SW,sh);
  const d=sctx.getImageData(0,0,SW,sh).data, n=SW*sh, sc2=new Float32Array(n), g=new Float32Array(n);
  const hist256=new Uint32Array(256);
  for(let i=0;i<n;i++){const r=d[i*4],gg=d[i*4+1],b=d[i*4+2],mx=Math.max(r,gg,b),mn=Math.min(r,gg,b);
    g[i]=.299*r+.587*gg+.114*b; let v=g[i]-0.8*(mx-mn); v=v<0?0:v>255?255:v; sc2[i]=v; hist256[v|0]++;}
  // Otsu
  let sum=0;for(let i=0;i<256;i++)sum+=i*hist256[i];let sB=0,wB=0,best=0,th=128;
  for(let t=0;t<256;t++){wB+=hist256[t];if(!wB)continue;const wF=n-wB;if(!wF)break;sB+=t*hist256[t];const mB=sB/wB,mF=(sum-sB)/wF,v=wB*wF*(mB-mF)**2;if(v>best){best=v;th=t}}
  const m=new Uint8Array(n);for(let i=0;i<n;i++)m[i]=sc2[i]>th?1:0;
  // largest component
  const lab=new Int32Array(n),st=new Int32Array(n);let bestL=0,bestA=0,L=0;
  for(let i=0;i<n;i++){if(!m[i]||lab[i])continue;L++;let sp=0,a=0;st[sp++]=i;lab[i]=L;
    while(sp){const p=st[--sp];a++;const x=p%SW,y=(p/SW)|0;
      if(x>0&&m[p-1]&&!lab[p-1]){lab[p-1]=L;st[sp++]=p-1} if(x<SW-1&&m[p+1]&&!lab[p+1]){lab[p+1]=L;st[sp++]=p+1}
      if(y>0&&m[p-SW]&&!lab[p-SW]){lab[p-SW]=L;st[sp++]=p-SW} if(y<sh-1&&m[p+SW]&&!lab[p+SW]){lab[p+SW]=L;st[sp++]=p+SW}}
    if(a>bestA){bestA=a;bestL=L}}
  if(bestA<n*0.12) return null;
  let tl=[0,0,1e9],tr=[0,0,-1e9],br=[0,0,-1e9],bl=[0,0,1e9];
  for(let i=0;i<n;i++){if(lab[i]!==bestL)continue;const x=i%SW,y=(i/SW)|0,s=x+y,df=x-y;
    if(s<tl[2])tl=[x,y,s]; if(s>br[2])br=[x,y,s]; if(df>tr[2])tr=[x,y,df]; if(df<bl[2])bl=[x,y,df];}
  const q=[tl,tr,br,bl].map(p=>[p[0],p[1]]); const area=polyArea(q);
  if(area<n*0.15||bestA/area<0.75||!convex(q)) return null;
  // touching frame edge on all sides = probably not a page
  // sharpness: Laplacian variance inside bbox
  let lv=0,lm=0,c=0;for(let y=1;y<sh-1;y+=1)for(let x=1;x<SW-1;x++){const i=y*SW+x;if(lab[i]!==bestL)continue;const l=4*g[i]-g[i-1]-g[i+1]-g[i-SW]-g[i+SW];lm+=l;lv+=l*l;c++}
  const sharp=c?lv/c-(lm/c)**2:0, k=w/SW;
  return {pts:q.map(p=>[p[0]*k,p[1]*k]),sharp,fill:bestA/area,areaFrac:area/n};
}
function polyArea(q){let a=0;for(let i=0;i<4;i++){const p=q[i],r=q[(i+1)%4];a+=p[0]*r[1]-r[0]*p[1]}return Math.abs(a)/2}
function convex(q){let s=0;for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4],c=q[(i+2)%4];const z=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(z===0)return false;if(!s)s=Math.sign(z);else if(Math.sign(z)!==s)return false}return true}

function startLoop(){if(loopOn)return;loopOn=true;hist=[];requestAnimationFrame(tick)}
let lastT=0;
function tick(t){
  if(!loopOn)return; requestAnimationFrame(tick);
  if(t-lastT<90||!video.videoWidth||busy)return; lastT=t;
  const vw=video.videoWidth,vh=video.videoHeight, W=ov.clientWidth,H=ov.clientHeight, dpr=devicePixelRatio||1;
  if(ov.width!==W*dpr){ov.width=W*dpr;ov.height=H*dpr}
  const q=detect(video,vw,vh); octx.setTransform(dpr,0,0,dpr,0,0); octx.clearRect(0,0,W,H);
  if(!q){lastQuad=null;hist=[];setStatus('Looking for a page… put paper on a darker table');return}
  const s=Math.max(W/vw,H/vh), ox=(W-vw*s)/2, oy=(H-vh*s)/2;
  hist.push({q:q.pts,t}); while(hist.length&&t-hist[0].t>1000)hist.shift();
  const diag=Math.hypot(vw,vh); let mv=0; for(const h of hist)for(let i=0;i<4;i++)mv=Math.max(mv,Math.hypot(h.q[i][0]-q.pts[i][0],h.q[i][1]-q.pts[i][1])/diag);
  const span=hist.length?t-hist[0].t:0, stable=mv<0.02, sharpOk=q.sharp>18, ready=stable&&sharpOk&&span>=850;
  const good=stable&&sharpOk; lastQuad=q.pts;
  octx.beginPath(); q.pts.forEach((p,i)=>{const x=ox+p[0]*s,y=oy+p[1]*s;i?octx.lineTo(x,y):octx.moveTo(x,y)}); octx.closePath();
  octx.lineWidth=4; octx.strokeStyle=good?'#2f2':'#fc3'; octx.fillStyle=good?'#2f23':'#fc32'; octx.fill(); octx.stroke();
  if(!sharpOk)setStatus('Page found. Hold still — image is blurry','#fc3');
  else if(!stable)setStatus('Page found. Hold steady…','#fc3');
  else setStatus(auto?'Good! Hold still, capturing…':'Good! Tap the white button','#5f5');
  if(auto&&ready&&t-lastCap>2500){lastCap=t;capture(q.pts)}
}

// ---------- capture + warp ----------
function capture(quad){
  if(!video.videoWidth)return; const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;
  c.getContext('2d').drawImage(video,0,0); const f=$('#flash');f.style.opacity=1;setTimeout(()=>f.style.opacity=0,150);
  if(navigator.vibrate)navigator.vibrate(40);
  addPage(c,quad); setStatus('Captured page '+pages.length+'. Next page or tap Done.','#5f5'); hist=[];
}
function addPage(full,quad){
  const warped=quad?warp(full,quad):full;
  const p={full,quad,autoQuad:quad,warped,mode:'magic',img:null,server:null};pages.push(p);counts();
  p.img=render(p); if(!$('#cam').classList.contains('on')||!auto){openCrop(pages.length-1)}
}
function solve(A,b){const n=b.length;for(let i=0;i<n;i++){let mx=i;for(let r=i+1;r<n;r++)if(Math.abs(A[r][i])>Math.abs(A[mx][i]))mx=r;[A[i],A[mx]]=[A[mx],A[i]];[b[i],b[mx]]=[b[mx],b[i]];
  for(let r=i+1;r<n;r++){const f=A[r][i]/A[i][i];for(let c=i;c<n;c++)A[r][c]-=f*A[i][c];b[r]-=f*b[i]}}
  const x=new Array(n);for(let i=n-1;i>=0;i--){let s=b[i];for(let c=i+1;c<n;c++)s-=A[i][c]*x[c];x[i]=s/A[i][i]}return x}
function homog(from,to){const A=[],b=[];for(let i=0;i<4;i++){const[x,y]=from[i],[u,v]=to[i];
  A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v)}return solve(A,b).concat(1)}
function warp(src,q){
  const d=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  let w=Math.max(d(q[0],q[1]),d(q[3],q[2])),h=Math.max(d(q[0],q[3]),d(q[1],q[2]));
  const r=h/w; if(Math.abs(r-1.414)/1.414<0.08)h=w*1.414;
  const sc=Math.min(1.6,1600/Math.max(w,h)); const W=Math.round(w*sc),H=Math.round(h*sc);
  const M=homog([[0,0],[W-1,0],[W-1,H-1],[0,H-1]],q);
  const sw=src.width,shh=src.height,sd=src.getContext('2d').getImageData(0,0,sw,shh).data;
  const out=document.createElement('canvas');out.width=W;out.height=H;const oc=out.getContext('2d'),od=oc.createImageData(W,H),o=od.data;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const z=M[6]*x+M[7]*y+1,sx=(M[0]*x+M[1]*y+M[2])/z,sy=(M[3]*x+M[4]*y+M[5])/z;
    const x0=Math.max(0,Math.min(sw-2,sx|0)),y0=Math.max(0,Math.min(shh-2,sy|0)),fx=sx-x0,fy=sy-y0,i=(y0*sw+x0)*4,j=(y*W+x)*4;
    for(let c=0;c<3;c++)o[j+c]=(sd[i+c]*(1-fx)+sd[i+4+c]*fx)*(1-fy)+(sd[i+sw*4+c]*(1-fx)+sd[i+sw*4+4+c]*fx)*fy; o[j+3]=255}
  oc.putImageData(od,0,0);return out}

// ---------- enhance ----------
function render(p){
  const s=p.warped,W=s.width,H=s.height,c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');x.drawImage(s,0,0);
  if(p.mode==='original')return c.toDataURL('image/jpeg',.9);
  const id=x.getImageData(0,0,W,H),d=id.data;
  // background estimate: shrink to ~24px (averages away text), max-ish via brightest neighbours, scale back up
  const bw=24,bh=Math.max(2,Math.round(24*H/W)),b=document.createElement('canvas');b.width=bw;b.height=bh;const bx=b.getContext('2d',{willReadFrequently:true});
  bx.drawImage(s,0,0,bw,bh);const bd=bx.getImageData(0,0,bw,bh),bdd=bd.data,cp=new Uint8ClampedArray(bdd);
  for(let y=0;y<bh;y++)for(let xx=0;xx<bw;xx++)for(let ch=0;ch<3;ch++){let m=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=Math.min(bh-1,Math.max(0,y+dy)),xq=Math.min(bw-1,Math.max(0,xx+dx));m=Math.max(m,cp[(yy*bw+xq)*4+ch])}bdd[(y*bw+xx)*4+ch]=m}
  bx.putImageData(bd,0,0);const B=document.createElement('canvas');B.width=W;B.height=H;const Bx=B.getContext('2d');Bx.imageSmoothingQuality='high';Bx.drawImage(b,0,0,W,H);const bg=Bx.getImageData(0,0,W,H).data;
  for(let i=0;i<d.length;i+=4){
    if(p.mode==='gray'||p.mode==='lighten'){const g=(.299*d[i]+.587*d[i+1]+.114*d[i+2])/(.299*bg[i]+.587*bg[i+1]+.114*bg[i+2]+1)*255;if(p.mode==='gray'){let v=(g-40)*255/208;v=v<0?0:v>255?255:v;d[i]=d[i+1]=d[i+2]=v}else{for(let c=0;c<3;c++){let v=d[i+c]*1.25+25;d[i+c]=v>255?255:v}}continue}
    if(p.mode==='bw'){const g=(.299*d[i]+.587*d[i+1]+.114*d[i+2])/(.299*bg[i]+.587*bg[i+1]+.114*bg[i+2]+1);const v=g>0.78?255:0;d[i]=d[i+1]=d[i+2]=v;continue}
    const wp=p.mode==='magic'?235:248, k=p.mode==='magic'?1.25:1.0;
    let r=d[i]/(bg[i]+1)*255,g=d[i+1]/(bg[i+1]+1)*255,bl=d[i+2]/(bg[i+2]+1)*255;
    const L=(r+g+bl)/3; r=L+(r-L)*k; g=L+(g-L)*k; bl=L+(bl-L)*k;
    const lv=v=>{v=(v-40)*255/(wp-40);return v<0?0:v>255?255:p.mode==='magic'?255*Math.pow(v/255,1.15):v};
    d[i]=lv(r);d[i+1]=lv(g);d[i+2]=lv(bl)}
  x.putImageData(id,0,0);return c.toDataURL(p.mode==='bw'?'image/png':'image/jpeg',.9)}

// ---------- edit / tray / pdf ----------
function openEdit(i){cur=i;const p=pages[i];$('#editTitle').textContent='Page '+(i+1);$('#pageImg').src=p.server||p.img;
  $$('.modes button[data-m]').forEach(b=>b.classList.toggle('sel',b.dataset.m===p.mode&&!p.server));$('#editMsg').textContent=p.quad?'':'No page edge found — full photo kept.';show('edit')}
$$('.modes button[data-m]').forEach(b=>b.onclick=()=>{const p=pages[cur];p.mode=b.dataset.m;p.server=null;$('#editMsg').textContent='Working…';
  setTimeout(()=>{p.img=render(p);openEdit(cur);$('#editMsg').textContent=''},20)});
$('#rotBtn').onclick=()=>{const p=pages[cur],s=p.warped,c=document.createElement('canvas');c.width=s.height;c.height=s.width;const x=c.getContext('2d');x.translate(c.width,0);x.rotate(Math.PI/2);x.drawImage(s,0,0);p.warped=c;p.server=null;p.img=render(p);openEdit(cur)};
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
$('#autoCrop').onclick=()=>{const on=!$('#autoCrop').classList.contains('sel');cq=(on&&autoQ?autoQ:fullQ(cp.full)).map(p=>p.slice());$('#autoCrop').classList.toggle('sel',on);
  $('#cropMsg').textContent=on&&!autoQ?'No edge found — adjust corners by hand.':'Drag the green corners/edges to fit the page.';drawCrop()};
$('#cropAll').onclick=()=>{cq=fullQ(cp.full);$('#autoCrop').classList.remove('sel');drawCrop()};
function rotFull(dir){const f=cp.full,c=document.createElement('canvas');c.width=f.height;c.height=f.width;const x=c.getContext('2d');
  if(dir>0){x.translate(c.width,0);x.rotate(Math.PI/2)}else{x.translate(0,c.height);x.rotate(-Math.PI/2)}x.drawImage(f,0,0);
  const m=p=>dir>0?[f.height-p[1],p[0]]:[p[1],f.width-p[0]];cq=cq.map(m);let a=cq.slice();if(dir>0)a.unshift(a.pop());else a.push(a.shift());cq=a;if(autoQ){autoQ=autoQ.map(m);let b=autoQ.slice();if(dir>0)b.unshift(b.pop());else b.push(b.shift());autoQ=b}cp.full=c;drawCrop()}
$('#rotL').onclick=()=>rotFull(-1);$('#rotR').onclick=()=>rotFull(1);
$('#cropOk').onclick=()=>{$('#cropMsg').textContent='Cropping…';setTimeout(()=>{cp.quad=cq.map(p=>p.slice());cp.autoQuad=autoQ;cp.warped=warp(cp.full,cp.quad);cp.server=null;cp.img=render(cp);openEdit(cur)},20)};
$('#cropCancel').onclick=()=>openEdit(cur);
$('#cropBtn').onclick=()=>openCrop(cur);
$('#editOk').onclick=()=>show('pages');
$('#retake2').onclick=()=>{pages.splice(cur,1);counts();stream?show('cam'):startCam()};
$('#ocrBtn').onclick=()=>{$('#editMsg').textContent='Extract Text is coming soon (OCR not added yet).'};
// manual camera shutter -> go straight to crop; file pick too
