/* ============================================================
   모코파크 — 시뮬레이션 (호스트 전용, 유일한 권위)

   호스트 브라우저만 이걸 돌린다. 나머지는 결과를 받아 그린다.
   네트워크도 캔버스도 DOM 도 모른다 — 브라우저 없이 Node 로 전부 검증한다.

   ── sup 이 왜 있는가 ────────────────────────────────────
   플레이어마다 "무엇에 받쳐져 있는지"를 기록한다.
     0 공중   1 타일(땅·벽)   2 남의 머리   3 움직이는 발판
   클라이언트는 sup 이 2 나 3 일 때 예측을 끈다. 내 화면 속 남은 150ms 과거라,
   그 사람을 발판 삼아 예측하면 매번 어긋나 "분명 밟았는데 떨어졌다"가 된다.
   움직이는 발판도 같은 이유다 — 발판은 rt 로 정해지지만 그 위의 나는
   호스트가 옮겨 주고 있어서, 내가 따로 예측하면 두 번 옮겨진다.

   ── t 와 rt 를 갈라 놓은 이유 ───────────────────────────
   t 는 판이 시작된 뒤로 계속 는다. rt 는 "이번 라운드가 시작된 뒤로"다.
   시계 장치(움직이는 발판, 깜빡이는 가시)는 전부 rt 로 돈다 — 라운드를
   다시 시작하면 판이 늘 똑같은 모습에서 출발해야 배울 수 있기 때문이다.
   그런데 t 를 0 으로 되돌리면 안 된다. t 는 "호스트가 살아 있나"의 근거이기도
   해서(3초간 안 늘면 죽은 것으로 본다), 되돌리는 순간 남들이 멀쩡한 호스트를
   죽었다고 보고 승계 경쟁을 시작한다. 그래서 시계용 시각을 따로 둔다.

   ── 라운드 재시작 ───────────────────────────────────────
   가시에 닿거나, 맵 밖으로 떨어지거나, 누가 "다시 하기"를 누르면 전원이
   처음부터. 실수가 개인이 아니라 팀에 간다 — 피코파크의 규칙이고,
   방해 요소가 진짜 무게를 갖게 하는 유일한 방법이다.
   재시작 직후 FREEZE 초는 아무도 안 움직인다. 왜 튕겼는지 볼 시간이다.

   ── 코요테 타임과 점프 버퍼 ─────────────────────────────
   발판을 벗어나고도 잠깐은 점프가 되고(코요테), 착지 직전에 누른 점프는
   기억했다가 닿는 순간 쓴다(버퍼). 조작감을 좋게 하는 표준 기법인데,
   지연을 가리는 데도 그대로 쓰인다.

   ── 입력 계열이 둘이다 ──────────────────────────────────
   jseq(점프)와 rseq(다시 하기). 둘 다 "누른 횟수"로 온다. 패킷이 밀려도
   안 씹히고, 같은 값이 여러 번 와도 한 번만 처리된다.
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
  var DOOR_LINGER = 4;      // 버튼에서 내려온 뒤 문이 열려 있는 시간

  var CRACK = 0.45;         // 발판을 밟고 나서 무너지기까지
  var REGROW = 3.0;         // 무너진 발판이 돌아오기까지
  var CONVEYOR = 90;        // 미는 바닥이 초당 밀어내는 거리
  var FREEZE = 0.8;         // 재시작 직후 멈춰 있는 시간
  var FALL_OUT = 80;        // 바닥에서 이만큼 더 내려가면 떨어진 것

  var L = null, G = null;
  function deps() { if (!L) { L = global.Levels; G = global.Grid; } }

  function copyPlayers(src) {
    var o = {}, k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) {
      var p = src[k];
      o[k] = { x: p.x, y: p.y, py: p.py, vx: p.vx, vy: p.vy, face: p.face, sup: p.sup,
               coy: p.coy, buf: p.buf, jseq: p.jseq, rseq: p.rseq, rid: p.rid, done: p.done };
    }
    return o;
  }

  function copyCr(src) {
    var o = {}, k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) o[k] = src[k];
    return o;
  }

  function spawnOf(lv, i) {
    var s = lv.spawns[i % lv.spawns.length];
    return { x: s.x, y: s.y };
  }

  function newPlayer(lv, i) {
    var s = spawnOf(lv, i);
    return { x: s.x, y: s.y, py: s.y, vx: 0, vy: 0, face: 1, sup: 0,
             coy: 0, buf: 0, jseq: 0, rseq: 0, rid: -1, done: false };
  }

  function create(lvIndex, pids) {
    deps();
    var st = { t: 0, rt: 0, lv: lvIndex | 0, players: {}, door: false, doorT: 0,
               cr: {}, freeze: 0, fail: '', cleared: false, spawnIdx: {} };
    var list = pids || [];
    for (var i = 0; i < list.length; i++) {
      st.players[list[i]] = newPlayer(L.LIST[st.lv], i);
      st.spawnIdx[list[i]] = i;
    }
    return st;
  }

  function shell(state, players) {
    return { t: state.t, rt: state.rt, lv: state.lv, players: players,
             door: state.door, doorT: state.doorT, cr: state.cr,
             freeze: state.freeze, fail: state.fail,
             cleared: state.cleared, spawnIdx: state.spawnIdx };
  }

  function join(state, pid, spawnIndex) {
    deps();
    if (state.players[pid]) return state;
    var players = copyPlayers(state.players);
    var idx = {}, k;
    for (k in state.spawnIdx) if (Object.prototype.hasOwnProperty.call(state.spawnIdx, k)) idx[k] = state.spawnIdx[k];
    idx[pid] = spawnIndex | 0;
    players[pid] = newPlayer(L.LIST[state.lv], spawnIndex | 0);
    var out = shell(state, players);
    out.spawnIdx = idx;
    return out;
  }

  function leave(state, pid) {
    var players = copyPlayers(state.players);
    var idx = {}, k;
    for (k in state.spawnIdx) if (Object.prototype.hasOwnProperty.call(state.spawnIdx, k) && k !== pid) idx[k] = state.spawnIdx[k];
    delete players[pid];
    var out = shell(state, players);
    out.spawnIdx = idx;
    return out;
  }

  /* 승계한 호스트가 한 번 부른다. 스냅샷은 전송량 때문에 입력 계열(jseq, rseq)을
     안 담아서, 이어받은 판의 값은 전부 0 이다. 그대로 tick 을 돌리면 각자가 매치
     내내 누른 점프 전체를 "새 입력"으로 오인해 그 자리에서 재생하고, 다시 하기도
     같이 터진다. 지금 입력이 말하는 값으로 맞춰 두면 다음 틱에서 차이가 0 이 된다. */
  function adopt(state, inputs) {
    var players = copyPlayers(state.players), k;
    for (k in players) if (Object.prototype.hasOwnProperty.call(players, k)) {
      var inp = inputs && inputs[k];
      players[k].jseq = (inp && inp.jseq) || 0;
      players[k].rseq = (inp && inp.rseq) || 0;
    }
    return shell(state, players);
  }

  /* 이번 라운드를 처음으로. 전원이 시작 자리로 돌아가고 시계가 0 이 된다.
     입력 계열(jseq, rseq)은 건드리지 않는다 — 그건 판 상태가 아니라
     "그 사람이 지금까지 몇 번 눌렀나"라서, 되돌리면 다음 틱에 전부 재생된다. */
  function restart(state, who) {
    deps();
    var lv = L.LIST[state.lv];
    var players = copyPlayers(state.players), k;
    for (k in players) if (Object.prototype.hasOwnProperty.call(players, k)) {
      var p = players[k];
      var s = spawnOf(lv, state.spawnIdx[k] || 0);
      p.x = s.x; p.y = s.y; p.py = s.y;
      p.vx = 0; p.vy = 0; p.sup = 0; p.coy = 0; p.buf = 0;
      p.rid = -1; p.done = false;
    }
    var out = shell(state, players);
    out.rt = 0;
    out.door = false; out.doorT = 0;
    out.cr = {};
    out.freeze = FREEZE;
    out.fail = who || '';
    out.cleared = false;
    return out;
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

  /* 깜빡이는 가시가 지금 나와 있나. ! 가 앞 절반, ? 가 뒷 절반이다.
     주기가 0 인 판(깜빡이 가시가 없는 판)에서는 아무 값이나 상관없다. */
  function blinkOn(lv, rt) {
    var p = lv.blink || 0;
    if (!p) return false;
    var u = (rt / p) - Math.floor(rt / p);
    return u < 0.5;
  }

  function envOf(state) {
    return { door: state.door, cr: state.cr };
  }

  function tick(state, inputs, dt) {
    deps();
    var lv = L.LIST[state.lv];
    var players = copyPlayers(state.players);
    var cr = copyCr(state.cr);
    var keys = Object.keys(players).sort();
    var i, k, pid, p, inp;

    /* ---- 0. 입력 계열을 먼저 걷는다 ----
       멈춰 있는 동안에도 걷어야 한다. 안 그러면 멈춤이 풀리는 순간
       그동안 눌린 점프가 한꺼번에 터진다. */
    var wantRestart = '';
    for (i = 0; i < keys.length; i++) {
      pid = keys[i]; p = players[pid];
      inp = (inputs && inputs[pid]) || null;

      var wantR = inp ? (inp.rseq || 0) : p.rseq;
      if (wantR > p.rseq) { if (!wantRestart) wantRestart = pid; }
      p.rseq = wantR > p.rseq ? wantR : p.rseq;

      var want = inp ? (inp.jseq || 0) : p.jseq;
      var n = want - p.jseq;
      if (n < 0) n = 0;
      if (n > MAX_JUMPS) n = MAX_JUMPS;
      p.jseq = p.jseq + n;
      /* 멈춰 있는 동안 누른 점프는 버린다 — 기억해 두면 풀리자마자 튄다 */
      if (n > 0 && state.freeze <= 0) p.buf = JUMP_BUF;
    }

    /* ---- 1. 멈춤 중이면 시계만 돌린다 ---- */
    if (state.freeze > 0) {
      var out0 = shell(state, players);
      out0.t = state.t + dt;
      out0.freeze = Math.max(0, state.freeze - dt);
      out0.cr = cr;
      return out0;
    }

    var rt = state.rt;
    var env = envOf(state);
    var blink = blinkOn(lv, rt);

    /* ---- 2. 움직이는 발판이 태우고 간다 ----
       발판 위치는 rt 로 정해지므로, 이번 틱에 발판이 움직인 만큼을 먼저
       사람에게 그대로 옮겨 준다. 그 뒤에 평소대로 물리를 푼다. */
    for (i = 0; i < keys.length; i++) {
      p = players[keys[i]];
      if (p.rid < 0 || !lv.movers[p.rid]) continue;
      var m = lv.movers[p.rid];
      var a = G.moverAt(m, rt), b = G.moverAt(m, rt + dt);
      p.x += b.x - a.x;
      p.y += b.y - a.y;
    }

    /* ---- 3. 입력·중력·타일 충돌 ---- */
    for (i = 0; i < keys.length; i++) {
      pid = keys[i]; p = players[pid];
      inp = (inputs && inputs[pid]) || null;
      var ix = inp ? (inp.x || 0) : 0;

      p.vx = ix * SPEED;
      if (ix) p.face = ix > 0 ? 1 : -1;

      /* 미는 바닥은 조작에 더해진다 — 거스를 수는 있되 힘이 든다 */
      if (p.sup === 1) {
        var pd = G.pushOf(lv, p.x, p.y);
        if (pd) p.vx += pd * CONVEYOR;
      }

      p.vy += GRAVITY * dt;
      if (p.vy > MAX_FALL) p.vy = MAX_FALL;

      /* 코요테: 받쳐져 있으면 채우고, 아니면 줄인다 */
      if (p.sup !== 0) p.coy = COYOTE;
      else p.coy = Math.max(0, p.coy - dt);
      p.buf = Math.max(0, p.buf - dt);

      if (p.buf > 0 && p.coy > 0) {
        p.vy = -JUMP_V;
        p.buf = 0; p.coy = 0;
        p.sup = 0; p.rid = -1;
      }

      var rx = G.moveX(lv, p.x, p.y, p.vx * dt, env);
      p.x = rx.x;
      if (rx.hit) p.vx = 0;

      p.py = p.y;                       // 이번 틱 세로 이동 전 위치 (머리·발판 밟기 판정용)
      var ry = G.moveY(lv, p.x, p.y, p.vy * dt, env);
      var wasFalling = p.vy > 0;
      p.y = ry.y;
      p.sup = 0;
      p.rid = -1;
      if (ry.hit) {
        if (wasFalling) p.sup = 1;        // 땅에 닿았다
        p.vy = 0;
      }
    }

    /* ---- 4. 움직이는 발판에 올라서기 ----
       "직전엔 발판 위, 지금은 아래"로 본다. 타일 일방통행과 같은 규칙이다.
       발판도 rt + dt 자리로 본다 — 사람은 이미 그 시각까지 왔기 때문이다. */
    for (i = 0; i < keys.length; i++) {
      p = players[keys[i]];
      if (p.vy < 0) continue;
      for (var mi = 0; mi < lv.movers.length; mi++) {
        var box = G.moverAt(lv.movers[mi], rt + dt);
        if (p.x + L.PW <= box.x || p.x >= box.x + box.w) continue;
        var feet = p.y + L.PH, top = box.y;
        if (p.py + L.PH <= top + 2 && feet >= top) {
          p.y = top - L.PH;
          p.vy = 0;
          p.sup = 3;
          p.rid = mi;
          break;
        }
      }
    }

    /* ---- 5. 남의 머리 위에 올라서기 ---- */
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
        var feet2 = p.y + L.PH, head = q.y;
        /* 띠로 재면 안 된다. 낙하 최고속도(1200)면 한 프레임에 20px 를 가는데
           띠가 그보다 좁으면 남의 머리를 그냥 뚫고 지나간다.
           "직전에는 머리 위에 있었고 지금은 아래에 있다"로 본다. */
        if (p.py + L.PH <= head + HEAD_BAND && feet2 >= head) {
          p.y = head - L.PH;
          p.vy = 0;
          p.sup = 2;                                 // 남을 밟고 있다
          p.rid = -1;
          break;
        }
      }
    }

    /* ---- 6. 가로로 겹치면 서로 밀어낸다 (같은 높이일 때만) ---- */
    for (i = 0; i < keys.length; i++) {
      for (var m2 = i + 1; m2 < keys.length; m2++) {
        var a2 = players[keys[i]], b2 = players[keys[m2]];
        var dy = Math.abs((a2.y + L.PH / 2) - (b2.y + L.PH / 2));
        if (dy > L.PH * 0.7) continue;               // 위아래로 쌓인 건 안 민다
        /* 출입구 안에서는 안 민다. 출입구는 두 칸(80px)이라 몸(28px)이
           서너 개면 꽉 찬다 — 미는 규칙을 그대로 두면 8명이 모이는 순간
           서로를 밖으로 밀어내서 "전원 도착"이 영원히 성립하지 않는다. */
        if (G.inGoal(lv, a2.x, a2.y) && G.inGoal(lv, b2.x, b2.y)) continue;
        var ax = a2.x + L.PW / 2, bx = b2.x + L.PW / 2;
        var gap = Math.abs(ax - bx);
        if (gap >= L.PW) continue;
        var pushAmt = (L.PW - gap) * PUSH;
        var dir = ax < bx ? -1 : 1;
        var na = G.moveX(lv, a2.x, a2.y, dir * pushAmt, env);
        var nb = G.moveX(lv, b2.x, b2.y, -dir * pushAmt, env);
        a2.x = na.x; b2.x = nb.x;
      }
    }

    /* ---- 7. 부서지는 발판 ----
       밟은 칸은 금이 가기 시작하고(양수), 다 되면 무너진다(음수).
       음수가 0 에 닿으면 돌아온다. */
    for (i = 0; i < keys.length; i++) {
      p = players[keys[i]];
      if (p.sup !== 1) continue;
      var ft = G.footTiles(lv, p.x, p.y);
      for (var fi = 0; fi < ft.length; fi++) {
        if (ft[fi].t !== 'x') continue;
        if (cr[ft[fi].idx] === undefined) cr[ft[fi].idx] = CRACK;
      }
    }
    for (k in cr) {
      if (!Object.prototype.hasOwnProperty.call(cr, k)) continue;
      var v = cr[k];
      if (v > 0) {
        v -= dt;
        cr[k] = (v <= 0) ? -REGROW : v;     // 다 갈라졌으면 무너진다
      } else {
        v += dt;
        if (v >= 0) delete cr[k]; else cr[k] = v;
      }
    }

    /* ---- 8. 버튼 → 문 ----
       needs 명이 동시에 밟고 있어야 열린다. 버튼 칸이 아니라 사람 수를 센다 —
       칸을 세면 한 사람이 두 칸에 걸쳐 서서 두 명 몫을 한다. */
    var pressed = 0;
    for (i = 0; i < keys.length; i++) {
      p = players[keys[i]];
      if (p.sup === 1 && G.onButton(lv, p.x, p.y)) pressed++;
    }
    var holding = pressed >= (lv.needs || 1);
    var doorT = holding ? DOOR_LINGER : Math.max(0, (state.doorT || 0) - dt);
    var door = doorT > 0;

    /* ---- 9. 닫힌 문에 낀 사람 빼내기 ----
       문이 열린 사이 문 칸에 들어갔다가 그대로 닫히면 몸이 벽 속에 박힌다.
       slide 는 이미 겹친 자리에서는 0 을 돌려주므로 좌우 어느 쪽으로도 못
       가고, 점프해도 못 빠진다 — 그 사람은 판이 끝날 때까지 갇힌다. */
    var env2 = { door: door, cr: cr };
    for (i = 0; i < keys.length; i++) {
      p = players[keys[i]];
      if (!G.hits(lv, p.x, p.y, env2)) continue;
      var free = unstick(lv, p, env2);
      if (free !== null) p.x = free;
    }

    /* ---- 10. 실패했나 ----
       가시에 닿았거나, 맵 밖으로 떨어졌거나, 누가 다시 하기를 눌렀다.
       셋 다 같은 처리다 — 라운드를 처음부터. */
    var failed = wantRestart;
    if (!failed) {
      for (i = 0; i < keys.length; i++) {
        pid = keys[i]; p = players[pid];
        if (p.y > L.H + FALL_OUT) { failed = pid; break; }
        if (G.inHazard(lv, p.x, p.y, blink)) { failed = pid; break; }
      }
    }

    /* ---- 11. 전원이 출입구에 있으면 판 끝 ---- */
    var all = keys.length > 0;
    for (i = 0; i < keys.length; i++) {
      p = players[keys[i]];
      p.done = G.inGoal(lv, p.x, p.y);
      if (!p.done) all = false;
    }

    var out = shell(state, players);
    out.t = state.t + dt;
    out.rt = rt + dt;
    out.door = door;
    out.doorT = doorT;
    out.cr = cr;
    out.freeze = 0;
    out.fail = '';
    out.cleared = all;

    /* 도착이 실패를 이긴다. 마지막 한 명이 출입구에 들어가는 그 프레임에
       다른 누가 가시를 스쳤다고 판을 되돌리면, 다 깬 것을 빼앗기는 셈이다. */
    if (failed && !all) return restart(out, failed);
    return out;
  }

  /* 몸이 벽 안에 박혔을 때 가장 가까운 빈자리를 찾는다. 가던 쪽(face)을
     먼저 본다 — 문턱에 서 있다가 뒤로 되돌려지는 것보다 지나가던 방향으로
     통과시키는 편이 억울하지 않다. */
  function unstick(lv, p, env) {
    var first = p.face < 0 ? -1 : 1;
    for (var d = 2; d <= 2 * L.TILE + L.PW; d += 2) {
      if (!G.hits(lv, p.x + first * d, p.y, env)) return p.x + first * d;
      if (!G.hits(lv, p.x - first * d, p.y, env)) return p.x - first * d;
    }
    return null;
  }

  /* 다음 판으로. 마지막 판이면 그대로 둔다.
     upTo 를 주면 거기까지만 간다 — AI 동료가 있는 방은 3판이 끝이다. */
  function nextLevel(state, upTo) {
    deps();
    var last = (upTo === undefined || upTo === null) ? L.LIST.length : Math.min(upTo, L.LIST.length);
    if (state.lv + 1 >= last) return state;
    var pids = Object.keys(state.players).sort();
    var st = create(state.lv + 1, pids);
    var idx = {}, k;
    for (k in state.spawnIdx) if (Object.prototype.hasOwnProperty.call(state.spawnIdx, k)) idx[k] = state.spawnIdx[k];
    st.spawnIdx = idx;
    /* 자리 번호를 지켜서 다시 세운다 — 사람마다 늘 같은 자리에서 시작한다 */
    for (k in st.players) if (Object.prototype.hasOwnProperty.call(st.players, k)) {
      var s = spawnOf(L.LIST[st.lv], idx[k] || 0);
      st.players[k].x = s.x; st.players[k].y = s.y; st.players[k].py = s.y;
      /* 입력 계열은 사람에게 붙은 것이라 판이 바뀌어도 이어진다 */
      st.players[k].jseq = state.players[k] ? state.players[k].jseq : 0;
      st.players[k].rseq = state.players[k] ? state.players[k].rseq : 0;
    }
    st.t = state.t;                 // 호스트 생존 판단이 이 값에 걸려 있다
    st.freeze = FREEZE;             // 새 판도 잠깐 보고 시작한다
    return st;
  }

  global.Sim = {
    SPEED: SPEED, GRAVITY: GRAVITY, JUMP_V: JUMP_V, MAX_FALL: MAX_FALL,
    COYOTE: COYOTE, JUMP_BUF: JUMP_BUF, HEAD_BAND: HEAD_BAND, MAX_JUMPS: MAX_JUMPS,
    DOOR_LINGER: DOOR_LINGER, CRACK: CRACK, REGROW: REGROW,
    CONVEYOR: CONVEYOR, FREEZE: FREEZE, FALL_OUT: FALL_OUT,
    create: create, join: join, leave: leave, adopt: adopt,
    restart: restart, blinkOn: blinkOn,
    tick: tick, nextLevel: nextLevel
  };
})(window);
