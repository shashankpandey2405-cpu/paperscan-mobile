/* PaperScan document detector (MIT). Pure JS, no deps; runs in browser and Node.
   Input: {data:RGBA,width,height} (already downscaled, ~240-360px wide).
   Multi-threshold paper masks -> components -> convex hull -> max-area quad
   -> scored by edge support, fill, paper-vs-surround contrast; rejects huge/frame-hugging quads. */
(function(root){
'use strict';
function otsu(v,n){const h=new Uint32Array(256);for(let i=0;i<n;i++)h[v[i]]++;let s=0;for(let i=0;i<256;i++)s+=i*h[i];
  let sB=0,wB=0,best=0,th=128;for(let t=0;t<256;t++){wB+=h[t];if(!wB)continue;const wF=n-wB;if(!wF)break;sB+=t*h[t];const d=sB/wB-(s-sB)/wF,x=wB*wF*d*d;if(x>best){best=x;th=t}}return th}
function pct(v,n,p){const h=new Uint32Array(256);for(let i=0;i<n;i++)h[v[i]]++;let c=0,k=n*p;for(let t=0;t<256;t++){c+=h[t];if(c>=k)return t}return 255}
function erode(m,W,H){const o=new Uint8Array(m.length);for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x;o[i]=m[i]&m[i-1]&m[i+1]&m[i-W]&m[i+W]&m[i-W-1]&m[i-W+1]&m[i+W-1]&m[i+W+1]}return o}
function dilate(m,W,H){const o=new Uint8Array(m.length);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(!m[i])continue;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=y+dy,xx=x+dx;if(yy>=0&&yy<H&&xx>=0&&xx<W)o[yy*W+xx]=1}}return o}
function hull(P){P.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const lo=[],up=[];
  for(const p of P){while(lo.length>1&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p)}
  for(let i=P.length-1;i>=0;i--){const p=P[i];while(up.length>1&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p)}
  lo.pop();up.pop();return lo.concat(up)}
function area(q){let a=0;for(let i=0;i<q.length;i++){const p=q[i],r=q[(i+1)%q.length];a+=p[0]*r[1]-r[0]*p[1]}return Math.abs(a)/2}
function maxQuad(h){ // max-area quad with vertices on hull, O(n^3)
  let H=h;if(H.length>48){const s=H.length/48;H=[];for(let i=0;i<48;i++)H.push(h[Math.floor(i*s)])}
  const n=H.length;if(n<4)return null;const tri=(a,b,c)=>Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
  let best=-1,bq=null;for(let i=0;i<n;i++)for(let k=i+2;k<n;k++){let b1=-1,j1=-1,b2=-1,j2=-1;
    for(let j=i+1;j<k;j++){const t=tri(H[i],H[j],H[k]);if(t>b1){b1=t;j1=j}}
    for(let j=k+1;j<n+i;j++){const jj=j%n;if(jj===i)continue;const t=tri(H[i],H[jj],H[k]);if(t>b2){b2=t;j2=jj}}
    if(j1<0||j2<0)continue;if(b1+b2>best){best=b1+b2;bq=[H[i],H[j1],H[k],H[j2]]}}
  return bq}
function order(q){const c=[q.reduce((s,p)=>s+p[0],0)/4,q.reduce((s,p)=>s+p[1],0)/4];const s=q.slice().sort((a,b)=>Math.atan2(a[1]-c[1],a[0]-c[0])-Math.atan2(b[1]-c[1],b[0]-c[0]));
  let k=0,m=1e9;s.forEach((p,i)=>{if(p[0]+p[1]<m){m=p[0]+p[1];k=i}});return [0,1,2,3].map(i=>s[(k+i)%4])} // TL,TR,BR,BL (clockwise in screen)
