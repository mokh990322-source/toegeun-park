/* ============================================================
   오버워크드 — 조립

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
   ============================================================ */
(function (global) {
  'use strict';

  var W = global.World, St = global.Stations, Sim = global.Sim, Snap = global.Snap;
  var Interp = global.Interp, Net = global.Net, Room = global.Room;
  var View = global.View, Hud = global.Hud, Sprite = global.Sprite;

  var MAP = W.STAGE1;
  var SEND_HZ = 8;             // 입력 쓰기 상한 (초당). 사람 손보다 빠르다.
  var SNAP_HZ = 10;            // 호스트 스냅샷
  var SEEN_MS = 2000;          // heartbeat — SEEN_TIMEOUT(10초)의 5분의 1
  var CLAIM_MS = 1000;         // 승계 판단
  var WARN_MS = 3000;          // 이만큼 아무것도 안 오면 띠를 띄운다
  var DT_MAX = 0.1;

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

  /* ---------- 시뮬레이션 / 그리는 세계 ---------- */
  var simState = null;         // 내가 호스트일 때만 있다
  var drawState = null;
  var buf = new Interp.Buffer();
  var wasHost = false;

  /* ---------- 입력 ---------- */
  var keys = {};
  var myInput = { x: 0, y: 0, act: 0, seq: 0 };
  var sentStr = '';
  var lastSendMs = 0;

  /* ---------- 로컬 예측 ---------- */
  var localPos = null;
  var localDir = 0;

  /* ---------- 계측 ---------- */
  var fps = 0, frames = 0, fpsAt = 0;
  var writeFail = 0;
  var lastSnapBytes = 0;
  var lastSnapAt = 0, lastSeenAt = 0, lastClaimAt = 0, lastHudAt = 0;
  var prevFrame = 0;

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
       읽을 것이 있어야 하고, 방에 들어오자마자 뭐라도 흘러야 스트림이 산다. */
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
      host: pid, phase: 'lobby', stage: 1, born: Date.now()
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
      enter(c);
    });
  }

  function doStart() {
    if (!isHost()) return;
    Net.put('rooms/' + code + '/meta/phase', 'play').then(countWrite);
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

    var st = d.st || null;
    if (st && typeof st.t === 'number') {
      if (st.t !== lastTick) {
        lastTick = st.t;
        lastChangeMs = Date.now();
        lastSnap = st;
        /* tSec 은 반드시 로컬 수신 시각이다. 호스트 시계인 st.t 를 넣으면
           보간이 시작조차 안 하고 캐릭터가 뚝뚝 끊긴다(interp.js 머리말). */
        if (!isHost()) buf.push(nowSec(), st);
      }
    }

    if (meta && meta.phase === 'play') Hud.show('Game');
    else if (code) Hud.show('Lobby');
  }

  function aliveList() {
    return Room.alive(who, Date.now());
  }

  function allInputs() {
    /* 내 입력은 네트워크를 돌아 오기를 기다리지 않는다. 호스트가 자기 입력을
       150ms 뒤에 받으면 호스트만 조작이 굼떠 보인다. */
    var o = {}, k;
    if (netIn) for (k in netIn) {
      if (Object.prototype.hasOwnProperty.call(netIn, k)) o[k] = netIn[k];
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
        /* 승계 — 남이 돌리던 판을 이어받는다 */
        simState = Snap.unpack(lastSnap, MAP);
      } else {
        simState = Sim.create(MAP, []);
      }
    }

    for (var i = 0; i < alive.length; i++) simState = Sim.join(simState, alive[i], i);

    /* 반드시 마지막이다. Snap 은 전송량 때문에 seq 를 안 담아서, 이어받은
       판의 players[].seq 는 전부 0 이다. 그대로 tick 을 돌리면 각자가 매치
       내내 보낸 입력 전체(seq 400+)를 "새 액션"으로 오인해 그 자리에서
       재생한다 — 물건이 순간이동하고 점수가 부풀어 오른다. 지금 입력이
       말하는 값으로 맞춰 두면 다음 틱에서 want - have 가 0 이 된다. */
    simState = Sim.adopt(simState, allInputs());
    wasHost = true;
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

  function hostTick(dt, nowMs) {
    if (!simState) becomeHost();
    simState = Sim.tick(simState, allInputs(), dt);
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
    var out = Snap.unpack(s.b, MAP);
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
     ============================================================ */

  function predict(dt) {
    if (!drawState) return;
    var srv = drawState.players[pid];
    if (!localPos) {
      if (!srv) return;
      localPos = { x: srv.x, y: srv.y };
    }

    if (myInput.x || myInput.y) {
      var len = Math.sqrt(myInput.x * myInput.x + myInput.y * myInput.y);
      var vx = (myInput.x / len) * Sim.SPEED * dt;
      var vy = (myInput.y / len) * Sim.SPEED * dt;
      /* 벽만 본다. 사람끼리 밀기는 호스트가 정한다 — 남의 위치는 150ms 과거라
         여기서 밀어 보면 매 프레임 호스트와 싸운다. */
      var np = W.move(MAP, localPos.x, localPos.y, vx, vy);
      localPos.x = np.x; localPos.y = np.y;
      if (Math.abs(myInput.x) > Math.abs(myInput.y)) localDir = myInput.x > 0 ? 2 : 1;
      else localDir = myInput.y > 0 ? 0 : 3;
    }

    if (srv) {
      var c = Interp.correct(localPos, srv, dt);
      localPos.x = c.x; localPos.y = c.y;
      /* drawState 가 시뮬레이션 원본(호스트)이면 건드리면 안 된다.
         호스트는 자기가 곧 정답이라 예측할 것도 없다. */
      if (drawState !== simState) {
        srv.x = localPos.x; srv.y = localPos.y; srv.dir = localDir;
      }
    }
  }

  /* ============================================================
     느린 주기들
     ============================================================ */

  function heartbeat(nowMs) {
    if (nowMs - lastSeenAt < SEEN_MS) return;
    lastSeenAt = nowMs;
    Net.put('rooms/' + code + '/who/' + pid + '/seen', nowMs).then(countWrite);
  }

  function claimCheck(nowMs) {
    if (nowMs - lastClaimAt < CLAIM_MS) return;
    lastClaimAt = nowMs;
    if (!meta) return;

    var act = Room.shouldClaim({
      me: pid, host: meta.host, who: who,
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
    Hud.setWho(who, alive, meta && meta.host, pid, isHost());
    if (drawState) Hud.setGoal(drawState.done, drawState.goal.count);

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

  function readKeys() {
    var x = 0, y = 0;
    if (keys.ArrowLeft || keys.KeyA) x -= 1;
    if (keys.ArrowRight || keys.KeyD) x += 1;
    if (keys.ArrowUp || keys.KeyW) y -= 1;
    if (keys.ArrowDown || keys.KeyS) y += 1;
    myInput.x = x; myInput.y = y;
    myInput.act = (keys.Space || keys.ShiftLeft || keys.ShiftRight) ? 1 : 0;
  }

  function sendInput(nowMs) {
    var s = myInput.x + ',' + myInput.y + ',' + myInput.act + ',' + myInput.seq;
    if (s === sentStr) return;
    /* 방향키를 붙잡고 있으면 값이 안 바뀌어 쓰기가 아예 없다. 문제는 대각선으로
       비빌 때다 — 초당 60번 바뀔 수 있고, 8명이면 초당 480번이 되어 입력이
       스냅샷보다 무거워진다. 초당 8회면 사람 손보다 빠르다. */
    if (nowMs - lastSendMs < 1000 / SEND_HZ) return;
    lastSendMs = nowMs;
    sentStr = s;
    Net.put('rooms/' + code + '/in/' + pid, {
      x: myInput.x, y: myInput.y, act: myInput.act, seq: myInput.seq
    }).then(countWrite);
  }

  function bindKeys() {
    global.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      keys[e.code] = true;
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight' ||
          e.code === 'Enter' || e.code === 'KeyE') {
        /* 액션은 키를 누른 순간 한 번이다. seq 를 올리면 호스트가 늘어난
           만큼 처리한다 — 패킷이 밀려도 연타가 씹히지 않는다. */
        myInput.seq++;
      }
      if (e.code.indexOf('Arrow') === 0 || e.code === 'Space') e.preventDefault();
    });
    global.addEventListener('keyup', function (e) { keys[e.code] = false; });
    /* 창을 벗어나면 키가 눌린 채로 남아 혼자 벽으로 계속 걸어간다 */
    global.addEventListener('blur', function () { keys = {}; });
  }

  /* ============================================================
     루프
     ============================================================ */

  /* 프레임 한 장. frame() 이 dt 를 재서 부르고, 확인 코드가 game.step(dt) 로
     직접 부를 수도 있다 — 숨은 탭에서는 requestAnimationFrame 이 아예 안 돌아서
     그러지 않으면 조립을 브라우저에서 검증할 방법이 없다. */
  function step(dt, nowMs) {
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

  function frame(ts) {
    global.requestAnimationFrame(frame);
    var t = ts / 1000;
    var dt = prevFrame ? (t - prevFrame) : 0;
    prevFrame = t;
    if (dt < 0) dt = 0;
    /* 백그라운드에 있다 돌아오면 몇 초짜리 프레임이 한 번 온다. 그대로 먹이면
       그 한 틱에 모두가 화면을 가로질러 순간이동한다. */
    if (dt > DT_MAX) dt = DT_MAX;

    frames++;
    if (t - fpsAt >= 1) { fps = Math.round(frames / (t - fpsAt)); frames = 0; fpsAt = t; }

    step(dt, Date.now());
  }

  /* ============================================================
     시작
     ============================================================ */

  function boot() {
    pid = makePid();

    Hud.init({ create: doCreate, join: doJoin, start: doStart });

    var els = Hud.els();
    try {
      if (els.nick) els.nick.value = global.localStorage.getItem('ow.nick') || '';
      var c = parseInt(global.localStorage.getItem('ow.char') || '0', 10);
      if (c >= 0 && c < Sprite.CHARS.length) Hud.setPick(c);
    } catch (e) {}

    /* 초대 링크(#ABCD)로 들어온 사람은 코드를 이미 갖고 있다 */
    var h = Room.cleanCode((global.location.hash || '').replace('#', ''));
    if (h && els.roomInput) els.roomInput.value = h;

    Hud.setGoal(0, St.STAGE1_GOAL.count);
    Hud.show('Start');
    bindKeys();

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
      } catch (e) {}
    });

    global.requestAnimationFrame(frame);
  }

  var api = {
    pid: null, code: null, meta: null, who: null, state: null,
    scale: 1, fps: 0, writeFail: 0, lastSnapBytes: 0,
    isHost: isHost,
    /* 확인용 손잡이 — Step 6·7 과 Task 12 가 이 값들을 읽는다 */
    sim: function () { return simState; },
    buffer: function () { return buf; },
    inputs: function () { return allInputs(); },
    myInput: myInput,
    step: function (dt) { step(Math.min(dt || 1 / 60, DT_MAX), Date.now()); },
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
