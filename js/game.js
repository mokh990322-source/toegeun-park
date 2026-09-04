/* ============================================================
   모코파크 — 조립

   네트워크를 만지는 유일한 파일이다. sim.js 는 내가 호스트일 때만 돌린다.
   나머지 파일들은 순수하게 남겨 두어야 규칙 버그를 Node 로 잡을 수 있다.

   ── 한 프레임에 일어나는 일 ─────────────────────────────
   키 → 입력 → (호스트면) 시뮬레이션 / (아니면) 보간 → 내 캐릭터 예측·보정 → 그리기
   그 위에 느린 주기가 셋 겹친다: 스냅샷 10Hz(호스트), heartbeat 2초, 승계 판단 1초.

   ── 방 전체를 하나로 구독하는 이유 ──────────────────────
   meta·who·in·st 를 따로 걸면 EventSource 가 네 개가 되고, 넷의 도착 순서가
   보장되지 않는다. "호스트가 바뀌었는데 아직 옛 스냅샷을 받는" 상태를 다루는
   것보다 하나로 받는 편이 훨씬 싸다.

   ── dt 를 자르는 이유 ───────────────────────────────────
   탭을 백그라운드에 두면 requestAnimationFrame 이 멈췄다가 돌아올 때 몇 초짜리
   프레임을 한 번 준다. 그대로 시뮬레이션에 먹이면 그 한 틱에 모두가 화면을
   가로질러 순간이동하고, Interp.correct 도 이상해진다.

   ── 조작은 둘뿐이다 ─────────────────────────────────────
   좌우(x)와 점프(jseq). 점프는 누른 순간 한 번이라 카운터로 보낸다 —
   패킷이 밀려도 연타가 안 씹힌다. sim.js 의 tick(state, inputs, dt) 이
   기대하는 입력 모양이 정확히 { x, jseq } 다.

   ── 그런데 선 위에서는 옛 모양 그대로 보낸다 ──────────────
   rooms/<code>/in/<pid> 에 걸린 Firebase 규칙은 오버워크드 시절 모양
   { x, y, act, seq } 만 정확히 받고 그 외는(우리가 쓰고 싶은 { x, jseq }
   포함) 401 로 튕긴다. 규칙은 이미 게시돼 있고 그대로 쓰는 게 원칙이라
   (설계 문서 §3), 선 위에서는 그 모양을 그대로 쓰고 seq 칸에 jseq 를
   싣는다. fromWire() 가 그 경계에서 { x, jseq } 로 되돌린다 — sim.js 는
   이 사정을 몰라도 된다.

   ── AI 동료 ─────────────────────────────────────────────
   봇도 who 에 이름을 올린 진짜 참가자다. 다른 참가자에게는 사람과 구분되지
   않는다 — 스냅샷에 같이 실리고, 로스터에 같이 뜨고, 캐릭터도 하나씩
   차지한다. 다른 것은 딱 둘이다.
     1) 입력을 호스트가 대신 만든다(js/bot.js). 그러니 봇 생각은 호스트만
        한다 — 둘이 만들면 판이 갈린다.
     2) heartbeat 도 호스트가 대신 찍어 준다. 그래서 호스트가 사라지면
        봇도 10초 뒤 같이 사라진다. 주인 없는 봇이 방에 남는 것보다 낫다.
   호스트 승계 후보에서는 뺀다 — 봇을 호스트로 뽑으면 아무도 시뮬레이션을
   안 돌린다.

   ── 남을 밟고 있으면 예측을 끈다 (설계 문서 4.4) ─────────
   내 캐릭터는 땅·공중(sup 0/1)이면 로컬에서 먼저 움직이고 호스트 값으로
   당긴다(Interp.correct). 그런데 내가 밟고 선 게 남의 캐릭터(sup===2)면
   내 화면 속 그 사람은 150ms 과거라, 그 위에서 예측하면 매 프레임 어긋나
   "분명 밟았는데 떨어졌다"가 된다. sup===2 인 동안은 예측을 완전히 끄고
   호스트가(guest 라면 보간까지 끝난) 준 자리를 그대로 따른다 — 조작에
   150ms 지연이 생기는 대신 발판이 절대 안 어긋난다.
   ============================================================ */
