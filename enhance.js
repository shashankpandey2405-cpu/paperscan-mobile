/* PaperScan geometry + enhance (MIT). Pure JS, browser + Node.
   trueAspect(): real width/height of a planar rectangle seen in perspective (Zhang & He 2003,
   "Whiteboard scanning and image enhancement" — pinhole camera, principal point at image centre). */
(function(root){'use strict';
const cr=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dt=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const D=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
// q = TL,TR,BR,BL in image px; W,H = image size. Returns {w,h} output size in px (keeps resolution of the longer sides).
function outSize(q,W,H,maxSide){maxSide=maxSide||2000;
  const top=D(q[0],q[1]),bot=D(q[3],q[2]),lef=D(q[0],q[3]),rig=D(q[1],q[2]);
  const naive=((top+bot)/2)/((lef+rig)/2);let ratio=naive,f=null,how='edges';
  const u0=W/2,v0=H/2,m=p=>[p[0]-u0,p[1]-v0,1];
  const m1=m(q[0]),m2=m(q[1]),m3=m(q[3]),m4=m(q[2]); // m1 TL, m2 TR, m3 BL, m4 BR
  const k2=dt(cr(m1,m4),m3)/dt(cr(m2,m4),m3),k3=dt(cr(m1,m4),m2)/dt(cr(m3,m4),m2);
  const n2=[k2*m2[0]-m1[0],k2*m2[1]-m1[1],k2-1],n3=[k3*m3[0]-m1[0],k3*m3[1]-m1[1],k3-1];
  const L=Math.max(W,H);
  if(Math.abs(n2[2])>1e-3&&Math.abs(n3[2])>1e-3){const f2=-(n2[0]*n3[0]+n2[1]*n3[1])/(n2[2]*n3[2]);if(f2>0){f=Math.sqrt(f2)}}
  // phones: f ~ 0.7..1.4 x long side. Implausible f (noise, near-frontal) -> assume 0.85 x long side.
  if(!(f>0.5*L&&f<2.2*L)){f=0.85*L;how='prior-f'}else how='zhang';
  const nn=n=>(n[0]*n[0]+n[1]*n[1])/(f*f)+n[2]*n[2];const r=Math.sqrt(nn(n2)/nn(n3));
  if(isFinite(r)&&r>0.1&&r<10&&Math.abs(Math.log(r/naive))<0.7)ratio=r;else how='edges';
  // snap to common paper sizes only when already very close (A4/A-series 1:1.414, Letter 1:1.294)
  const tall=ratio<1,R=tall?1/ratio:ratio;let snap=null;for(const s of [1.4142,1.2941])if(Math.abs(R-s)/s<0.035)snap=s;
  const RR=snap||R;ratio=tall?1/RR:RR;
  let w=Math.max(top,bot),h=w/ratio;const lh=Math.max(lef,rig);if(h<lh){h=lh;w=h*ratio}
  const sc=Math.min(1.5,maxSide/Math.max(w,h));return {w:Math.max(8,Math.round(w*sc)),h:Math.max(8,Math.round(h*sc)),ratio,how,f,snap}}

// ---- Magic enhance: background (paper+shadow) normalisation, ink-preserving levels, mild colour + sharpen ----
// px: RGBA Uint8ClampedArray (modified in place)
function bgMap(px,W,H){const S=Math.max(1,Math.round(Math.max(W,H)/96)),bw=Math.ceil(W/S),bh=Math.ceil(H/S),g=new Float32Array(bw*bh);
  // block 85th-percentile luminance ~ paper (ignores dark text)
  for(let by=0;by<bh;by++)for(let bx=0;bx<bw;bx++){const v=[];for(let y=by*S;y<Math.min(H,by*S+S);y+=Math.max(1,S>>2))for(let x=bx*S;x<Math.min(W,bx*S+S);x+=Math.max(1,S>>2)){const i=(y*W+x)*4;v.push(.299*px[i]+.587*px[i+1]+.114*px[i+2])}v.sort((a,b)=>a-b);g[by*bw+bx]=v[Math.floor(v.length*.85)]||0}
  // max filter r=2 (fill text holes), then box blur r=3 x2 (smooth shadows)
  let a=new Float32Array(g.length);for(let y=0;y<bh;y++)for(let x=0;x<bw;x++){let mx=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const yy=Math.min(bh-1,Math.max(0,y+dy)),xx=Math.min(bw-1,Math.max(0,x+dx));mx=Math.max(mx,g[yy*bw+xx])}a[y*bw+x]=mx}
  for(let it=0;it<2;it++){const b=new Float32Array(a.length);for(let y=0;y<bh;y++)for(let x=0;x<bw;x++){let s=0,c=0;for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const yy=y+dy,xx=x+dx;if(yy<0||xx<0||yy>=bh||xx>=bw)continue;s+=a[yy*bw+xx];c++}b[y*bw+x]=s/c}a=b}
  return (x,y)=>{const fx=Math.min(bw-1.001,Math.max(0,x/S-.5)),fy=Math.min(bh-1.001,Math.max(0,y/S-.5)),x0=fx|0,y0=fy|0,tx=fx-x0,ty=fy-y0,x1=Math.min(bw-1,x0+1),y1=Math.min(bh-1,y0+1);
    return (a[y0*bw+x0]*(1-tx)+a[y0*bw+x1]*tx)*(1-ty)+(a[y1*bw+x0]*(1-tx)+a[y1*bw+x1]*tx)*ty}}
