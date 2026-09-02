/* ============================================================
   퇴근파크 — 시뮬레이션 (호스트 전용, 유일한 권위)

   호스트 브라우저만 이걸 돌린다. 나머지는 결과를 받아 그린다.
   네트워크도 캔버스도 DOM 도 모른다 — 브라우저 없이 Node 로 전부 검증한다.

   ── sup 이 왜 있는가 ────────────────────────────────────
   플레이어마다 "무엇에 받쳐져 있는지"를 기록한다.
     0 공중   1 타일(땅·벽)   2 남의 머리
   클라이언트는 sup === 2 일 때 예측을 끈다. 내 화면 속 남은 150ms 과거라,
   그 사람을 발판 삼아 예측하면 매번 어긋나 "분명 밟았는데 떨어졌다"가 된다.
   이 값을 스냅샷에 실어야 그 규칙이 성립한다.

   ── 코요테 타임과 점프 버퍼 ─────────────────────────────
   발판을 벗어나고도 잠깐은 점프가 되고(코요테), 착지 직전에 누른 점프는
   기억했다가 닿는 순간 쓴다(버퍼). 조작감을 좋게 하는 표준 기법인데,
   지연을 가리는 데도 그대로 쓰인다 — 한 프레임 차이로 점프가 씹히면
   그게 지연 탓인지 내 탓인지 알 수가 없다.

   ── 죽음이 없는 이유 ────────────────────────────────────
   떨어지면 그 사람만 시작점에서 되살아난다. 한 명이 실수해서 전원이
   처음부터 다시 하면 사내에서 못 한다.
   ============================================================ */