(function (global) {
  'use strict';

  var Sim = global.Sim, Levels = global.Levels, Snap = global.Snap;
  var Interp = global.Interp, Net = global.Net, Room = global.Room;
  var View = global.View, Hud = global.Hud, Sprite = global.Sprite;
  var Bot = global.Bot;

  var MAX_PLAYERS = 8;          // 대기실 인원수 표시(N / 8) — 판마다 스폰 자리도 8개다
  var SEND_HZ = 8;              // 입력 쓰기 상한 (초당). 사람 손보다 빠르다.
  var SNAP_HZ = 10;             // 호스트 스냅샷
  var SEEN_MS = 2000;           // heartbeat — SEEN_TIMEOUT(10초)의 5분의 1
  var CLAIM_MS = 1000;          // 승계 판단
  var WARN_MS = 3000;           // 이만큼 아무것도 안 오면 띠를 띄운다
  var DT_MAX = 0.1;
  var CLEAR_HOLD_MS = 1500;     // 판을 깬 뒤 "클리어!"를 보여 주는 시간

  /* ---------- 나 ---------- */
  var pid = null;
  var code = null;
  var myName = '';
  var myChar = 0;

  /* ---------- 방에서 받은 것 ---------- */
  var meta = null, who = null, netIn = null, lastSnap = null;
  var watcher = null;

  /* ---------- 승계 판단 재료 ----------
     lastEventAt 은 절대 0 으로 시작하면 안 된다. Room.shouldClaim 이 0 을
     "아직 없음"으로 보게 고쳐 두긴 했지만, 여기서도 "아직 아무것도 못 받았다"는
     null 로 두는 편이 뜻이 분명하다. */
  var lastTick = null;
  var lastChangeMs = Date.now();
  var lastEventAt = null;
  var claimedAt = 0;

  /* 방금까지 'play' 였는지 — 판이 끝나 로비/완주 화면으로 돌아온 순간을
     잡아내는 데 쓴다. 이게 없으면 로비에 남아 있는 지난 판의 st 를 다음
     호스트가 그대로 이어받아 끝난 판을 재생하게 된다. */
  var sawPlay = false;

  /* ---------- 시뮬레이션 / 그리는 세계 ---------- */
  var simState = null;          // 내가 호스트일 때만 있다
  var drawState = null;
  var buf = new Interp.Buffer();
  var wasHost = false;
  var clearedAt = 0;             // 지금 판이 cleared 된 시각(ms). 0 이면 아직
  var doneSent = false;          // 마지막 판 완주를 이미 알렸는지

  /* ---------- AI 동료 ----------
     botMinds 는 봇마다 "지금 경로의 몇 번째"인지를 들고 있는 기억이고,
     botIn 은 이번 프레임에 봇이 낸 입력이다. 둘 다 호스트에게만 있다. */
  var botMinds = {}, botIn = {};

  /* ---------- 입력 ---------- */
  var keys = {};
  var myInput = { x: 0, jseq: 0 };
  var sentStr = '';
  var lastSendMs = 0;

  /* ---------- 로컬 예측 ----------
     drawState.players[pid] 를 그대로 베끼지 않는다 — 물리 상태(coy, buf,
     jseq)를 프레임 사이에 들고 있어야 코요테 타임·점프 버퍼가 로컬에서도
     성립한다. */
  var localPos = null;

  /* ---------- 계측 ---------- */
  var fps = 0, frames = 0, fpsAt = 0;
  var writeFail = 0;
  var lastSnapBytes = 0;
  var lastSnapAt = 0, lastSeenAt = 0, lastClaimAt = 0, lastHudAt = 0;
  var prevFrameMs = 0;

  function nowSec() { return global.performance.now() / 1000; }
  function isHost() { return !!(meta && pid && meta.host === pid); }
  function countWrite(r) { if (!r || !r.ok) writeFail++; }

  /* ============================================================
     입장
     ============================================================ */

  function makePid() {
    /* 방 안에서만 유일하면 된다. 새로고침해도 같은 사람으로 돌아오도록
       localStorage 에 둔다 — 그래야 잠깐 끊긴 사람이 유령으로 하나 더 늘지 않는다. */
    var k = 'ow.pid';
    var v = null;
    try { v = global.localStorage.getItem(k); } catch (e) { v = null; }
    if (!v) {
      v = 'p' + Math.random().toString(36).slice(2, 9);
      try { global.localStorage.setItem(k, v); } catch (e) {}
    }
    return v;
  }

  function readForm() {
    var els = Hud.els();
    myName = ((els.nick && els.nick.value) || '').trim().slice(0, 12) || '이름없음';
    myChar = Hud.pick() | 0;
    try {
      global.localStorage.setItem('ow.nick', myName);
      global.localStorage.setItem('ow.char', String(myChar));
    } catch (e) {}
  }

  function enter(c) {
    code = c;
    Hud.setCode(code);
    try { global.location.hash = code; } catch (e) {}

    Net.put('rooms/' + code + '/who/' + pid, {
      name: myName, char: myChar, join: Date.now(), seen: Date.now()
    }).then(countWrite);

    /* 입력은 빈 값으로 한 번 깔아 둔다. 호스트가 승계될 때 Sim.adopt 가
       읽을 것이 있어야 하고, 방에 들어오자마자 뭐라도 흘러야 스트림이 산다.
       선 위의 모양은 옛 4칸 그대로다 — allInputs()/fromWire() 머리말 참고. */
    Net.put('rooms/' + code + '/in/' + pid, { x: 0, y: 0, act: 0, seq: 0 }).then(countWrite);

    if (watcher) watcher.close();
    watcher = Net.watch('rooms/' + code, onRoom, function () {
      /* EventSource 는 알아서 다시 붙는다. 다시 붙으면 Firebase 가 put "/" 로
         전체를 다시 보내 주므로 우리가 복구할 것이 없다. 띠만 띄운다. */
    });
    Hud.show('Lobby');
  }

  function doCreate() {
    readForm();
    var c = Room.makeCode();
    Net.put('rooms/' + c + '/meta', {
      host: pid, phase: 'lobby', born: Date.now()
    }).then(function (r) {
      countWrite(r);
      if (!r.ok) { Hud.toast('방을 만들지 못했습니다. 연결을 확인하세요.'); return; }
      enter(c);
    });
  }

  function doJoin() {
    readForm();
    var els = Hud.els();
    var c = Room.cleanCode((els.roomInput && els.roomInput.value) || '');
    if (!c) { Hud.toast('코드는 네 글자입니다 (I, L, O, 0, 1 은 안 씁니다)'); return; }
    Net.get('rooms/' + c + '/meta').then(function (m) {
      if (!m || !m.host) { Hud.toast(c + ' 방이 없습니다'); return; }
      /* 저장해 둔 캐릭터가 이미 방에 있으면 조용히 빈 칸으로 옮긴다.
         새로 들어온 사람이 "그 캐릭터는 못 씁니다" 에러부터 보는 것보다
         낫다 — 고칠 게 없어야 바로 놀 수 있다. */
      Net.get('rooms/' + c + '/who').then(function (w) {
        myChar = resolveChar(w, pid, myChar);
        Hud.setPick(myChar);
        enter(c);
      });
    });
  }

  function doStart() {
    if (!isHost()) return;
    Net.put('rooms/' + code + '/meta/phase', 'play').then(countWrite);
  }

  /* 완주 화면에서 로비로. 호스트만 판을 다시 짤 수 있다 — 다들 누르면
     두 사람이 동시에 새 판을 만들게 된다. simState 는 안 건드린다:
     onRoom 이 phase 가 'play' 를 벗어나는 걸 보고 알아서 비운다. */
  function doBackToLobby() {
    if (!isHost()) { Hud.toast('호스트만 로비로 돌아갈 수 있습니다'); return; }
    Net.put('rooms/' + code + '/meta/phase', 'lobby').then(countWrite);
  }

  /* ============================================================
     AI 동료 넣고 빼기 (호스트만)
     ============================================================ */

  /* 안 쓰이는 봇 번호 중 가장 작은 것. 번호를 다시 쓰는 이유는 넣었다
     뺐다를 반복해도 이름이 'AI 8호'까지 치솟지 않게 하기 위해서다. */
  function freeBotPid() {
    for (var n = 1; n <= MAX_PLAYERS; n++) {
      var b = Bot.PREFIX + n;
      if (!who || !who[b]) return b;
    }
    return null;
  }

  function botList() {
    var out = [], k;
    for (k in who) {
      if (Object.prototype.hasOwnProperty.call(who, k) && Bot.isBot(k)) out.push(k);
    }
    return out.sort();
  }

  function doAddBot() {
    if (!isHost()) { Hud.toast('호스트만 AI 를 넣을 수 있습니다'); return; }
    if (aliveList().length >= MAX_PLAYERS) { Hud.toast('자리가 다 찼습니다'); return; }
    var bpid = freeBotPid();
    if (!bpid) { Hud.toast('자리가 다 찼습니다'); return; }

    /* 캐릭터는 사람과 똑같이 하나씩 차지한다 — 안 그러면 같은 얼굴이
       둘이 되어 화면에서 누가 누구인지 못 가린다. */
    var ch = resolveChar(who, bpid, 0);
    var nm = ((Sprite.CHARS[ch] && Sprite.CHARS[ch].name) || 'AI 동료').slice(0, 12);
    /* 낙관적으로 화면부터 채운다. 쓰기가 한 바퀴 돌아오기 전까지(약 150ms)
       버튼을 눌러도 아무 일도 안 일어난 것처럼 보이면 두 번 누르게 된다. */
    if (!who) who = {};
    who[bpid] = { name: nm, char: ch, join: Date.now(), seen: Date.now() };
    Net.put('rooms/' + code + '/who/' + bpid, who[bpid]).then(countWrite);
    Net.put('rooms/' + code + '/in/' + bpid, { x: 0, y: 0, act: 0, seq: 0 }).then(countWrite);
  }

  function doRemoveBot() {
    if (!isHost()) { Hud.toast('호스트만 AI 를 뺄 수 있습니다'); return; }
    var list = botList();
    if (!list.length) { Hud.toast('뺄 AI 가 없습니다'); return; }
    var bpid = list[list.length - 1];
    if (who) delete who[bpid];
    delete botMinds[bpid];
    delete botIn[bpid];
    Net.del('rooms/' + code + '/who/' + bpid);
    Net.del('rooms/' + code + '/in/' + bpid);
  }

  /* 대기실에서 캐릭터를 바꾼다. Hud 가 이미 잠긴 칸의 클릭을 막지만,
     여기서도 한 번 더 확인한다 — HUD 는 200ms 주기로만 다시 그려서,
     그 틈에 누가 먼저 그 캐릭터를 가져갔으면 화면이 아직 잠긴 것으로
     안 보일 수 있다. */
  function doPickChar(i) {
    if (!code || !pid) return;
    var used = usedCharMap(who, pid);
    if (used[i]) return;
    myChar = i;
    try { global.localStorage.setItem('ow.char', String(i)); } catch (e) {}
    Net.put('rooms/' + code + '/who/' + pid + '/char', i).then(countWrite);
  }

  /* ============================================================
     방 구독
     ============================================================ */

  function onRoom(data) {
    lastEventAt = Date.now();
    var d = data || {};
    meta = d.meta || null;
    who = d.who || null;
    netIn = d.in || null;
    var phase = meta && meta.phase;

    if (phase === 'play') {
      sawPlay = true;
      var st = d.st || null;
      if (st && typeof st.t === 'number' && st.t !== lastTick) {
        lastTick = st.t;
        lastChangeMs = Date.now();
        lastSnap = st;
        /* tSec 은 반드시 로컬 수신 시각이다. 호스트 시계인 st.t 를 넣으면
           보간이 시작조차 안 하고 캐릭터가 뚝뚝 끊긴다(interp.js 머리말). */
        if (!isHost()) buf.push(nowSec(), st);
      }
    } else if (sawPlay) {
      /* 방금 판이 끝나 로비(또는 완주 화면)로 돌아왔다. Firebase 의 st 는
         지난 판 것이 그대로 남아 있다 — 신뢰하지 않고 버린다. 안 그러면
         다음에 누가 호스트를 맡든(같은 사람이든 승계든) 끝난 판을 그대로
         이어받아 첫 틱부터 cleared=true 로 시작해 버린다. */
      sawPlay = false;
      lastSnap = null;
      lastTick = null;
      simState = null;
      wasHost = false;
    }

    if (phase === 'play') Hud.show('Game');
    else if (phase === 'result') Hud.show('Done');
    else if (code) Hud.show('Lobby');
  }

  function aliveList() {
    return Room.alive(who, Date.now());
  }

  /* 호스트 승계 판단에만 쓴다. 봇을 후보로 두면 "다음 차례"가 봇에게
     떨어지고, 봇의 브라우저 같은 건 없으니 아무도 시뮬레이션을 안 돌린다 —
     그 방은 그대로 멈춘다. Room 은 이 사정을 몰라야 하므로(방 코드와
     승계 규칙만 아는 파일이다) 여기서 걸러서 넘긴다. */
  function humansOnly(whoObj) {
    var o = {}, k;
    for (k in whoObj) {
      if (!Object.prototype.hasOwnProperty.call(whoObj, k)) continue;
      if (Bot.isBot(k)) continue;
      o[k] = whoObj[k];
    }
    return o;
  }

  /* ============================================================
     캐릭터 겹침 방지

     같은 방에 숭한 라이언이 둘이면 대기실도 게임 화면도 "누가 누구야"가
     안 된다. seen 이 낡아 나간 사람(Room.alive 가 빼는 사람)의 캐릭터는
     다시 풀린다 — 나갔는데 캐릭터 하나가 영영 묶여 있으면 8명 방이
     7명한테 8칸을 못 준다.
     ============================================================ */

  /* whoObj: {pid:{name,char,...}}. exceptPid 는 결과에서 뺀다 — "내가 지금
     쓰고 있는 칸"과 "남이 쓰는 칸"을 갈라야 자기 자신 때문에 자기가
     잠기지 않는다. */
  function usedCharMap(whoObj, exceptPid) {
    var out = {};
    var ids = Room.alive(whoObj, Date.now());
    for (var i = 0; i < ids.length; i++) {
      var p = ids[i];
      if (p === exceptPid) continue;
      var w = whoObj && whoObj[p];
      if (!w) continue;
      out[w.char | 0] = { pid: p, name: w.name || '???' };
    }
    return out;
  }

  /* 원하는 캐릭터가 이미 남의 것이면 조용히 빈 칸으로 옮긴다. 8명이 최대고
     캐릭터도 8종이라 항상 빈 칸이 있지만, 그 가정이 깨져도(버그·데이터
     꼬임) want 를 그대로 돌려줘서 죽지 않게 한다. */
  function resolveChar(whoObj, exceptPid, want) {
    var used = usedCharMap(whoObj, exceptPid);
    if (!used[want]) return want;
    for (var i = 0; i < Sprite.CHARS.length; i++) {
      if (!used[i]) return i;
    }
    return want;
  }

  /* rooms/<code>/in/<pid> 에 이미 게시된 Firebase 규칙이 예전 4칸 모양
     {x,y,act,seq} 만 정확히 받고 그 외는(우리가 원하는 {x,jseq} 포함) 전부
     401 로 튕긴다 — 규칙은 "이미 게시돼 있고 그대로 쓴다"(설계 문서 §3).
     그래서 선(wire) 위에서는 옛 모양을 그대로 쓰고, seq 칸에 jseq 를 실어
     보낸다. sim.js 는 이 사정을 몰라야 하므로(네트워크를 모른다), 네트워크
     경계인 여기서 옛 모양 → { x, jseq } 로 바꿔치기한다. */
  function fromWire(v) {
    if (!v) return { x: 0, jseq: 0 };
    return { x: v.x || 0, jseq: v.seq || 0 };
  }

  function allInputs() {
    /* 내 입력은 네트워크를 돌아 오기를 기다리지 않는다. 호스트가 자기 입력을
       150ms 뒤에 받으면 호스트만 조작이 굼떠 보인다. */
    var o = {}, k;
    if (netIn) for (k in netIn) {
      if (Object.prototype.hasOwnProperty.call(netIn, k)) o[k] = fromWire(netIn[k]);
    }
    /* 봇 입력은 선을 안 탄다. 호스트가 방금 만든 것을 그대로 쓴다 —
       Firebase 로 한 바퀴 돌리면 150ms 만 늦어질 뿐 아무도 못 읽는다. */
    for (k in botIn) {
      if (Object.prototype.hasOwnProperty.call(botIn, k)) o[k] = botIn[k];
    }
    o[pid] = myInput;
    return o;
  }

  /* ============================================================
     호스트
     ============================================================ */

  function becomeHost() {
    var alive = aliveList();

    if (!simState) {
      if (lastSnap) {
        /* 승계 — 남이 돌리던 판을 이어받는다. 스냅샷은 spawnIdx 를 안
           실으므로(전송량 때문에), 지금 살아 있는 순서로 다시 매긴다 —
           이미 있던 사람의 spawnIdx 를 아는 유일한 방법이다. join() 은
           이미 players 에 있는 사람에게는 아무것도 안 하기 때문이다. */
        var idx = {};
        for (var i = 0; i < alive.length; i++) idx[alive[i]] = i;
        simState = Snap.unpack(lastSnap, idx);
      } else {
        simState = Sim.create(0, []);
      }
    }

    for (var j = 0; j < alive.length; j++) simState = Sim.join(simState, alive[j], j);

    /* 반드시 마지막이다. Snap 은 전송량 때문에 jseq 를 안 담아서, 이어받은
       판의 players[].jseq 는 전부 0 이다. 그대로 tick 을 돌리면 각자가 매치
       내내 보낸 입력 전체를 "새 액션"으로 오인해 그 자리에서 재생한다 —
       사람이 순간이동하고 점프가 폭죽처럼 터진다. 지금 입력이 말하는
       값으로 맞춰 두면 다음 틱에서 want - have 가 0 이 된다. */
    simState = Sim.adopt(simState, allInputs());
    wasHost = true;
    clearedAt = 0;
    doneSent = false;
  }

  function syncPlayers() {
    if (!simState) return;
    var alive = aliveList(), i, k;
    var set = {};
    for (i = 0; i < alive.length; i++) {
      set[alive[i]] = true;
      if (!simState.players[alive[i]]) simState = Sim.join(simState, alive[i], i);
    }
    for (k in simState.players) {
      if (!Object.prototype.hasOwnProperty.call(simState.players, k)) continue;
      if (!set[k]) simState = Sim.leave(simState, k);
    }
  }

  /* 판이 끝난(cleared) 뒤 다음으로 넘어가는 시점을 정한다. 다 같이 출입구에
     모인 그림을 잠깐이라도 보여줘야 "우리가 해냈다"가 느껴진다 — 즉시
     다음 판으로 끊으면 성취감 없이 장면만 바뀐다. */
  function advanceLevel(nowMs) {
    if (!simState.cleared) { clearedAt = 0; return; }
    if (!clearedAt) clearedAt = nowMs;
    if (nowMs - clearedAt < CLEAR_HOLD_MS) return;

    if (simState.lv + 1 >= Levels.LIST.length) {
      /* 마지막 판까지 다 깼다 — 모두를 완주 화면으로 보낸다.
         phase 값은 rooms/<code>/meta/phase 에 걸린 옛 규칙이 정한 몇 가지
         값만 받아 준다('lobby','play','result', ... — 'done' 은 401 로
         튕긴다). 오버워크드 시절 결과 화면 phase 인 'result' 를 그대로
         빌려 쓴다. 쓰기 왕복이 끝나기 전까지 phase 가 아직 'play' 라 매 틱
         다시 걸릴 수 있으니 doneSent 로 한 번만 쓴다. */
      if (!doneSent) {
        doneSent = true;
        Net.put('rooms/' + code + '/meta/phase', 'result').then(countWrite);
      }
    } else {
      simState = Sim.nextLevel(simState);
      clearedAt = 0;
    }
  }

  /* 봇마다 다음 입력을 만든다. 호스트만 부른다.
     역할은 매 프레임 다시 나눈다 — 봇이 들고 나도 남은 봇들이 알아서
     빈 역할을 메운다. Bot.assign 은 pid 를 정렬해서 나누므로 같은 봇이
     같은 역할을 계속 받는다. */
  function thinkBots(dt) {
    if (!simState) return;
    var alive = aliveList(), list = [], i, k;
    for (i = 0; i < alive.length; i++) if (Bot.isBot(alive[i])) list.push(alive[i]);

    var jobs = Bot.assign(simState.lv, list);
    var next = {};
    for (i = 0; i < list.length; i++) {
      k = list[i];
      if (!botMinds[k]) botMinds[k] = Bot.mind();
      next[k] = Bot.step(simState, k, jobs[k], botMinds[k], i, dt);
    }
    /* 나간 봇의 기억은 버린다 — 안 그러면 같은 이름으로 새로 들어온 봇이
       지난 판 중간부터 시작한다. */
    for (k in botMinds) {
      if (Object.prototype.hasOwnProperty.call(botMinds, k) && !next[k]) delete botMinds[k];
    }
    botIn = next;
  }

  function hostTick(dt, nowMs) {
    if (!simState) becomeHost();
    thinkBots(dt);
    simState = Sim.tick(simState, allInputs(), dt);
    advanceLevel(nowMs);
    drawState = simState;

    if (nowMs - lastSnapAt >= 1000 / SNAP_HZ) {
      lastSnapAt = nowMs;
      var packed = Snap.pack(simState);
      lastSnapBytes = Snap.bytes(packed);
      Net.put('rooms/' + code + '/st', packed).then(countWrite);
    }
  }

  /* ============================================================
     손님 — 보간
     ============================================================ */

  function guestState() {
    var s = buf.sample(nowSec());
    if (!s) return null;

    /* 뼈대는 최신(b)에서 가져온다. 기계 진행도가 150ms 앞서는 것은 아무도
       못 느끼지만, 위치가 150ms 앞서면 남이 벽을 뚫고 지나가 보인다. */
    var out = Snap.unpack(s.b);
    var pa = s.a && s.a.p, pb = s.b && s.b.p;
    if (pa && pb) {
      for (var k in out.players) {
        if (!Object.prototype.hasOwnProperty.call(out.players, k)) continue;
        if (!pa[k] || !pb[k]) continue;
        var q = Interp.between(pa[k], pb[k], s.k);
        out.players[k].x = q.x;
        out.players[k].y = q.y;
      }
    }
    return out;
  }

  /* ============================================================
     내 캐릭터 — 먼저 움직이고 나중에 맞춘다

     sim.js 의 tick() 1단계(입력·중력·타일 충돌)를 한 사람분만 그대로
     되풀이한다. 2단계(남의 머리 위에 올라서기)와 3단계(밀어내기)는 일부러
     안 한다 — 남의 위치는 150ms 과거라 여기서 흉내내면 매 프레임 호스트와
     싸운다. 그건 호스트의 몫이다.
     ============================================================ */

  function stepLocalPhysics(lp, ix, jseqWant, dt, lv, doorOpen) {
    var n = jseqWant - lp.jseq;
    if (n < 0) n = 0;
    if (n > Sim.MAX_JUMPS) n = Sim.MAX_JUMPS;
    if (n > 0) lp.buf = Sim.JUMP_BUF;
    lp.jseq += n;

    lp.vx = ix * Sim.SPEED;
    if (ix) lp.face = ix > 0 ? 1 : -1;

    lp.vy += Sim.GRAVITY * dt;
    if (lp.vy > Sim.MAX_FALL) lp.vy = Sim.MAX_FALL;

    if (lp.sup !== 0) lp.coy = Sim.COYOTE; else lp.coy = Math.max(0, lp.coy - dt);
    lp.buf = Math.max(0, lp.buf - dt);

    if (lp.buf > 0 && lp.coy > 0) {
      lp.vy = -Sim.JUMP_V;
      lp.buf = 0; lp.coy = 0;
      lp.sup = 0;
    }

    var rx = Levels.moveX(lv, lp.x, lp.y, lp.vx * dt, doorOpen);
    lp.x = rx.x;
    if (rx.hit) lp.vx = 0;

    var wasFalling = lp.vy > 0;
    var ry = Levels.moveY(lv, lp.x, lp.y, lp.vy * dt, doorOpen);
    lp.y = ry.y;
    lp.sup = 0;
    if (ry.hit) {
      if (wasFalling) lp.sup = 1;
      lp.vy = 0;
    }
  }

  function predict(dt) {
    /* 호스트는 이미 정답이다. simState 자체가 곧 화면이라 예측할 것이 없고,
       localPos 를 들고 있으면 나중에 밀려났을 때 낡은 값으로 시작하게
       된다 — 비워 둔다. */
    if (isHost()) { localPos = null; return; }
    if (!drawState) return;
    var srv = drawState.players[pid];
    if (!srv) { localPos = null; return; }

    if (!localPos) {
      localPos = { x: srv.x, y: srv.y, vx: srv.vx || 0, vy: srv.vy || 0,
                   face: srv.face, sup: srv.sup, coy: 0, buf: 0, jseq: myInput.jseq };
    }

    if (srv.sup === 2) {
      /* 4.4 규칙: 남을 밟고 있으면 예측을 끈다. jseq 도 지금 값으로 맞춰
         둔다 — 그래야 내려온 뒤 첫 프레임에 "밟고 있는 동안 눌렀던 점프"가
         재생되지 않는다(Sim.adopt 와 같은 이유, 대상만 나 한 명이다). */
      localPos.x = srv.x; localPos.y = srv.y;
      localPos.vx = srv.vx; localPos.vy = srv.vy;
      localPos.face = srv.face; localPos.sup = srv.sup;
      localPos.coy = 0; localPos.buf = 0;
      localPos.jseq = myInput.jseq;
    } else {
      var lv = Levels.LIST[drawState.lv];
      stepLocalPhysics(localPos, myInput.x || 0, myInput.jseq, dt, lv, !!drawState.door);

      var c = Interp.correct(localPos, srv, dt);
      localPos.x = c.x; localPos.y = c.y;
    }

    /* drawState 가 시뮬레이션 원본(호스트)이면 이미 위에서 걸러졌다.
       guest 라면 drawState 의 내 자리는 아직 150ms 과거로 보간된 값이라,
       예측한 자리로 덮어써야 내 조작이 즉각 반영돼 보인다. */
    srv.x = localPos.x; srv.y = localPos.y; srv.face = localPos.face;
  }

  /* ============================================================
     느린 주기들
     ============================================================ */

  function heartbeat(nowMs) {
    if (nowMs - lastSeenAt < SEEN_MS) return;
    lastSeenAt = nowMs;
    Net.put('rooms/' + code + '/who/' + pid + '/seen', nowMs).then(countWrite);

    /* 봇은 스스로 살아 있다고 말할 수 없다. 호스트가 대신 찍어 준다 —
       그래서 호스트가 사라지면 봇도 10초 뒤 함께 사라진다. */
    if (!isHost() || !who) return;
    for (var k in who) {
      if (!Object.prototype.hasOwnProperty.call(who, k)) continue;
      if (!Bot.isBot(k)) continue;
      Net.put('rooms/' + code + '/who/' + k + '/seen', nowMs).then(countWrite);
    }
  }

  function claimCheck(nowMs) {
    if (nowMs - lastClaimAt < CLAIM_MS) return;
    lastClaimAt = nowMs;
    if (!meta) return;

    var act = Room.shouldClaim({
      me: pid, host: meta.host, who: humansOnly(who),
      lastTick: lastTick, lastChangeMs: lastChangeMs,
      lastEventMs: lastEventAt,
      nowMs: nowMs, claimedAtMs: claimedAt
    });

    if (act === 'claim') {
      claimedAt = nowMs;
      Net.put('rooms/' + code + '/meta/host', pid).then(countWrite);
    } else if (act === 'yield') {
      claimedAt = 0;
    } else if (act === 'none' && claimedAt) {
      claimedAt = 0;
    }

    /* 실제 승계·강등은 meta 를 보고 판단한다. claim 을 썼다고 바로 호스트가
       되는 게 아니다 — 둘이 동시에 썼으면 나중 쓴 쪽이 남는다. */
    if (isHost() && !wasHost) becomeHost();
    if (!isHost() && wasHost) {
      /* 밀려났다. 시뮬레이션을 즉시 버린다. 둘이 돌리면 화면이 갈린다. */
      wasHost = false;
      simState = null;
      buf = new Interp.Buffer();
    }
    if (isHost()) syncPlayers();
  }

  function paintHud(nowMs) {
    if (nowMs - lastHudAt < 200) return;
    lastHudAt = nowMs;

    var alive = aliveList();
    Hud.setWho(who, alive, meta && meta.host, pid, isHost(), Bot.isBot);
    Hud.setCount(alive.length, MAX_PLAYERS);
    Hud.setBotButtons(isHost(), botList().length, alive.length >= MAX_PLAYERS);
    Hud.setLobbyCharPick(usedCharMap(who, pid), myChar);

    if (drawState) {
      var lv = Levels.LIST[drawState.lv] || Levels.LIST[0];
      Hud.setLevel(drawState.lv + 1, Levels.LIST.length, lv.name);
      Hud.setCleared(!!drawState.cleared);
    }

    var quiet = (lastEventAt !== null) && (nowMs - lastEventAt > WARN_MS);
    Hud.netWarn(quiet);

    Hud.setStat(
      (isHost() ? '호스트' : '참가') + ' · ' + alive.length + '명 · ' +
      fps + 'fps' + (writeFail ? ' · 쓰기실패 ' + writeFail : '')
    );
  }

  /* ============================================================
     입력
     ============================================================ */

  function isJumpCode(code) {
    return code === 'Space' || code === 'ArrowUp' || code === 'KeyW';
  }

  function readKeys() {
    var x = 0;
    if (keys.ArrowLeft || keys.KeyA) x -= 1;
    if (keys.ArrowRight || keys.KeyD) x += 1;
    myInput.x = x;
  }

  function sendInput(nowMs) {
    var s = myInput.x + ',' + myInput.jseq;
    if (s === sentStr) return;
    /* 방향키를 붙잡고 있으면 값이 안 바뀌어 쓰기가 아예 없다. 문제는 좌우를
       빠르게 번갈아 누를 때다 — 초당 60번 바뀔 수 있고, 8명이면 초당 480번이
       되어 입력이 스냅샷보다 무거워진다. 초당 8회면 사람 손보다 빠르다. */
    if (nowMs - lastSendMs < 1000 / SEND_HZ) return;
    lastSendMs = nowMs;
    sentStr = s;
    /* 선 위에서는 옛 4칸 모양을 쓴다 — seq 칸에 jseq 를 싣는다.
       (allInputs() 위 fromWire() 머리말 참고) */
    Net.put('rooms/' + code + '/in/' + pid,
      { x: myInput.x, y: 0, act: 0, seq: myInput.jseq }).then(countWrite);
  }

  function bindKeys() {
    global.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      keys[e.code] = true;
      if (isJumpCode(e.code)) {
        /* 점프는 키를 누른 순간 한 번이다. jseq 를 올리면 호스트가 늘어난
           만큼 처리한다 — 패킷이 밀려도 연타가 씹히지 않는다. */
        myInput.jseq++;
      }
      if (e.code.indexOf('Arrow') === 0 || e.code === 'Space') e.preventDefault();
    });
    global.addEventListener('keyup', function (e) { keys[e.code] = false; });
    /* 창을 벗어나면 키가 눌린 채로 남아 혼자 벽으로 계속 걸어간다 */
    global.addEventListener('blur', function () { keys = {}; });
  }

  /* ============================================================
     루프

     advance(ts) 가 유일한 프레임 함수다. requestAnimationFrame 도 이걸
     부르고, 확인 코드도 game.step(ts) 로 똑같이 이걸 부른다 — 숨은 탭에서는
     requestAnimationFrame 이 아예 안 돌아서, 조립을 검증하려면 같은 함수를
     타임스탬프만 직접 넣어 호출할 방법이 있어야 한다.
     ============================================================ */

  function tick(dt, nowMs) {
    var els = Hud.els();
    var sc = View.layout(els.floor, els.actors);

    if (code) {
      readKeys();
      sendInput(nowMs);

      var playing = !!(meta && meta.phase === 'play');
      if (playing) {
        if (isHost()) hostTick(dt, nowMs);
        else drawState = guestState() || drawState;
        predict(dt);
        View.draw(els.floor, els.actors, drawState, who, pid, dt);
      }
      paintHud(nowMs);
    }

    api.scale = sc;
    api.fps = fps;
    api.state = drawState;
    api.meta = meta;
    api.who = who;
    api.code = code;
    api.writeFail = writeFail;
    api.lastSnapBytes = lastSnapBytes;
  }

  /* ts: performance.now() 계열 밀리초. 첫 호출은 prevFrameMs 가 없어 dt=0 —
     그 프레임엔 아무도 안 움직인다. */
  function advance(ts) {
    var dt = prevFrameMs ? (ts - prevFrameMs) / 1000 : 0;
    prevFrameMs = ts;
    if (dt < 0) dt = 0;
    /* 백그라운드에 있다 돌아오면 몇 초짜리 프레임이 한 번 온다. 그대로 먹이면
       그 한 틱에 모두가 화면을 가로질러 순간이동한다. */
    if (dt > DT_MAX) dt = DT_MAX;

    frames++;
    var tSec = ts / 1000;
    if (tSec - fpsAt >= 1) { fps = Math.round(frames / (tSec - fpsAt)); frames = 0; fpsAt = tSec; }

    tick(dt, Date.now());
  }

  function frame(ts) {
    global.requestAnimationFrame(frame);
    advance(ts);
  }

  /* ============================================================
     시작
     ============================================================ */

  function boot() {
    pid = makePid();

    Hud.init({ create: doCreate, join: doJoin, start: doStart, lobby: doBackToLobby,
               pickChar: doPickChar, addBot: doAddBot, removeBot: doRemoveBot });

    var els = Hud.els();
    try {
      if (els.nick) els.nick.value = global.localStorage.getItem('ow.nick') || '';
      var c = parseInt(global.localStorage.getItem('ow.char') || '0', 10);
      if (c >= 0 && c < Sprite.CHARS.length) Hud.setPick(c);
    } catch (e) {}

    /* 초대 링크(#ABCD)로 들어온 사람은 코드를 이미 갖고 있다 */
    var h = Room.cleanCode((global.location.hash || '').replace('#', ''));
    if (h && els.roomInput) els.roomInput.value = h;

    Hud.setLevel(1, Levels.LIST.length, Levels.LIST[0].name);
    Hud.show('Start');
    bindKeys();

    /* 프레임 루프(step 안의 View.layout)만 믿지 않는다. requestAnimationFrame
       은 탭이 숨어 있으면(백그라운드 탭·이 자동화 브라우저처럼 전경이어도
       안 도는 환경) 아예 안 돈다 — 그러면 캔버스가 시작부터 끝까지
       0x0(미배치)으로 남아 아무것도 안 그려진다. 시작할 때 한 번은 루프와
       무관하게 반드시 크기를 잡는다. */
    if (els.floor && els.actors) View.layout(els.floor, els.actors);

    global.addEventListener('resize', function () { View.dirty(); });

    /* heartbeat 와 승계 판단은 프레임 루프에 두면 안 된다. 탭을 백그라운드로
       내리면 requestAnimationFrame 이 완전히 멈춰서, 알트탭 한 번에 자기
       heartbeat 가 끊기고 10초 뒤 방에서 사라진다. setInterval 은 숨은 탭에서도
       초당 한 번은 돌아서 살아 있다는 표시를 계속 낼 수 있다.
       시뮬레이션은 반대로 프레임 루프에 그대로 둔다 — 숨은 호스트가 화면 없이
       판을 계속 돌리는 것보다, 틱이 멈춰 남은 사람이 승계하는 편이 낫다. */
    global.setInterval(function () {
      if (!code) return;
      var t = Date.now();
      heartbeat(t);
      claimCheck(t);
    }, 500);

    /* 창을 닫으면 방 목록에서 스스로 빠진다. 안 지워도 seen 이 10초 뒤에
       낡아 사라지지만, 그 10초 동안 대기실에 유령이 서 있다.
       keepalive 가 아니면 언로드 중의 fetch 는 취소된다. */
    global.addEventListener('pagehide', function () {
      if (!code) return;
      try {
        global.fetch(Net.url('rooms/' + code + '/who/' + pid),
          { method: 'DELETE', keepalive: true });
        /* 내가 호스트면 봇의 heartbeat 도 나와 함께 멈춘다. 어차피 10초 뒤
           사라지지만, 그 10초 동안 대기실에 조종되지 않는 봇이 서 있다. */
        if (isHost()) {
          var list = botList();
          for (var i = 0; i < list.length; i++) {
            global.fetch(Net.url('rooms/' + code + '/who/' + list[i]),
              { method: 'DELETE', keepalive: true });
          }
        }
      } catch (e) {}
    });

    global.requestAnimationFrame(frame);
  }

  var api = {
    pid: null, code: null, meta: null, who: null, state: null,
    scale: 1, fps: 0, writeFail: 0, lastSnapBytes: 0,
    isHost: isHost,
    /* 확인용 손잡이 */
    sim: function () { return simState; },
    bots: function () { return { minds: botMinds, inputs: botIn }; },
    addBot: doAddBot, removeBot: doRemoveBot,
    buffer: function () { return buf; },
    inputs: function () { return allInputs(); },
    local: function () { return localPos; },
    myInput: myInput,
    step: advance,
    lastTick: function () { return lastTick; },
    lastEventAt: function () { return lastEventAt; },
    leaveRoom: function () {
      if (!code) return;
      Net.del('rooms/' + code + '/who/' + pid);
    }
  };
  global.game = api;

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', function () { boot(); api.pid = pid; });
  } else {
    boot(); api.pid = pid;
  }
})(window);
