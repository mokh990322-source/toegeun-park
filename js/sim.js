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
      /* machines 도 복사한다 — tick 은 이미 그렇게 하는데 join/leave 만 참조로
         넘기면 "이 함수들은 원본을 고치지 않는다"는 계약이 셋 중 둘에서만
         참이 된다. 지금 당장은 이 함수들이 machines 를 안 건드리니 티가
         안 나지만, 나중에 누가 next.machines 를 그 자리에서 고치는 코드를
         하나라도 여기 추가하면 state.machines 까지 같이 망가진다. */
      t: state.t, map: state.map, players: players,
      machines: copyMachines(state.machines), done: state.done, goal: state.goal
    };
  }

  function leave(state, pid) {
    var players = copyPlayers(state.players);
    /* 들고 있던 물건은 같이 사라진다. 바닥에 떨구게 하면 "바닥에 놓인 물건"이라는
       개념을 하나 더 만들어야 하는데, 나간 사람 때문에 규칙이 늘 이유가 없다. */
    delete players[pid];
    return {
      t: state.t, map: state.map, players: players,
      machines: copyMachines(state.machines), done: state.done, goal: state.goal
    };
  }

  /* 호스트 승계 직후 딱 한 번 호출한다.
     Snap 은 seq 를 담지 않는다(전송량 때문에 의도적으로 뺐다 — snap.js 참고).
     그래서 스냅샷을 이어받은 새 호스트의 players[].seq 는 전부 0 이다. 그대로
     tick 을 돌리면 각 플레이어가 매치 내내 보낸 입력 전체를 "새 액션"으로
     오인해 그 자리에서 재생해 버린다 — 진행 중이던 작업이 순간 완성되고,
     들고 있던 물건이 옆 기계로 빨려 들어가는 식의 치명적 버그(C1)다.
     그래서 승계 시점에 각 플레이어의 seq 를 "그 사람의 현재 입력이 말하는
     값"으로 맞춰 둔다 — 입력이 아직 없으면 0. 이러면 다음 tick 에서
     want - have 가 0이 되어 아무것도 재생되지 않고, 그 이후의 진짜 새 입력만
     정상적으로 처리된다. */
  function adopt(state, inputs) {
    var players = copyPlayers(state.players), pid;
    for (pid in players) {
      if (!Object.prototype.hasOwnProperty.call(players, pid)) continue;
      var inp = (inputs && inputs[pid]) || null;
      players[pid].seq = inp ? (inp.seq || 0) : 0;
    }
    return {
      t: state.t, map: state.map, players: players,
      machines: copyMachines(state.machines), done: state.done, goal: state.goal
    };
  }

  /* 이동이 끝난 뒤 겹친 플레이어 쌍을 밀어 떼어 놓는다.
     디자인 스펙 4.3 — "통로가 좁다, 서로 길을 막는다"가 이 게임 웃음의
     절반이다. 다들 같은 칸에 설 수 있으면 8명이 기계 하나에 몰려도
     아무 문제가 안 생기고, 그러면 애초에 8명일 이유가 없다.

     ── 왜 절반씩 미는가 ──────────────────────────────────
     한쪽만 밀면 pid 정렬에서 먼저 오는 사람이 항상 상대를 떠미는 쪽이
     된다. 매 틱 그 순서가 똑같으니 특정 플레이어가 구조적으로 유리해져
     "밀리는 사람"이 고정된다. 절반씩 나눠 밀면 둘 다 똑같이 움직이고
     결과가 어느 쪽 pid 가 더 빠른지에 좌우되지 않는다.

     ── 왜 3번만 도는가 ──────────────────────────────────
     8명이 구석에 처박히면 한 번의 쌍별 이동으로는 다 안 풀린다(민 자리에
     또 다른 사람이 있을 수 있으니까). 그렇다고 수렴할 때까지 돌면, 벽과
     사람 사이에 낀 경우 "밀었다 막혔다"를 반복하며 끝나지 않을 수 있다.
     3번이면 화면상 충분히 벌어지고, 어차피 다음 틱에도 또 돌기 때문에
     한 틱 안에서 완벽히 풀 필요가 없다.

     ── 왜 정렬된 pid 순서인가 ────────────────────────────
     object 의 for-in 순서는 키를 어떤 순서로 넣었는지에 따라 달라질 수
     있다(숫자형 키는 특히). 순서가 곧 "누가 누구를 미는가"를 정하는
     이 로직에서, 순서가 안 정해지면 같은 상황도 리플레이마다 다르게
     풀려 호스트마다 화면이 어긋난다. 매번 sort() 로 고정한다.

     ── 왜 벽으로 미는 걸 거부하는가 ──────────────────────
     겹친 두 사람 중 하나가 벽에 붙어 있으면, 미는 방향이 벽 쪽을 향할
     수 있다. 그 이동을 그대로 허용하면 반지름 판정을 건너뛰고 벽 안으로
     들어가 버린다(터널링) — 사람끼리 잠깐 겹쳐 보이는 것보다 훨씬 나쁜
     버그다. 목적지가 blocked 면 그 사람은 그 자리에 머물고, 상대만
     (막히지 않았다면) 움직인다. */
  function pushApart(map, players, pids) {
    var PASSES = 3;
    var minDist = 2 * W.R;

    for (var pass = 0; pass < PASSES; pass++) {
      for (var i = 0; i < pids.length; i++) {
        var a = players[pids[i]];
        if (!a) continue;
        for (var j = i + 1; j < pids.length; j++) {
          var b = players[pids[j]];
          if (!b) continue;

          var dx = b.x - a.x, dy = b.y - a.y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= minDist) continue;

          var nx, ny;
          if (dist < 1e-6) {
            /* 완전히 같은 자리라 밀 방향이 안 나온다. 여기서 무작위로
               고르면 같은 상황이 재생마다 다르게 풀려 리플레이가 어긋난다.
               pids 는 이미 정렬돼 있으므로(i < j) 그 순서 자체를 고정된
               방향으로 삼는다 — 항상 뒤 pid 를 +x 로 보낸다. */
            nx = 1; ny = 0;
          } else {
            nx = dx / dist; ny = dy / dist;
          }

          var half = (minDist - dist) / 2;
          var ax = a.x - nx * half, ay = a.y - ny * half;
          var bx = b.x + nx * half, by = b.y + ny * half;

          if (!W.blocked(map, ax, ay)) { a.x = ax; a.y = ay; }
          if (!W.blocked(map, bx, by)) { b.x = bx; b.y = by; }
        }
      }
    }
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

    /* 겹침 풀기 — 반드시 이동 다음, 액션 앞이다. 액션은 지금 위치로 사거리를
       재기 때문에, 밀려난 뒤의 자리로 판정해야 "밀렸더니 갑자기 기계에
       안 닿는다" 같은 어긋남이 안 생긴다. */
    pushApart(state.map, players, Object.keys(players).sort());

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
    adopt: adopt,
    tick: tick
  };
})(window);
