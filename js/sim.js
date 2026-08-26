/* ============================================================
   오버워크드 — 시뮬레이션 (호스트 전용, 유일한 권위)

   호스트 브라우저만 이걸 돌린다. 나머지는 결과를 받아 그리기만 한다.
   "이 물건을 누가 들었나"에 답이 하나뿐이어야 오버쿡드류가 성립한다.

   이 파일은 네트워크도 캔버스도 DOM 도 모른다. 순수 함수 덩어리라
   브라우저 없이 Node 로 전부 검증한다 — 8명 붙은 뒤에 규칙 버그를 찾으면
   누구 화면이 맞는지부터 다퉈야 한다.

   ── 액션이 하나뿐인 이유 ────────────────────────────────
   집기·놓기·작업을 키 하나로 몰았다. 키가 셋이면 처음 하는 사람이 뭘 눌러야
   할지 매번 생각해야 하는데, 이 게임에서 생각할 것은 "지금 뭘 해야 하나"지
   "무슨 키를 눌러야 하나"가 아니다. 상황이 곧 동작을 정한다.

   ── 손이 비어야만 두드릴 수 있는 이유 ───────────────────
   물건을 든 채로 두드릴 수 있으면 한 사람이 레퍼런스를 들고 모델링대 앞에
   서서 혼자 다 끝낸다. 손을 비워야만 두드릴 수 있어야 "놓고 → 두드리고 →
   집어서 → 옮긴다"가 되고, 그래야 여럿이 나눠 맡을 이유가 생긴다.
   ============================================================ */
