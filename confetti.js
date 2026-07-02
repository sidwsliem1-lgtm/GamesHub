// Shared celebration effect — auto-fires a confetti burst whenever a
// ".finished-trophy" element (win/result screen) appears in the DOM.
// No per-game code changes needed; just include this script.
(function(){
  const COLORS = ['#F0C24B', '#C9A227', '#B5651D', '#7A9B6E', '#EDE6D6'];

  function burstConfetti(target){
    const wrap = document.createElement('div');
    wrap.className = 'confetti-wrap';
    wrap.style.position = 'fixed';
    wrap.style.left = '0';
    wrap.style.top = '0';
    wrap.style.width = '100%';
    wrap.style.pointerEvents = 'none';
    wrap.style.zIndex = '9999';
    document.body.appendChild(wrap);

    const count = 36;
    for(let i=0;i<count;i++){
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.position = 'fixed';
      piece.style.left = (10 + Math.random()*80) + '%';
      piece.style.top = '-10px';
      piece.style.background = COLORS[Math.floor(Math.random()*COLORS.length)];
      piece.style.animationDelay = (Math.random()*0.3) + 's';
      piece.style.animationDuration = (1 + Math.random()*0.8) + 's';
      wrap.appendChild(piece);
    }
    setTimeout(() => wrap.remove(), 2200);
  }

  let lastFired = 0;
  const observer = new MutationObserver(() => {
    const trophy = document.querySelector('.finished-trophy');
    if(trophy){
      const now = Date.now();
      if(now - lastFired > 800){ // avoid re-firing on every re-render while visible
        lastFired = now;
        burstConfetti();
      }
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app') || document.body;
    observer.observe(app, {childList:true, subtree:true});
  });
})();