function enhance(px,W,H,mode){const bg=bgMap(px,W,H),n=W*H;
  const P={magic:{gmax:2.0,white:0.90,sat:1.18,sharp:0.45,ink:1},color:{gmax:1.7,white:0.95,sat:1.0,sharp:0.25,ink:0.6},gray:{gmax:2.0,white:0.90,sat:0,sharp:0.4,ink:1},
    lighten:{gmax:1.5,white:0.98,sat:1.05,sharp:0,ink:0.3},bw:{gmax:2.2}}[mode]||{gmax:2.0,white:0.9,sat:1.15,sharp:0.4,ink:1};
  const Lr=new Float32Array(n);
  for(let y=0,k=0;y<H;y++)for(let x=0;x<W;x++,k++){const i=k*4,b=Math.max(1,bg(x,y)),gain=Math.min(P.gmax,235/b); // gain capped: dark non-paper areas never get blown out
    for(let c=0;c<3;c++)px[i+c]=Math.min(255,px[i+c]*gain);Lr[k]=(.299*px[i]+.587*px[i+1]+.114*px[i+2])/Math.min(255,b*gain)}
  if(mode==='bw'){ // Sauvola-like on normalised luminance: ink if well below local paper
    for(let k=0;k<n;k++){const v=Lr[k]<0.8?0:255;px[k*4]=px[k*4+1]=px[k*4+2]=v}return}
  // ink black point: 1.5th percentile of normalised luminance, never stretch more than needed
  const h=new Uint32Array(256);for(let k=0;k<n;k+=3)h[Math.min(255,Lr[k]*255|0)]++;let c=0,tot=Math.ceil(n/3),bp=0;for(let t=0;t<256;t++){c+=h[t];if(c>=tot*0.015){bp=t;break}}
  const B=Math.min(0.45,bp/255)*P.ink,Wt=P.white;
  // smooth curve: paper (>=white) -> 255, ink (<=B) -> near 0, mid-tones linear-ish (keeps thin strokes & grey table lines)
  const curve=v=>{let t=(v-B)/(Wt-B);t=t<0?0:t>1?1:t;return t*t*(3-2*t)*0.35+t*0.65};
  for(let k=0;k<n;k++){const i=k*4,l=Math.max(1e-3,(.299*px[i]+.587*px[i+1]+.114*px[i+2])/255),r=Lr[k],tL=curve(r)*255,s=tL/(l*255);
    let R=px[i]*s,G=px[i+1]*s,Bc=px[i+2]*s;if(P.sat!==1){const m=(R+G+Bc)/3;R=m+(R-m)*P.sat;G=m+(G-m)*P.sat;Bc=m+(Bc-m)*P.sat}
    px[i]=R<0?0:R>255?255:R;px[i+1]=G<0?0:G>255?255:G;px[i+2]=Bc<0?0:Bc>255?255:Bc}
  if(P.sharp)sharpen(px,W,H,P.sharp)}
function sharpen(d,W,H,amt){const s=new Uint8ClampedArray(d);for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=(y*W+x)*4;for(let c=0;c<3;c++){const b=(s[i+c]*4+s[i-4+c]+s[i+4+c]+s[i-W*4+c]+s[i+W*4+c])/8;const v=s[i+c]+amt*2*(s[i+c]-b);d[i+c]=v<0?0:v>255?255:v}}}
root.PaperEnhance={outSize,enhance,bgMap};if(typeof module!=='undefined')module.exports=root.PaperEnhance;
})(typeof self!=='undefined'?self:this);