function blur(a,W,H){const t=new Float32Array(a.length),o=new Float32Array(a.length);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let s=0,c=0;for(let k=-2;k<=2;k++){const xx=x+k;if(xx<0||xx>=W)continue;const w=[1,4,6,4,1][k+2];s+=a[y*W+xx]*w;c+=w}t[y*W+x]=s/c}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let s=0,c=0;for(let k=-2;k<=2;k++){const yy=y+k;if(yy<0||yy>=H)continue;const w=[1,4,6,4,1][k+2];s+=t[yy*W+x]*w;c+=w}o[y*W+x]=s/c}return o}
function inter(l1,l2){const a1=Math.cos(l1.t),b1=Math.sin(l1.t),a2=Math.cos(l2.t),b2=Math.sin(l2.t),det=a1*b2-a2*b1;if(Math.abs(det)<1e-6)return null;
  return [(l1.r*b2-l2.r*b1)/det,(a1*l2.r-a2*l1.r)/det]}
function convex(q){let s=0;for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4],c=q[(i+2)%4];const z=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(Math.abs(z)<1e-9)return false;if(!s)s=Math.sign(z);else if(Math.sign(z)!==s)return false}return true}
const T={minArea:0.06,maxArea:0.62,maxAspect:3.2,maxAspectTall:5.5,faintChroma:5,faintKRef:1.7,paperMaxSat:18,paperMinLum:85,paperMinText:0.01,paperMaxText:0.4,minSide:0.5,maxSideSpread:0.45,minContrast:20,minScore:0.6,cornerMargin:0.01};
// paper cue: interior near-neutral (low saturation), not dark, with some dark text strokes. Used for tall receipts and the faint (chroma) pass.
function paperCue(img,q){const W=img.width,H=img.height,d=img.data;const c=[q.reduce((s,p)=>s+p[0],0)/4,q.reduce((s,p)=>s+p[1],0)/4];const qi=q.map(p=>[c[0]+(p[0]-c[0])*0.85,c[1]+(p[1]-c[1])*0.85]);
  const ins=(x,y)=>{let r=false;for(let i=0,j=3;i<4;j=i++){const a=qi[i],b=qi[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])r=!r}return r};
  let x0=1e9,x1=0,y0=1e9,y1=0;qi.forEach(p=>{x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1])});const L=[],S=[];
  for(let y=Math.max(0,y0|0);y<Math.min(H,y1);y+=2)for(let x=Math.max(0,x0|0);x<Math.min(W,x1);x+=2){if(!ins(x,y))continue;const i=(y*W+x)*4,r=d[i],g=d[i+1],b=d[i+2];L.push(.299*r+.587*g+.114*b);S.push(Math.max(r,g,b)-Math.min(r,g,b))}
  if(L.length<30)return {ok:false};const med=a=>a.slice().sort((u,v)=>u-v)[a.length>>1];const ml=med(L),ms=med(S),tx=L.filter(v=>v<ml-35).length/L.length;
  return {ok:ms<=T.paperMaxSat&&ml>=T.paperMinLum&&tx>=T.paperMinText&&tx<=T.paperMaxText,sat:ms,lum:ml,text:tx}}
function detectDoc(img,opt){opt=opt||{};const r=detectCore(img,opt);if(r||opt.chroma||!T.faintChroma)return r;
  // faint pass: paper about as bright as (or darker than) a light table (e.g. receipt on a white desk). Edges from blue-red chroma; must look like paper.
  const f=detectCore(img,Object.assign({},opt,{chroma:T.faintChroma}));if(!f)return null;const pc=paperCue(img,f.pts);if(opt.debug)console.log('FAINT',JSON.stringify(pc));if(!pc.ok)return null;f.faint=1;return f}