(function (global) {
  'use strict';

  var SPEED = 210;        // 초당 디자인 픽셀. 1280 폭을 6초에 가로지른다.
  var REACH = 46;         // 기계에 손이 닿는 거리. 타일(40)보다 조금 커야 답답하지 않다.
  var MAX_ACTS = 8;       // 한 틱에 처리할 액션 상한 (네트워크가 밀렸을 때 폭주 방지)

  var W = null, St = null;
  function deps() {
    if (!W) W = global.World;
    if (!St) St = global.Stations;
  }

  function copyPlayers(src) {
    var o = {}, k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) {
      var p = src[k];
      o[k] = { x: p.x, y: p.y, dir: p.dir, hold: p.hold, tap: p.tap, seq: p.seq };
    }
    return o;
  }

  function copyMachines(src) {
    var o = {}, k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) {
      var m = src[k];
      o[k] = { id: m.id, type: m.type, item: m.item, prog: m.prog };
    }
    return o;
  }

  function create(map, pids) {
    deps();
    var st = {
      t: 0,
      map: map,
      players: {},
      machines: {},
      done: 0,
      goal: St.STAGE1_GOAL
    };
    for (var i = 0; i < map.stations.length; i++) {
      var s = map.stations[i];
      st.machines[s.id] = { id: s.id, type: s.type, item: null, prog: 0 };
    }
    for (var j = 0; j < (pids || []).length; j++) {
      st = join(st, pids[j], j);
    }
    return st;
  }

  function join(state, pid, spawnIndex) {
    deps();
    if (state.players[pid]) return state;          // 이미 있으면 들고 있던 걸 지키지 않는다
    var players = copyPlayers(state.players);
    var sp = state.map.spawns[spawnIndex % state.map.spawns.length] || { x: 100, y: 100 };
    players[pid] = { x: sp.x, y: sp.y, dir: 0, hold: null, tap: 0, seq: 0 };
    return {
      t: state.t, map: state.map, players: players,
      machines: state.machines, done: state.done, goal: state.goal
    };
  }

  function leave(state, pid) {
    var players = copyPlayers(state.players);
    /* 들고 있던 물건은 같이 사라진다. 바닥에 떨구게 하면 "바닥에 놓인 물건"이라는
       개념을 하나 더 만들어야 하는데, 나간 사람 때문에 규칙이 늘 이유가 없다. */
    delete players[pid];
    return {
      t: state.t, map: state.map, players: players,
      machines: state.machines, done: state.done, goal: state.goal
    };
  }

  /* 액션 한 번. state 를 그 자리에서 고친다 — tick 안에서 이미 복사한 뒤라 안전하다. */
  function doAction(state, pid) {
    deps();
    var p = state.players[pid];
    if (!p) return;

    var s = W.nearest(state.map, p.x, p.y, REACH);
    if (!s) return;
    var m = state.machines[s.id];
    if (!m) return;
    var d = St.get(m.type);
    if (!d) return;

    /* 1) 선반에서 새로 든다 */
    if (p.hold === null && d.mode === 'source') { p.hold = d.gives; return; }

    /* 2) 두드린다 — 집기보다 반드시 앞에 와야 한다.
       집기가 먼저면 모델링대에 레퍼런스를 놓고 두드리려 할 때마다 도로 집어
       들게 되어 작업이 영원히 안 된다. canAccept 로 "아직 처리할 수 있는
       물건"일 때만 걸리게 하면, 다 된 하이폴리는 자연히 아래 집기로 넘어간다. */
    if (p.hold === null && d.mode === 'tap' &&
        m.item !== null && St.canAccept(m.type, m.item)) {
      m.prog += 1;
      if (m.prog >= d.work) { m.item = d.gives; m.prog = 0; }
      return;
    }

    /* 3) 기계 위의 물건을 집는다 */
    if (p.hold === null && m.item !== null) {
      p.hold = m.item;
      m.item = null;
      m.prog = 0;
      return;
    }

    /* 4) 납품대·폐기통에 넣는다 */
    if (p.hold !== null && d.mode === 'sink') {
      if (m.type === 'ship' && p.hold === state.goal.need) state.done += 1;
      p.hold = null;
      return;
    }

    /* 5) 빈 기계에 놓는다 */
    if (p.hold !== null && m.item === null && St.canAccept(m.type, p.hold)) {
      m.item = p.hold;
      m.prog = 0;
      p.hold = null;
      return;
    }
  }

  function tick(state, inputs, dt) {
    deps();
    var players = copyPlayers(state.players);
    var machines = copyMachines(state.machines);
    var next = {
      t: state.t + dt, map: state.map, players: players,
      machines: machines, done: state.done, goal: state.goal
    };

    var pid;

    /* 이동 */
    for (pid in players) {
      if (!Object.prototype.hasOwnProperty.call(players, pid)) continue;
      var p = players[pid];
      var inp = (inputs && inputs[pid]) || null;
      var ix = inp ? (inp.x || 0) : 0;
      var iy = inp ? (inp.y || 0) : 0;

      if (ix || iy) {
        /* 대각선이 더 빠르면 다들 대각선으로만 다닌다. 길이를 1 로 맞춘다. */
        var len = Math.sqrt(ix * ix + iy * iy);
        var vx = (ix / len) * SPEED * dt;
        var vy = (iy / len) * SPEED * dt;
        var np = W.move(state.map, p.x, p.y, vx, vy);
        p.x = np.x; p.y = np.y;
        /* 보는 쪽은 더 크게 움직인 축으로 정한다 */
        if (Math.abs(ix) > Math.abs(iy)) p.dir = ix > 0 ? 2 : 1;
        else p.dir = iy > 0 ? 0 : 3;
      }
    }

    /* 액션 — seq 가 늘어난 만큼 처리한다.
       한 번만 처리하면 네트워크가 밀렸을 때 연타가 씹힌다. */
    for (pid in players) {
      if (!Object.prototype.hasOwnProperty.call(players, pid)) continue;
      var inp2 = (inputs && inputs[pid]) || null;
      if (!inp2) continue;
      var want = inp2.seq || 0;
      var have = players[pid].seq || 0;
      var n = want - have;
      if (n <= 0) { players[pid].seq = want; continue; }   // 되감기(재입장 등)도 맞춰 준다
      if (n > MAX_ACTS) n = MAX_ACTS;
      for (var k = 0; k < n; k++) doAction(next, pid);
      players[pid].seq = have + n;
      players[pid].tap = next.t;                            // 그리는 쪽이 "방금 두드렸다"를 안다
    }

    /* 대기형 기계 굴리기 */
    for (var id in machines) {
      if (!Object.prototype.hasOwnProperty.call(machines, id)) continue;
      machines[id] = St.step(machines[id], dt);
    }

    return next;
  }

  global.Sim = {
    SPEED: SPEED,
    REACH: REACH,
    MAX_ACTS: MAX_ACTS,
    create: create,
    join: join,
    leave: leave,
    tick: tick
  };
})(window);
