/* PaperScan live pipeline (MIT). Shared by app.js and test/lockstress.js so the test runs the exact app logic.
   step(img@~300px, tMs, live) -> smoothed quad (img coords) or null; .locked, .lastRaw. */
(function(root){
function LivePipe(D,TK,opt){opt=opt||{};const v10=!!opt.v10;const TR=TK.Tracker(D.inQuad);
  let emptyRun=0,lastFaint=false,frameN=0,outerN=0,hold=null;const HOLD=700;
  const self={TR,locked:false,lastRaw:null,hiSince:0,reset(){TR.reset();hold=null;outerN=0}};
  self.step=function(img,now,live){const W=img.width;
    const nf=live&&!lastFaint&&emptyRun>=2&&(frameN++%3!==0);
    // v11: before lock / while unlocked the outer pass runs EVERY frame (it is the only pass that finds dark photo flyers);
    // once locked it runs every 2nd frame (track only needs confirmation). v10 ran it every 3rd frame and dropped the hold after 350 ms.
    const every=v10?3:(TR.S.locked?2:1);const outerNow=!live||(outerN++%every===0);
    let r=D.detectDoc(img,{noFaint:nf,outer:outerNow,outerW:live?240:[200,240,300]});self.lastRaw=r;
    if(live){if(!v10&&outerNow&&!(r&&r.outer)&&!r)hold=null; // v11: outer pass ran and saw nothing -> page gone, drop the hold (fast unlock)
      if(r&&r.outer)hold={pts:r.pts,score:r.score,t:now};
      else if(hold&&now-hold.t<HOLD){if(!r||r.pts.every(p=>D.inQuad(p,hold.pts,0.03*W)))r=r?Object.assign({},r,{pts:hold.pts,score:Math.max(r.score,hold.score),held:1}):((v10?now-hold.t<HOLD*0.5:!outerNow)?{pts:hold.pts,score:hold.score,sharp:99,held:1}:null);else hold=null}
      else hold=null;emptyRun=r?0:emptyRun+1;lastFaint=!!(r&&r.faint)}
    const q=TR.track(r?{pts:r.pts,score:r.score}:null,now,Math.hypot(W,img.height));self.locked=TR.S.locked;self.hiSince=TR.S.hiSince;self.raw=r;
    // v11 display vote: an unlocked outline is drawn only after 2 consecutive consistent detections (isolated noise hits on tubes never show)
    if(!v10&&q&&!TR.S.locked&&TR.S.good<2)return null;return q};
  return self}
root.PaperLive={LivePipe};if(typeof module!=='undefined')module.exports=root.PaperLive;
})(typeof self!=='undefined'?self:globalThis);
