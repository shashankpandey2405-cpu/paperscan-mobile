// PaperScan live tracker (v9 shake-tolerant lock). MIT. Shared by app.js and web/test/shake_test.js.
(function(root){
function OneEuro(minCut,beta){let xp=null,dxp=0,tp=0;const al=(c,dt)=>{const r=2*Math.PI*c*dt;return r/(r+1)};
  return {reset(){xp=null;dxp=0},f(x,t,mc){if(xp===null){xp=x;tp=t;return x}const dt=Math.max(1e-3,(t-tp)/1000);tp=t;const dx=(x-xp)/dt;dxp=dxp+al(1,dt)*(dx-dxp);
    const c=(mc??minCut)+beta*Math.abs(dxp);xp=xp+al(c,dt)*(x-xp);return xp}}}
function polyArea(q){let a=0;for(let i=0;i<4;i++){const p=q[i],r=q[(i+1)%4];a+=p[0]*r[1]-r[0]*p[1]}return Math.abs(a)/2}
function inQ(p,q){let ins=false;for(let i=0,j=3;i<4;j=i++){const a=q[i],b=q[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])ins=!ins}return ins}
// coarse IoU of two quads on a 24x24 grid over their joint bbox (cheap, per frame)
function quadIoU(a,b){const xs=a.concat(b).map(p=>p[0]),ys=a.concat(b).map(p=>p[1]);const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),N=24;let i=0,u=0;
  for(let gy=0;gy<N;gy++)for(let gx=0;gx<N;gx++){const p=[x0+(gx+.5)*(x1-x0)/N,y0+(gy+.5)*(y1-y0)/N],A=inQ(p,a),B=inQ(p,b);i+=A&&B;u+=A||B}return u?i/u:0}
// thresholds. v8 -> v9: LOCK .72->.70, UNLOCK .55->.50 (EMA), unlock now needs BAD_N sustained bad frames or IoU<IOU_BREAK
// v11: SHOW .60->.55, LOCK .70->.66 (Madhoor per-frame outer score jitters .54-.83 under camera noise; geometry is stable)
// v12: INSTANT lock = 2 consecutive raw hits agreeing (IoU>=INSTANT_IOU) with min score>=INSTANT_MIN, no EMA ramp
const P={INSTANT_IOU:0.85,INSTANT_MIN:0.60,INSTANT_MEAN:0.68,SHOW:0.55,UNLOCK:0.50,LOCK:0.66,AUTO:0.75,GOOD_N:3,BAD_N:6,MISS_CLEAR:6,IOU_BREAK:0.45,JUMP_FREE:0.18,JUMP_LOCKED:0.35,SHRINK_N:8,EMA_FREE:0.4,EMA_LOCKED:0.15,MINCUT_LOCKED:0.6};
function Tracker(inQuad){
  const filt=[...Array(8)].map(()=>OneEuro(1.2,0.004));const S={prevRaw:null,lockedAt:0,smQ:null,lockScore:0,miss:0,bad:0,good:0,locked:false,hiSince:0,shrink:0};
  const reset=()=>{S.prevRaw=null;filt.forEach(f=>f.reset());S.smQ=null;S.locked=false;S.lockScore=0;S.good=0;S.bad=0;S.hiSince=0};
  function track(q,t,diag){
    const ok=q&&q.score>=P.SHOW;const pr=S.prevRaw;S.prevRaw=ok?{pts:q.pts,score:q.score}:null;
    const inst=ok&&pr&&Math.min(pr.score,q.score)>=P.INSTANT_MIN&&(pr.score+q.score)/2>=P.INSTANT_MEAN&&quadIoU(pr.pts,q.pts)>=P.INSTANT_IOU;
    // once locked, a smaller quad lying inside it (inner panel / ad box) is ignored for up to SHRINK_N frames
    if(ok&&S.locked&&S.smQ&&polyArea(q.pts)<0.75*polyArea(S.smQ)&&q.pts.every(p=>inQuad(p,S.smQ,0.03*diag))){if(++S.shrink<P.SHRINK_N){S.miss=0;return S.smQ}}else S.shrink=0;
    if(ok){
      if(S.smQ){let mv=0;for(let i=0;i<4;i++)mv=Math.max(mv,Math.hypot(q.pts[i][0]-S.smQ[i][0],q.pts[i][1]-S.smQ[i][1]));
        if(S.locked){ // shake: big per-frame motion allowed; only a real different quad (low IoU AND big jump) counts as bad
          const io=quadIoU(q.pts,S.smQ);
          if(io<P.IOU_BREAK&&mv>P.JUMP_LOCKED*diag){if(++S.bad>=P.BAD_N){reset();}else{S.miss=0;return S.smQ}}
        }else if(mv>P.JUMP_FREE*diag){filt.forEach(f=>f.reset());S.lockScore=0;S.good=0;S.hiSince=0}}
      if(S.smQ||!S.locked){
        S.miss=0;S.good++;const e=S.locked?P.EMA_LOCKED:P.EMA_FREE;S.lockScore=S.lockScore*(1-e)+q.score*e;
        if(S.locked&&q.score<P.UNLOCK+0.1)S.bad++;else S.bad=Math.max(0,S.bad-1);
        const mc=S.locked?P.MINCUT_LOCKED:undefined;S.smQ=q.pts.map((p,i)=>[filt[2*i].f(p[0],t,mc),filt[2*i+1].f(p[1],t,mc)]);
        if(q.score>=P.AUTO){if(!S.hiSince)S.hiSince=t}else S.hiSince=0;}
    }else{S.miss++;S.hiSince=0;if(S.locked)S.good=0;
      if(S.locked){S.bad++;S.lockScore*=0.92;if(S.miss>=P.MISS_CLEAR||S.bad>=P.BAD_N)reset();return S.smQ} // hold last quad through brief dropouts
      if(S.smQ&&S.miss<2){S.good=Math.max(0,S.good-1);return S.smQ} // one dropout before lock does not restart the streak
      reset();return null}
    if(S.locked){if(S.bad>=P.BAD_N||S.lockScore<P.UNLOCK){S.locked=false;S.good=0;S.bad=0}}
    else{S.locked=!!S.smQ&&(inst||S.good>=P.GOOD_N&&S.lockScore>=P.LOCK);if(S.locked){S.lockedAt=t;S.lockScore=Math.max(S.lockScore,P.LOCK);S.bad=0}}
    return S.smQ}
  return {track,S,reset}}
root.PaperTrack={Tracker,P,quadIoU,polyArea};if(typeof module!=='undefined')module.exports=root.PaperTrack;
})(typeof self!=='undefined'?self:globalThis);
