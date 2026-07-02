// ============================================================
// Multiplayer Engine using WebSocket (no PeerJS)
// ============================================================
const MP = (function() {
    // ------------------- إعدادات الاتصال -------------------
    // يمكن تغيير عنوان الخادم حسب الحاجة (ضع الرابط الذي يوفره Cloudflare Tunnel)
    let WS_URL = 'wss://dialogue-definitions-slow-pan.trycloudflare.com';
    // في حال عدم توفر SSL، استخدم ws://...
    // إذا أردت تغييره لاحقاً استخدم MP.setWsUrl(newUrl)

    // ------------------- المتغيرات الداخلية -------------------
    let ws = null;
    let roomId = null;
    let myName = '';
    let isHost = false;
    let mode = null;           // 'local' | 'remote'
    let gameConfig = null;     // {getState, setState, actions, onStart}
    let peerName = '';         // اسم اللاعب الآخر
    let connected = false;
    let reconnectAttempts = 0;

    // ------------------- دوال الاتصال -------------------
    function connectWebSocket() {
        return new Promise((resolve, reject) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }
            ws = new WebSocket(WS_URL);
            ws.onopen = () => {
                connected = true;
                resolve();
            };
            ws.onerror = (err) => {
                reject(err);
            };
            ws.onclose = () => {
                connected = false;
                // محاولة إعادة الاتصال (بسيطة)
                if (reconnectAttempts < 3) {
                    reconnectAttempts++;
                    setTimeout(() => {
                        connectWebSocket().catch(() => {});
                    }, 2000);
                } else {
                    alert('انقطع الاتصال بالخادم، حاول تحديث الصفحة.');
                }
            };
            // استقبال الرسائل
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleMessage(data);
                } catch (e) {
                    console.warn('رسالة غير صالحة', event.data);
                }
            };
        });
    }

    function send(msg) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        } else {
            console.warn('WebSocket غير متصل، لا يمكن الإرسال');
        }
    }

    // ------------------- معالجة الرسائل الواردة -------------------
    function handleMessage(msg) {
        switch (msg.type) {
            case 'room_created':
                // تم إنشاء الغرفة، نعرض الكود
                roomId = msg.roomId;
                showRoomCreatedUI(roomId);
                break;

            case 'room_joined':
                // انضممنا إلى الغرفة
                roomId = msg.roomId;
                peerName = msg.peerName;
                mode = 'remote';
                isHost = false;
                if (gameConfig && gameConfig.onStart) {
                    gameConfig.onStart('remote', false, myName, peerName);
                }
                closeOverlay(); // إغلاق نافذة الانتظار
                break;

            case 'peer_joined':
                // انضم لاعب آخر إلى الغرفة التي أنشأناها
                peerName = msg.peerName;
                mode = 'remote';
                isHost = true;
                if (gameConfig && gameConfig.onStart) {
                    gameConfig.onStart('remote', true, myName, peerName);
                }
                closeOverlay();
                break;

            case 'action':
                // تنفيذ إجراء من الطرف الآخر
                if (gameConfig && gameConfig.actions[msg.action]) {
                    gameConfig.actions[msg.action](...msg.args);
                }
                break;

            case 'state_sync':
                // مزامنة الحالة (من المضيف)
                if (!isHost && gameConfig) {
                    gameConfig.setState(msg.state);
                }
                break;

            case 'error':
                alert('خطأ: ' + msg.message);
                break;

            default:
                console.log('رسالة غير معروفة:', msg);
        }
    }

    // ------------------- واجهة المستخدم -------------------
    function showRoomCreatedUI(roomCode) {
        // نعرض الكود في نفس النافذة المنبثقة
        const overlay = document.getElementById('mp-overlay');
        if (!overlay) return;
        const body = overlay.querySelector('.mp-remote-body');
        if (body) {
            body.innerHTML = `
                <div style="text-align:center;padding:10px;">
                    <div style="font-size:18px;color:var(--brass-bright);">كود الغرفة</div>
                    <div style="font-size:28px;font-family:'Big Shoulders Stencil',sans-serif;direction:ltr;background:#0F0C09;padding:10px;border-radius:8px;margin:10px 0;">${roomCode}</div>
                    <div style="font-size:13px;color:var(--text-muted);">شارك هذا الكود مع صديقك، ثم انتظر حتى ينضم</div>
                    <button class="mp-primary" onclick="navigator.clipboard?.writeText('${roomCode}')" style="margin-top:10px;">نسخ الكود</button>
                    <div style="margin-top:12px;font-size:12px;color:var(--text-muted);">بانتظار انضمام لاعب آخر...</div>
                </div>
            `;
        }
    }

    function closeOverlay() {
        const overlay = document.getElementById('mp-overlay');
        if (overlay) overlay.remove();
    }

    // ------------------- دوال عامة -------------------
    function createRoom(name) {
        myName = name;
        connectWebSocket().then(() => {
            send({ type: 'create_room', playerName: name });
        }).catch(err => {
            alert('تعذر الاتصال بالخادم: ' + err.message);
        });
    }

    function joinRoom(name, roomCode) {
        myName = name;
        connectWebSocket().then(() => {
            send({ type: 'join_room', roomId: roomCode, playerName: name });
        }).catch(err => {
            alert('تعذر الاتصال بالخادم: ' + err.message);
        });
    }

    // مزامنة الحالة (يطلقها المضيف)
    function syncState() {
        if (isHost && gameConfig) {
            send({ type: 'state_sync', state: gameConfig.getState() });
        }
    }

    // تغيير عنوان الخادم
    function setWsUrl(url) {
        WS_URL = url;
    }

    // ------------------- تهيئة اللعبة -------------------
    function init(config) {
        gameConfig = config;
        showChoiceModal();
    }

    // ------------------- نافذة اختيار طريقة اللعب -------------------
    function showChoiceModal() {
        injectStyles();

        const overlay = document.createElement('div');
        overlay.id = 'mp-overlay';
        overlay.className = 'mp-overlay';
        overlay.innerHTML = `
            <div class="mp-box">
                <h3>كيف تريد اللعب؟</h3>
                <p class="sub">اختر طريقة اللعب قبل البدء</p>
                <div class="mp-choice-btn" id="mp-choice-remote">
                    <div class="ic">🌐</div>
                    <div><div class="lbl">العب عن بُعد</div><div class="desc">أنشئ غرفة وشارك الكود مع صديقك</div></div>
                </div>
                <div class="mp-choice-btn" id="mp-choice-local">
                    <div class="ic">📱</div>
                    <div><div class="lbl">العب على نفس الجهاز</div><div class="desc">مرّرا الجهاز بينكما بالتناوب</div></div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelector('#mp-choice-local').onclick = () => {
            mode = 'local';
            closeOverlay();
            if (gameConfig && gameConfig.onStart) gameConfig.onStart('local');
        };

        overlay.querySelector('#mp-choice-remote').onclick = () => {
            showRemoteSetup();
        };
    }

    function showRemoteSetup() {
        const overlay = document.getElementById('mp-overlay');
        if (!overlay) return;
        overlay.innerHTML = `
            <div class="mp-box">
                <h3>اللعب عن بُعد</h3>
                <div class="mp-tabs">
                    <div class="mp-tab active" id="mp-tab-create">إنشاء غرفة</div>
                    <div class="mp-tab" id="mp-tab-join">الانضمام</div>
                </div>
                <div class="mp-remote-body" id="mp-remote-body"></div>
                <div class="mp-back" id="mp-back">→ رجوع</div>
            </div>
        `;

        let tab = 'create';
        function renderBody() {
            const body = overlay.querySelector('#mp-remote-body');
            overlay.querySelector('#mp-tab-create').classList.toggle('active', tab === 'create');
            overlay.querySelector('#mp-tab-join').classList.toggle('active', tab === 'join');

            if (tab === 'create') {
                body.innerHTML = `
                    <input type="text" id="mp-name-input" placeholder="اسمك">
                    <div class="mp-err" id="mp-err"></div>
                    <button class="mp-primary" id="mp-create-btn">إنشاء الغرفة 🔐</button>
                `;
                body.querySelector('#mp-create-btn').onclick = () => {
                    const name = document.getElementById('mp-name-input').value.trim();
                    if (!name) {
                        document.getElementById('mp-err').textContent = 'الرجاء إدخال اسمك';
                        return;
                    }
                    createRoom(name);
                };
            } else {
                body.innerHTML = `
                    <input type="text" id="mp-name-input" placeholder="اسمك">
                    <input type="text" id="mp-code-input" placeholder="أدخل كود الغرفة">
                    <div class="mp-err" id="mp-err"></div>
                    <button class="mp-primary" id="mp-join-btn">الانضمام 🚪</button>
                `;
                body.querySelector('#mp-join-btn').onclick = () => {
                    const name = document.getElementById('mp-name-input').value.trim();
                    const code = document.getElementById('mp-code-input').value.trim();
                    if (!name) {
                        document.getElementById('mp-err').textContent = 'الرجاء إدخال اسمك';
                        return;
                    }
                    if (!code) {
                        document.getElementById('mp-err').textContent = 'الرجاء إدخال كود الغرفة';
                        return;
                    }
                    joinRoom(name, code);
                };
            }
        }

        overlay.querySelector('#mp-tab-create').onclick = () => { tab = 'create'; renderBody(); };
        overlay.querySelector('#mp-tab-join').onclick = () => { tab = 'join'; renderBody(); };
        overlay.querySelector('#mp-back').onclick = showChoiceModal;
        renderBody();
    }

    // ------------------- إضافة الأنماط (مرة واحدة) -------------------
    function injectStyles() {
        if (document.getElementById('mp-styles')) return;
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
            .mp-err{color:var(--danger);font-size:12.5px;text-align:center;margin:-4px 0 12px;}
        `;
        document.head.appendChild(style);
    }

    // ------------------- واجهة التصدير -------------------
    return {
        init,
        sync: syncState,
        setWsUrl,
        get mode() { return mode; },
        get isHost() { return isHost; }
    };
})();