function detectCore(img,opt){
  opt=opt||{};const W=img.width,H=img.height,d=img.data,n=W*H,diag=Math.hypot(W,H);
  const g0=new Float32Array(n);for(let i=0;i<n;i++)g0[i]=opt.chroma?Math.max(0,Math.min(255,128+opt.chroma*(d[i*4+2]-d[i*4]))):.299*d[i*4]+.587*d[i*4+1]+.114*d[i*4+2];
  const g=blur(g0,W,H);
  const gx=new Float32Array(n),gy=new Float32Array(n),gm=new Float32Array(n);
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x;
    const X=g[i-W+1]+2*g[i+1]+g[i+W+1]-g[i-W-1]-2*g[i-1]-g[i+W-1],Y=g[i+W-1]+2*g[i+W]+g[i+W+1]-g[i-W-1]-2*g[i-W]-g[i-W+1];gx[i]=X;gy[i]=Y;gm[i]=Math.hypot(X,Y)}
  // non-max suppression -> thin edges; threshold at high percentile
  const nm=new Float32Array(n);for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x,m=gm[i];if(!m)continue;const ax=Math.abs(gx[i]),ay=Math.abs(gy[i]);let a,b;
    if(ax>2.4*ay){a=gm[i-1];b=gm[i+1]}else if(ay>2.4*ax){a=gm[i-W];b=gm[i+W]}else if(gx[i]*gy[i]>0){a=gm[i-W-1];b=gm[i+W+1]}else{a=gm[i-W+1];b=gm[i+W-1]}
    if(m>=a&&m>=b)nm[i]=m}
  const vals=[];for(let i=0;i<n;i+=3)if(nm[i]>0)vals.push(nm[i]);vals.sort((a,b)=>a-b);const eth=Math.max(24,vals.length?vals[Math.floor(vals.length*0.6)]:24);
  // oriented Hough
  const NT=180,NR=Math.ceil(diag)*2+1,acc=new Float32Array(NT*NR),cs=new Float32Array(NT),sn=new Float32Array(NT);
  for(let t=0;t<NT;t++){cs[t]=Math.cos(t*Math.PI/NT);sn[t]=Math.sin(t*Math.PI/NT)}
  for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){const i=y*W+x;if(nm[i]<eth)continue;let th=Math.atan2(gy[i],gx[i]);if(th<0)th+=Math.PI;const tc=Math.round(th/Math.PI*NT);
    for(let dt=-6;dt<=6;dt++){let t=tc+dt,flip=1;if(t<0){t+=NT;flip=-1}else if(t>=NT){t-=NT;flip=-1}const r=Math.round((x*cs[t]+y*sn[t]))+Math.ceil(diag);acc[t*NR+r]+=1}}
  const lines=[];const used=new Uint8Array(NT*NR);
  for(let k=0;k<28;k++){let bi=-1,bv=Math.max(10,0.08*Math.min(W,H));for(let i=0;i<acc.length;i++)if(!used[i]&&acc[i]>bv){bv=acc[i];bi=i}
    if(bi<0)break;const t=(bi/NR)|0,r=bi%NR;lines.push({t:t*Math.PI/NT,r:r-Math.ceil(diag),v:bv});
    for(let dt=-5;dt<=5;dt++)for(let dr=-6;dr<=6;dr++){let tt=t+dt,rr=r+dr;if(tt<0){tt+=NT;rr=2*Math.ceil(diag)-rr}else if(tt>=NT){tt-=NT;rr=2*Math.ceil(diag)-rr}if(rr>=0&&rr<NR)used[tt*NR+rr]=1}}
  // side support: fraction of samples with an aligned edge pixel within +-2px
  const side=(a,b)=>{const L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<4)return {s:0,c:0};const nx=-(b[1]-a[1])/L,ny=(b[0]-a[0])/L,steps=Math.max(6,Math.round(L/1.5));let hit=0,tot=0,ci=0,co=0,cn=0,mg=0;
    for(let s=1;s<steps;s++){const t=s/steps,px=a[0]+(b[0]-a[0])*t,py=a[1]+(b[1]-a[1])*t;let ok=0,mm=0;
      for(let o=-2;o<=2;o++){const x=Math.round(px+nx*o),y=Math.round(py+ny*o);if(x<1||y<1||x>=W-1||y>=H-1)continue;const i=y*W+x;if(gm[i]>mm)mm=gm[i];if(ok)continue;if(nm[i]<eth*0.6&&gm[i]<eth)continue;const al=Math.abs(gx[i]*nx+gy[i]*ny)/(gm[i]+1e-6);if(al>0.85)ok=1}
      tot++;hit+=ok;mg+=mm;
      const xi=Math.round(px+nx*4),yi=Math.round(py+ny*4),xo=Math.round(px-nx*4),yo=Math.round(py-ny*4);
      if(xi>=0&&yi>=0&&xi<W&&yi<H&&xo>=0&&yo>=0&&xo<W&&yo<H){ci+=g[yi*W+xi];co+=g[yo*W+xo];cn++}}
    const c=cn?(ci-co)/cn:0;return {s:tot?hit/tot:0,c,k:tot?(mg/tot)/(Math.abs(c)+5):0}};
  const cands=[];const m=Math.max(W,H)*0.03;
  for(let a=0;a<lines.length;a++)for(let b=a+1;b<lines.length;b++){
    const dab=Math.abs(Math.sin(lines[a].t-lines[b].t));if(dab>0.35)continue; // a,b roughly parallel
    for(let c=0;c<lines.length;c++){if(c===a||c===b)continue;if(Math.abs(Math.sin(lines[a].t-lines[c].t))<0.6)continue;
      for(let e=c+1;e<lines.length;e++){if(e===a||e===b)continue;if(Math.abs(Math.sin(lines[c].t-lines[e].t))>0.35||Math.abs(Math.sin(lines[a].t-lines[e].t))<0.6)continue;
        if(c<a)continue; // each pair-of-pairs once (c>a)
        const p=[inter(lines[a],lines[c]),inter(lines[c],lines[b]),inter(lines[b],lines[e]),inter(lines[e],lines[a])];
        if(p.some(v=>!v||v[0]<-m||v[1]<-m||v[0]>W+m||v[1]>H+m))continue;if(!convex(p))continue;
        const q=order(p),qa=area(q),af=qa/n;if(af<T.minArea||af>T.maxArea)continue;
        const sd=i=>Math.hypot(q[i][0]-q[(i+1)%4][0],q[i][1]-q[(i+1)%4][1]),w1=(sd(0)+sd(2))/2,h1=(sd(1)+sd(3))/2,ar=Math.max(w1,h1)/Math.min(w1,h1);if(ar>T.maxAspectTall)continue;const tall=ar>T.maxAspect;
        if(Math.min(sd(0),sd(2))/Math.max(sd(0),sd(2))<0.5||Math.min(sd(1),sd(3))/Math.max(sd(1),sd(3))<0.5)continue;
        // interior angles 50..130 deg
        let badAng=false;for(let i=0;i<4;i++){const A=q[(i+3)%4],B=q[i],C=q[(i+1)%4],v1=[A[0]-B[0],A[1]-B[1]],v2=[C[0]-B[0],C[1]-B[1]];const cosA=(v1[0]*v2[0]+v1[1]*v2[1])/(Math.hypot(...v1)*Math.hypot(...v2));if(Math.abs(cosA)>0.65)badAng=true}if(badAng)continue;
        const S=[0,1,2,3].map(i=>side(q[i],q[(i+1)%4]));
        // q is clockwise on screen -> inward normal (-dy,dx)/L points inside; c>0 means inside brighter
        const sup=S.map(v=>v.s),minS=Math.min(...sup),meanS=sup.reduce((x,y)=>x+y)/4;if(minS<T.minSide||Math.max(...sup)-minS>T.maxSideSpread)continue;
        const minC=Math.min(...S.map(v=>v.c)),meanC=S.reduce((x,v)=>x+v.c,0)/4;if(minC<T.minContrast)continue;
        const cm=T.cornerMargin*Math.max(W,H);let cb=0;for(const pp of q)if(pp[0]<cm||pp[1]<cm||pp[0]>W-1-cm||pp[1]>H-1-cm)cb++;let out=0;const om=0.005*Math.max(W,H);for(const pp of q)if(pp[0]<-om||pp[1]<-om||pp[0]>W-1+om||pp[1]>H-1+om)out++;if(out||cb>=2)continue;
        if(tall&&!paperCue(img,q).ok)continue; // long receipts allowed only if the interior looks like paper
        const score=(0.5*meanS+0.5*minS)*Math.min(1,meanC/40)*Math.min(1,0.6+minC/50)*(cb>=2?0.5:1)*(af>0.55?0.75:1)*(0.85+0.15*Math.min(1,af/0.15));
        const minK=Math.min(...S.map(v=>v.k));const score2=score*Math.pow(Math.min(1,minK/(opt.chroma?T.faintKRef:2.2)),2); // soft shadow boundaries are not paper edges
        cands.push({q,score:score2,edge:meanS,minS,minC,ks:S.map(v=>+v.k.toFixed(2)),fill:1,con:meanC,areaFrac:af})}}}
  cands.sort((a,b)=>b.score-a.score);if(opt.debug)console.log(lines.map(l=>[(l.t*180/Math.PI)|0,l.r,l.v|0]).join(' '));if(opt.debug)console.log('lines',lines.length,'eth',eth|0,'\n'+cands.slice(0,6).map(c=>JSON.stringify({q:c.q.map(p=>p.map(Math.round)),s:+c.score.toFixed(3),e:+c.edge.toFixed(2),mn:+c.minS.toFixed(2),con:c.con|0,mc:c.minC|0,k:c.ks,a:+c.areaFrac.toFixed(3)})).join('\n'));
  // prefer the OUTERMOST plausible page: a candidate that contains the top one with similar score wins (inner printed boxes / QR frames lose)
  let best=cands[0];if(!best||best.score<T.minScore)return null;
  const inside=(p,q)=>{let ins=false;for(let i=0,j=3;i<4;j=i++){const a=q[i],b=q[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])ins=!ins}return ins};
  const segD=(p,q)=>{let m=1e9;for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));m=Math.min(m,Math.hypot(a[0]+dx*t-p[0],a[1]+dy*t-p[1]))}return m};
  const p90=(q,ex,thr)=>{let x0=1e9,x1=0,y0=1e9,y1=0;q.forEach(p=>{x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1])});const v=[];
    for(let y=Math.max(0,y0|0);y<Math.min(H,y1);y+=2)for(let x=Math.max(0,x0|0);x<Math.min(W,x1);x+=2){const p=[x,y];if(inside(p,q)&&!(ex&&inside(p,ex)))v.push(g[y*W+x])}
    if(v.length<20)return 0;if(thr)return v.filter(z=>z>=thr).length/v.length;v.sort((a,b)=>a-b);return v[Math.floor(v.length*0.9)]};
  let bp90=-1;for(let it=0;it<1;it++){const tol=Math.max(W,H)*0.015;let up=null;
    if(opt.debug)for(const c of cands)if(c.areaFrac>best.areaFrac*1.15&&c.areaFrac<best.areaFrac*2.2&&c.score>best.score*0.7)console.log("C",JSON.stringify(c.q.map(p=>p.map(Math.round))),c.score.toFixed(3),c.minS.toFixed(2),c.minC|0,c.areaFrac.toFixed(3),best.q.map(p=>(inside(p,c.q)?"in":segD(p,c.q).toFixed(1))).join());
    for(const c of cands){if(c===best||c.areaFrac<best.areaFrac*1.15||c.areaFrac>best.areaFrac*6||c.minC<T.minContrast||c.score<best.score*0.8||c.minS<0.5)continue;
      if(best.q.every(p=>inside(p,c.q)||segD(p,c.q)<tol)&&p90(c.q,best.q,0.8*(bp90<0?(bp90=p90(best.q)):bp90))>=0.5&&(!up||c.score*Math.sqrt(c.areaFrac)>up.score*Math.sqrt(up.areaFrac)))up=c}
    if(opt.debug)console.log("UP",up&&JSON.stringify(up.q));if(!up)break;best=up}const q=best.q;
  let sharp=0,lm=0,c=0;let x0=1e9,x1=0,y0=1e9,y1=0;q.forEach(p=>{x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1])});
  for(let y=Math.max(1,y0|0);y<Math.min(H-1,y1);y++)for(let x=Math.max(1,x0|0);x<Math.min(W-1,x1);x++){const i=y*W+x,l=4*g0[i]-g0[i-1]-g0[i+1]-g0[i-W]-g0[i+W];lm+=l;sharp+=l*l;c++}
  sharp=c?sharp/c-(lm/c)**2:0;
  return {pts:q.map(p=>[Math.max(0,Math.min(W,p[0])),Math.max(0,Math.min(H,p[1]))]),score:best.score,edge:best.edge,minEdge:best.minS,contrast:best.con,areaFrac:best.areaFrac,sharp,n:cands.length};
}
root.PaperDetect={T,detectDoc,paperCue,area,order};
if(typeof module!=='undefined')module.exports=root.PaperDetect;
})(typeof self!=='undefined'?self:globalThis);