(function (global) {
  'use strict';

  var SPEED = 240;          // 초당 가로 이동 (디자인 픽셀)
  var GRAVITY = 2000;
  var JUMP_V = 760;         // 도달 높이 = 760^2/(2*2000) = 144px = 3.6칸
  var MAX_FALL = 1200;
  var COYOTE = 0.12;        // 발판을 벗어난 뒤 점프가 먹히는 시간
  var JUMP_BUF = 0.12;      // 착지 전에 누른 점프를 기억하는 시간
  var HEAD_BAND = 14;       // 발바닥이 이만큼 안이면 남의 머리에 올라선다
  var PUSH = 0.5;           // 가로로 겹쳤을 때 서로 밀어내는 비율
  var MAX_JUMPS = 4;        // 한 틱에 처리할 점프 상한 (밀린 입력 폭주 방지)

  var L = null;
  function deps() { if (!L) L = global.Levels; }

  function copyPlayers(src) {
    var o = {}, k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) {
      var p = src[k];
      o[k] = { x: p.x, y: p.y, py: p.py, vx: p.vx, vy: p.vy, face: p.face, sup: p.sup,
               coy: p.coy, buf: p.buf, jseq: p.jseq, done: p.done };
    }
    return o;
  }

  function spawnOf(lv, i) {
    var s = lv.spawns[i % lv.spawns.length];
    return { x: s.x, y: s.y };
  }

  function newPlayer(lv, i) {
    var s = spawnOf(lv, i);
    return { x: s.x, y: s.y, py: s.y, vx: 0, vy: 0, face: 1, sup: 0,
             coy: 0, buf: 0, jseq: 0, done: false };
  }

  function create(lvIndex, pids) {
    deps();
    var st = { t: 0, lv: lvIndex | 0, players: {}, door: false, cleared: false, spawnIdx: {} };
    var list = pids || [];
    for (var i = 0; i < list.length; i++) {
      st.players[list[i]] = newPlayer(L.LIST[st.lv], i);
      st.spawnIdx[list[i]] = i;
    }
    return st;
  }

  function join(state, pid, spawnIndex) {
    deps();
    if (state.players[pid]) return state;
    var players = copyPlayers(state.players);
    var idx = {}, k;
    for (k in state.spawnIdx) if (Object.prototype.hasOwnProperty.call(state.spawnIdx, k)) idx[k] = state.spawnIdx[k];
    idx[pid] = spawnIndex | 0;
    players[pid] = newPlayer(L.LIST[state.lv], spawnIndex | 0);
    return { t: state.t, lv: state.lv, players: players, door: state.door,
             cleared: state.cleared, spawnIdx: idx };
  }

  function leave(state, pid) {
    var players = copyPlayers(state.players);
    var idx = {}, k;
    for (k in state.spawnIdx) if (Object.prototype.hasOwnProperty.call(state.spawnIdx, k) && k !== pid) idx[k] = state.spawnIdx[k];
    delete players[pid];
    return { t: state.t, lv: state.lv, players: players, door: state.door,
             cleared: state.cleared, spawnIdx: idx };
  }

  /* 승계한 호스트가 한 번 부른다. 스냅샷은 전송량 때문에 jseq 를 안 담아서,
     이어받은 판의 jseq 는 전부 0 이다. 그대로 tick 을 돌리면 각자가 매치 내내
     누른 점프 전체를 "새 입력"으로 오인해 그 자리에서 재생한다. */
  function adopt(state, inputs) {
    var players = copyPlayers(state.players), k;
    for (k in players) if (Object.prototype.hasOwnProperty.call(players, k)) {
      players[k].jseq = (inputs && inputs[k] && inputs[k].jseq) || 0;
    }
    return { t: state.t, lv: state.lv, players: players, door: state.door,
             cleared: state.cleared, spawnIdx: state.spawnIdx };
  }

  /* 낮은 사람(y 가 큰 쪽)부터 푼다. 받쳐 주는 쪽이 먼저 자리를 잡아야
     그 위에 선 사람이 제자리를 찾는다. y 가 같으면 pid 로 갈라 모두가
     같은 답을 얻게 한다 — 사람마다 다른 순서면 화면이 갈린다. */
  function orderByHeight(players) {
    var keys = Object.keys(players).sort();
    keys.sort(function (a, b) {
      var d = players[b].y - players[a].y;
      if (d !== 0) return d;
      return a < b ? -1 : 1;
    });
    return keys;
  }

  function tick(state, inputs, dt) {
    deps();
    var lv = L.LIST[state.lv];
    var players = copyPlayers(state.players);
    var keys = Object.keys(players).sort();
    var i, k, pid, p, inp;

    /* ---- 1. 입력·중력·타일 충돌 ---- */
    for (i = 0; i < keys.length; i++) {
      pid = keys[i]; p = players[pid];
      inp = (inputs && inputs[pid]) || null;
      var ix = inp ? (inp.x || 0) : 0;

      /* 점프 입력은 누른 횟수로 온다. 한 번만 처리하면 패킷이 밀렸을 때
         점프가 씹힌다. 대신 한 틱 상한을 둬서 폭주는 막는다. */
      var want = inp ? (inp.jseq || 0) : p.jseq;
      var n = want - p.jseq;
      if (n < 0) n = 0;
      if (n > MAX_JUMPS) n = MAX_JUMPS;
      if (n > 0) p.buf = JUMP_BUF;
      p.jseq = p.jseq + n;

      p.vx = ix * SPEED;
      if (ix) p.face = ix > 0 ? 1 : -1;

      p.vy += GRAVITY * dt;
      if (p.vy > MAX_FALL) p.vy = MAX_FALL;

      /* 코요테: 받쳐져 있으면 채우고, 아니면 줄인다 */
      if (p.sup !== 0) p.coy = COYOTE;
      else p.coy = Math.max(0, p.coy - dt);
      p.buf = Math.max(0, p.buf - dt);

      if (p.buf > 0 && p.coy > 0) {
        p.vy = -JUMP_V;
        p.buf = 0; p.coy = 0;
        p.sup = 0;
      }

      var rx = L.moveX(lv, p.x, p.y, p.vx * dt, state.door);
      p.x = rx.x;
      if (rx.hit) p.vx = 0;

      p.py = p.y;                       // 이번 틱 세로 이동 전 위치 (머리 밟기 판정용)
      var ry = L.moveY(lv, p.x, p.y, p.vy * dt, state.door);
      var wasFalling = p.vy > 0;
      p.y = ry.y;
      p.sup = 0;
      if (ry.hit) {
        if (wasFalling) p.sup = 1;        // 땅에 닿았다
        p.vy = 0;
      }
    }

    /* ---- 2. 남의 머리 위에 올라서기 ---- */
    var order = orderByHeight(players);
    for (i = 0; i < order.length; i++) {
      p = players[order[i]];
      if (p.vy < 0) continue;                       // 올라가는 중이면 안 얹힌다
      for (var j = 0; j < order.length; j++) {
        if (i === j) continue;
        var q = players[order[j]];
        if (q === p) continue;
        var overlapX = (p.x + L.PW > q.x + 4) && (p.x < q.x + L.PW - 4);
        if (!overlapX) continue;
        var feet = p.y + L.PH, head = q.y;
        /* 띠로 재면 안 된다. 낙하 최고속도(1200)면 한 프레임에 20px 를 가는데
           띠가 그보다 좁으면 남의 머리를 그냥 뚫고 지나간다.
           "직전에는 머리 위에 있었고 지금은 아래에 있다"로 본다 — 속도와 무관하다. */
        var prevFeet = p.py + L.PH;
        if (prevFeet <= head + HEAD_BAND && feet >= head) {
          p.y = head - L.PH;
          p.vy = 0;
          p.sup = 2;                                 // 남을 밟고 있다
          break;
        }
      }
    }

    /* ---- 3. 가로로 겹치면 서로 밀어낸다 (같은 높이일 때만) ---- */
    for (i = 0; i < keys.length; i++) {
      for (var m = i + 1; m < keys.length; m++) {
        var a = players[keys[i]], b = players[keys[m]];
        var dy = Math.abs((a.y + L.PH / 2) - (b.y + L.PH / 2));
        if (dy > L.PH * 0.7) continue;               // 위아래로 쌓인 건 안 민다
        var ax = a.x + L.PW / 2, bx = b.x + L.PW / 2;
        var gap = Math.abs(ax - bx);
        if (gap >= L.PW) continue;
        var pushAmt = (L.PW - gap) * PUSH;
        var dir = ax < bx ? -1 : 1;
        var na = L.moveX(lv, a.x, a.y, dir * pushAmt, state.door);
        var nb = L.moveX(lv, b.x, b.y, -dir * pushAmt, state.door);
        a.x = na.x; b.x = nb.x;
      }
    }

    /* ---- 4. 버튼 → 문 ---- */
    var door = false;
    for (i = 0; i < keys.length; i++) {
      p = players[keys[i]];
      if (p.sup === 1 && L.onButton(lv, p.x, p.y)) { door = true; break; }
    }

    /* ---- 5. 떨어진 사람은 자기 시작점으로 ---- */
    for (i = 0; i < keys.length; i++) {
      pid = keys[i]; p = players[pid];
      if (p.y > L.H + 80) {
        var s = spawnOf(lv, state.spawnIdx[pid] || 0);
        p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0; p.sup = 0; p.coy = 0; p.buf = 0;
      }
    }

    /* ---- 6. 전원이 출입구에 있으면 판 끝 ---- */
    var all = keys.length > 0, anyDone = 0;
    for (i = 0; i < keys.length; i++) {
      p = players[keys[i]];
      p.done = L.inGoal(lv, p.x, p.y);
      if (p.done) anyDone++; else all = false;
    }

    return { t: state.t + dt, lv: state.lv, players: players,
             door: door, cleared: all, spawnIdx: state.spawnIdx };
  }

  /* 다음 판으로. 마지막 판이면 그대로 둔다. */
  function nextLevel(state) {
    deps();
    if (state.lv + 1 >= L.LIST.length) return state;
    var pids = Object.keys(state.players).sort();
    var st = create(state.lv + 1, pids);
    var idx = {}, k;
    for (k in state.spawnIdx) if (Object.prototype.hasOwnProperty.call(state.spawnIdx, k)) idx[k] = state.spawnIdx[k];
    st.spawnIdx = idx;
    /* 자리 번호를 지켜서 다시 세운다 — 사람마다 늘 같은 자리에서 시작한다 */
    for (k in st.players) if (Object.prototype.hasOwnProperty.call(st.players, k)) {
      var s = spawnOf(L.LIST[st.lv], idx[k] || 0);
      st.players[k].x = s.x; st.players[k].y = s.y;
    }
    return st;
  }

  global.Sim = {
    SPEED: SPEED, GRAVITY: GRAVITY, JUMP_V: JUMP_V, MAX_FALL: MAX_FALL,
    COYOTE: COYOTE, JUMP_BUF: JUMP_BUF, HEAD_BAND: HEAD_BAND, MAX_JUMPS: MAX_JUMPS,
    create: create, join: join, leave: leave, adopt: adopt,
    tick: tick, nextLevel: nextLevel
  };
})(window);
