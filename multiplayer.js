// ============================================================
// Shared multiplayer engine for the game hub.
// Provides:
//   1) An entry modal: "Play remotely" (PeerJS room+code) vs "Play on this device".
//   2) A generic host-authoritative sync layer so any game can add
//      real remote play with minimal code: wrap your local mutation
//      functions as "actions", and MP handles routing + state sync.
// ============================================================
const MP = (function(){
  // STUN discovers your public address for direct P2P; TURN relays traffic
  // when direct P2P is blocked (common on mobile carriers, office/school
  // Wi-Fi, and some home routers). Without a TURN fallback, connections
  // between such networks fail silently with no useful error.
  const PEER_ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:openrelay.metered.ca:80' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ]
  };

  let mode = null;        // 'local' | 'remote'
  let isHost = false;
  let peer = null;
  let conn = null;
  let gameConfig = null;  // {getState, setState, actions, onStart}
  let myName = '';
  let peerName = '';

  function el(html){
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  }

  function injectModalStyles(){
    if(document.getElementById('mp-styles')) return;
    const style = document.createElement('style');
    style.id = 'mp-styles';
    style.textContent = `
      .mp-overlay{
        position:fixed;inset:0;background:rgba(10,8,5,0.82);
        display:flex;align-items:center;justify-content:center;
        z-index:10000;padding:20px;backdrop-filter:blur(3px);
      }
      .mp-box{
        background:linear-gradient(180deg, var(--panel-alt), var(--panel));
        border:1px solid var(--border);border-radius:18px;padding:26px 22px;
        max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.5);
      }
      .mp-box h3{margin:0 0 6px;color:var(--brass-bright);font-size:19px;text-align:center;}
      .mp-box p.sub{color:var(--text-muted);font-size:13px;text-align:center;margin:0 0 20px;}
      .mp-choice-btn{
        display:flex;align-items:center;gap:14px;width:100%;
        background:#0F0C09;border:1px solid var(--border);border-radius:12px;
        padding:16px;margin-bottom:12px;cursor:pointer;text-align:right;
        color:var(--text);transition:border-color .15s, transform .1s;
      }
      .mp-choice-btn:hover{border-color:var(--brass);transform:translateY(-2px);}
      .mp-choice-btn .ic{font-size:28px;}
      .mp-choice-btn .lbl{font-weight:700;font-size:15px;color:var(--brass-bright);}
      .mp-choice-btn .desc{font-size:12px;color:var(--text-muted);margin-top:2px;}
      .mp-tabs{display:flex;gap:8px;margin-bottom:16px;}
      .mp-tab{flex:1;text-align:center;padding:10px;border-radius:10px;border:1px solid var(--border);
        color:var(--text-muted);cursor:pointer;font-weight:700;font-size:13.5px;}
      .mp-tab.active{background:var(--brass);color:#1A1408;border-color:var(--brass);}
      .mp-box input[type=text]{
        width:100%;background:#0F0C09;border:1px solid var(--border);color:var(--text);
        border-radius:10px;padding:11px 13px;font-size:15px;font-family:'Tajawal',sans-serif;
        margin-bottom:12px;outline:none;
      }
      .mp-box input:focus{border-color:var(--brass);}
      .mp-box button.mp-primary{
        width:100%;background:linear-gradient(180deg, var(--brass-bright), var(--brass));
        color:#1A1408;font-weight:700;font-size:14.5px;border:none;border-radius:10px;
        padding:12px;cursor:pointer;font-family:'Tajawal',sans-serif;
      }
      .mp-box button.mp-primary:disabled{opacity:.4;cursor:default;}
      .mp-box .mp-back{
        text-align:center;color:var(--text-muted);font-size:12.5px;margin-top:12px;cursor:pointer;
      }
      .mp-box .mp-back:hover{color:var(--brass-bright);}
      .mp-code-display{
        text-align:center;font-size:20px;letter-spacing:1px;color:var(--brass-bright);
        word-break:break-all;background:#0F0C09;border:1px solid var(--border);
        border-radius:10px;padding:12px;margin-bottom:10px;font-family:'Big Shoulders Stencil',sans-serif;
        direction:ltr;
      }
      .mp-hint{font-size:12px;color:var(--text-muted);text-align:center;margin-bottom:14px;}
      .mp-err{color:var(--danger);font-size:12.5px;text-align:center;margin:-4px 0 12px;}
      .mp-status-bar{
        position:fixed;top:0;left:0;right:0;z-index:9998;
        background:rgba(122,155,110,0.12);border-bottom:1px solid rgba(122,155,110,.35);
        color:var(--success);font-size:12.5px;text-align:center;padding:6px;
      }
      .mp-status-bar.bad{background:rgba(181,82,74,0.12);border-color:rgba(181,82,74,.35);color:var(--danger);}
    `;
    document.head.appendChild(style);
  }

  function showOverlay(contentEl){
    closeOverlay();
    const overlay = el(`<div class="mp-overlay" id="mp-overlay"></div>`);
    overlay.appendChild(contentEl);
    document.body.appendChild(overlay);
  }
  function closeOverlay(){
    const existing = document.getElementById('mp-overlay');
    if(existing) existing.remove();
  }

  function showStatusBar(text, bad){
    let bar = document.getElementById('mp-status-bar');
    if(!bar){
      bar = el(`<div class="mp-status-bar" id="mp-status-bar"></div>`);
      document.body.prepend(bar);
    }
    bar.className = 'mp-status-bar' + (bad ? ' bad' : '');
    bar.textContent = text;
  }

  function showChoiceModal(){
    injectModalStyles();
    const box = el(`
      <div class="mp-box">
        <h3>كيف تريد اللعب؟</h3>
        <p class="sub">اختر طريقة اللعب قبل البدء</p>
        <div class="mp-choice-btn" id="mp-choice-remote">
          <div class="ic">🌐</div>
          <div><div class="lbl">العب عن بُعد</div><div class="desc">أنشئ غرفة وشارك الكود مع صديقك من أي مكان</div></div>
        </div>
        <div class="mp-choice-btn" id="mp-choice-local">
          <div class="ic">📱</div>
          <div><div class="lbl">العب على نفس الجهاز</div><div class="desc">مرّرا الجهاز بينكما بالتناوب</div></div>
        </div>
      </div>
    `);
    showOverlay(box);
    box.querySelector('#mp-choice-local').onclick = () => {
      mode = 'local';
      closeOverlay();
      if(gameConfig && gameConfig.onStart) gameConfig.onStart('local');
    };
    box.querySelector('#mp-choice-remote').onclick = () => {
      showRemoteSetup();
    };
  }

  function showRemoteSetup(){
    injectModalStyles();
    const box = el(`
      <div class="mp-box">
        <h3>اللعب عن بُعد</h3>
        <div class="mp-tabs">
          <div class="mp-tab active" id="mp-tab-create">إنشاء غرفة</div>
          <div class="mp-tab" id="mp-tab-join">الانضمام</div>
        </div>
        <div id="mp-remote-body"></div>
        <div class="mp-back" id="mp-back">→ رجوع</div>
      </div>
    `);
    showOverlay(box);
    box.querySelector('#mp-back').onclick = showChoiceModal;

    let tab = 'create';
    function renderBody(){
      box.querySelector('#mp-tab-create').classList.toggle('active', tab==='create');
      box.querySelector('#mp-tab-join').classList.toggle('active', tab==='join');
      const bodyEl = box.querySelector('#mp-remote-body');
      if(tab === 'create'){
        bodyEl.innerHTML = `
          <input type="text" id="mp-name-input" placeholder="اسمك">
          <div class="mp-err" id="mp-err"></div>
          <button class="mp-primary" id="mp-create-btn">إنشاء الغرفة 🔐</button>
        `;
        bodyEl.querySelector('#mp-create-btn').onclick = () => doCreateRoom(bodyEl);
      } else {
        bodyEl.innerHTML = `
          <input type="text" id="mp-name-input" placeholder="اسمك">
          <input type="text" id="mp-code-input" placeholder="الصق كود الغرفة هنا">
          <div class="mp-err" id="mp-err"></div>
          <button class="mp-primary" id="mp-join-btn">الانضمام 🚪</button>
        `;
        bodyEl.querySelector('#mp-join-btn').onclick = () => doJoinRoom(bodyEl);
      }
    }
    box.querySelector('#mp-tab-create').onclick = () => { tab='create'; renderBody(); };
    box.querySelector('#mp-tab-join').onclick = () => { tab='join'; renderBody(); };
    renderBody();
  }

  function setErr(bodyEl, msg){
    const e = bodyEl.querySelector('#mp-err');
    if(e) e.textContent = msg;
  }

  function doCreateRoom(bodyEl){
    const name = bodyEl.querySelector('#mp-name-input').value.trim();
    if(!name){ setErr(bodyEl, 'الرجاء إدخال اسمك'); return; }
    const btn = bodyEl.querySelector('#mp-create-btn');
    btn.disabled = true; btn.textContent = 'جارٍ الإنشاء...';
    myName = name;
    isHost = true;

    try{ peer = new Peer(undefined, {config: PEER_ICE_CONFIG}); }
    catch(e){ setErr(bodyEl, 'تعذر تشغيل نظام الاتصال'); btn.disabled=false; btn.textContent='إنشاء الغرفة 🔐'; return; }

    peer.on('open', (id) => {
      bodyEl.innerHTML = `
        <div class="mp-code-display">${id}</div>
        <div class="mp-hint">شارك هذا الكود مع صديقك — بانتظار انضمامه...</div>
        <button class="mp-primary" id="mp-copy-btn" style="background:transparent;color:var(--brass-bright);border:1px solid var(--border);">نسخ الكود</button>
      `;
      bodyEl.querySelector('#mp-copy-btn').onclick = () => {
        navigator.clipboard?.writeText(id).catch(()=>{});
      };
    });
    peer.on('error', (err) => {
      setErr(bodyEl, 'تعذر إنشاء الغرفة (' + (err?.type || 'خطأ') + ')');
      btn.disabled = false; btn.textContent = 'إنشاء الغرفة 🔐';
    });
    peer.on('connection', (c) => {
      if(conn) { c.close(); return; }
      conn = c;
      setupConnHandlers();
      conn.on('open', () => {
        conn.on('data', (msg) => {
          if(msg.type === '__join__'){
            peerName = msg.name;
            conn.send({type:'__welcome__', hostName: myName});
            mode = 'remote';
            closeOverlay();
            showStatusBar('🌐 متصل بـ ' + peerName);
            if(gameConfig && gameConfig.onStart) gameConfig.onStart('remote', true, myName, peerName);
          } else {
            handleIncoming(msg);
          }
        });
      });
    });
  }

  function doJoinRoom(bodyEl){
    const name = bodyEl.querySelector('#mp-name-input').value.trim();
    const code = bodyEl.querySelector('#mp-code-input').value.trim();
    if(!name){ setErr(bodyEl, 'الرجاء إدخال اسمك'); return; }
    if(!code){ setErr(bodyEl, 'الرجاء إدخال كود الغرفة'); return; }
    const btn = bodyEl.querySelector('#mp-join-btn');
    btn.disabled = true; btn.textContent = 'جارٍ الاتصال...';
    myName = name;
    isHost = false;

    try{ peer = new Peer(undefined, {config: PEER_ICE_CONFIG}); }
    catch(e){ setErr(bodyEl, 'تعذر تشغيل نظام الاتصال'); btn.disabled=false; btn.textContent='الانضمام 🚪'; return; }

    peer.on('error', (err) => {
      setErr(bodyEl, 'تعذر الاتصال (' + (err?.type || 'خطأ') + '). تأكد من صحة الكود');
      btn.disabled = false; btn.textContent = 'الانضمام 🚪';
    });

    peer.on('open', () => {
      conn = peer.connect(code, {reliable: true});
      setupConnHandlers();
      conn.on('open', () => {
        conn.send({type:'__join__', name: myName});
        conn.on('data', (msg) => {
          if(msg.type === '__welcome__'){
            peerName = msg.hostName;
            mode = 'remote';
            closeOverlay();
            showStatusBar('🌐 متصل بـ ' + peerName);
            if(gameConfig && gameConfig.onStart) gameConfig.onStart('remote', false, myName, peerName);
          } else {
            handleIncoming(msg);
          }
        });
      });
      setTimeout(() => {
        if(btn.disabled && !conn.open){
          setErr(bodyEl, 'لم يتم الرد خلال 20 ثانية. تأكد من صحة الكود، وأن صديقك لم يُحدّث صفحته بعد مشاركة الكود (كل تحديث للصفحة يُنشئ كوداً جديداً)، وجرّب شبكة إنترنت أخرى إن استمرت المشكلة');
          btn.disabled = false; btn.textContent = 'الانضمام 🚪';
        }
      }, 20000);
    });
  }

  function setupConnHandlers(){
    conn.on('close', () => showStatusBar('⚠ انقطع الاتصال بصديقك', true));
    conn.on('error', () => showStatusBar('⚠ خطأ في الاتصال', true));
  }

  function handleIncoming(msg){
    if(!gameConfig) return;
    if(msg.type === '__action__' && isHost){
      const fn = gameConfig.actions[msg.name];
      if(fn){
        fn(...msg.args);
        broadcastState();
      }
    } else if(msg.type === '__state__' && !isHost){
      gameConfig.setState(msg.payload);
    }
  }

  function broadcastState(){
    if(!conn || !conn.open) return;
    try{ conn.send({type:'__state__', payload: gameConfig.getState()}); }catch(e){}
  }

  function attachGame(config){
    gameConfig = config;
    // wrap each action so it routes correctly depending on mode/role
    Object.keys(config.actions).forEach(name => {
      const original = config.actions[name];
      window[name] = function(...args){
        if(mode !== 'remote'){
          original(...args);
          return;
        }
        if(isHost){
          original(...args);
          broadcastState();
        } else {
          if(conn && conn.open){
            conn.send({type:'__action__', name, args});
          }
        }
      };
    });
  }

  function init(config){
    attachGame(config);
    showChoiceModal();
  }

  return { init, sync: () => { if(isHost) broadcastState(); }, get mode(){ return mode; }, get isHost(){ return isHost; } };
})();
