'use strict';
/* ============================================================
   완주 가능성 검사용 — "닿을 수 있나"가 아니라 "전원이 나갈 수 있나"를
   재는 작은 그래프 탐색기.

   왜 필요한가: 예전 시험은 출입구에 "누군가" 닿을 수 있는지만 봤다.
   그래서 목마(2번 판)에서 받쳐 준 사람이 영원히 못 나가는 것과,
   누가 남을래(3번 판)에서 버튼 누른 사람이 못 나가는 것을 둘 다
   놓쳤다 — 그 버그가 실제로 실려 나갔다. 이 파일은 그 실수를
   반복하지 않으려고 "혼자 서는 자리"(node), "혼자 닿는 높이",
   "업혀서 닿는 높이", "문이 열렸을 때만 생기는 자리"를 실제
   Levels 충돌 코드로 재서 그래프를 만들고, 그 안에서 최단 시간까지 잰다.

   ── 노드 판정을 손으로 다시 안 짜는 이유 ─────────────────
   "이 타일이 벽인가 버튼인가 문인가"를 여기서 또 나열하면 levels.js 가
   바뀔 때마다 여기도 같이 바꿔야 하고, 한쪽만 바뀌면 시험이 거짓 통과를
   준다. 대신 Levels.hits/inGoal/onButton 을 그대로 불러서 "실제로 설
   수 있는 자리인가"를 잰다 — levels.js 의 충돌 코드가 곧 이 시험의
   판정 기준이다.

   ── 점프 간선을 "옆 칸"으로 안 자르는 이유 ────────────────
   1번 판(첫 출근)은 계단식 발판 사이를 가로 3~4칸씩 뛰어 건너도록
   설계돼 있다 — 세로로만 재면(옆 칸까지만 잇는다) 이 판조차 "혼자
   못 깬다"고 오판한다. 그렇다고 "높이만 맞으면 거리 상관없이 잇는다"고
   하면 2번 판의 문 벽처럼 위로 막힌 칸을 뛰어넘어 지나간 것으로
   오판할 수 있다. 그래서 실제 점프 궤적(포물선)을 시간축으로 잘게
   나눠 매 순간 Levels.hits 로 몸이 어디에도 안 박히는지 확인한다 —
   게임이 실제로 허용하는 만큼만 허용하고, 벽은 벽대로 막는다.
   ============================================================ */

/* 이 자리에 실제로 설 수 있나 — 몸이 안 박혀 있고, 1px 더 내리면
   뭔가에 걸린다(허공이 아니라 받쳐주는 게 있다). Levels.hits 를
   그대로 써서 판정을 딱 한 곳(levels.js)에만 둔다. */
function isNode(Levels, lv, doorOpen, cx, sr) {
  if (cx < 0 || cx >= Levels.COLS || sr < 1 || sr >= Levels.ROWS) return false;
  var x = cx * Levels.TILE + (Levels.TILE - Levels.PW) / 2;
  var y = sr * Levels.TILE - Levels.PH;
  if (Levels.hits(lv, x, y, doorOpen)) return false;
  if (!Levels.hits(lv, x, y + 1, doorOpen)) return false;
  return true;
}

function standXY(Levels, cx, sr) {
  return { x: cx * Levels.TILE + (Levels.TILE - Levels.PW) / 2, y: sr * Levels.TILE - Levels.PH };
}

function key(cx, sr) { return cx + ',' + sr; }
function parseKey(k) { var p = k.split(','); return { cx: +p[0], sr: +p[1] }; }

/* 걷기/내려서기 — 옆 칸(가로 1칸)까지만. 여러 칸을 걷는 건 이 간선을
   체인으로 이어서 표현한다(그래야 중간 칸에 실제로 설 자리가 있는지가
   자동으로 검증된다 — 따로 "벽이 있나"를 또 물을 필요가 없다). */
function walkNeighbors(Levels, lv, doorOpen, cx, sr) {
  var out = [];
  for (var dcx = -1; dcx <= 1; dcx++) {
    if (dcx === 0) continue;
    var cx2 = cx + dcx;
    for (var sr2 = 1; sr2 < Levels.ROWS; sr2++) {
      if (sr2 < sr) continue;                 // 위로 가는 건(행 번호가 작아지는 쪽) 점프 쪽에서 다룬다
      if (!isNode(Levels, lv, doorOpen, cx2, sr2)) continue;
      var rise = (sr - sr2) * Levels.TILE;    // 0 이면 같은 높이, 음수면 아래
      var tH = Levels.TILE / 240;             // SPEED 는 호출부에서 넘겨준다(아래 참고)
      out.push({ cx: cx2, sr: sr2, rise: rise, dcx: dcx });
    }
  }
  return out;
}

/* 점프 — 궤적을 잘게 나눠 실제로 안 부딪히는지 확인한다.

   boostUsed: 남의 어깨에서 출발했다고 볼 때만 참(도약 자체의 힘이 아니라
   미리 한 몸 높이를 얹고 시작하는 것이므로, 그만큼은 궤적 계산에서
   '공짜 높이'로 미리 빼 둔다 — 시간·거리 원가는 순수 도약분(aloneRise
   이내)에서만 나온다).

   ── 코요테 타임을 넣는 이유 ────────────────────────────
   sim.js 는 발판을 벗어나고도 COYOTE(0.12초) 동안 점프를 허용한다 —
   실제로 1번 판의 계단(발판 사이 3~4칸 간격)은 발판 끝에서 뛰지 않고
   코요테 동안 조금 더 달려 나간 뒤 뛰어야 다음 발판에 닿는다. 이걸
   안 넣으면 실제로는 되는 점프를 "안 된다"고 오판해서 1번 판조차
   혼자 못 깬다는 거짓 결과가 나온다(실제로 그랬다 — 실제 Sim.tick 으로
   재현해서 확인했다). 대신 그만큼 살짝 떨어진 채로 도약이 시작되므로
   필요한 높이도 그만큼 늘어난다 — 공짜가 아니라 거리와 높이를 맞바꾸는
   것뿐이다. */
/* coyFrac: 코요테를 얼마나 "미리 써서" 발판을 더 달려 나가는가(0~1).
   코요테를 쓰면 거리는 늘지만 그만큼 낮은 데서 뛰는 셈이라 높이가
   줄어든다 — 거저 주는 게 아니라 맞바꾸는 것이다. 필요 없는 점프에서
   무조건 코요테를 끼얹으면 오히려 높이가 모자라 실패로 오판하니,
   호출부(tryJump)가 0부터 1까지 여러 값을 다 시도해서 되는 조합을 찾는다. */
function tryJumpWithCoyote(Levels, Sim, lv, doorOpen, cx1, sr1, cx2, sr2, riseBudget, aloneRise, coyFrac) {
  var rise = (sr1 - sr2) * Levels.TILE;
  if (rise <= 0 || rise > riseBudget) return null;
  var boostUsed = rise > aloneRise;

  var coy = Sim.COYOTE * coyFrac;
  var coyDx = Sim.SPEED * coy;
  var coyDy = 0.5 * Sim.GRAVITY * coy * coy;

  var jumpRise = (boostUsed ? (rise - Levels.PH) : rise) + coyDy;
  if (jumpRise < 0) jumpRise = 0;
  if (jumpRise > aloneRise) return null;            // 코요테를 이만큼 써 버리면 이 조합으론 높이가 안 나온다

  var tUp = Sim.JUMP_V / Sim.GRAVITY;
  var tDown = Math.sqrt(Math.max(0, 2 * (aloneRise - jumpRise) / Sim.GRAVITY));
  var T = tUp + tDown;

  var dxPx = (cx2 - cx1) * Levels.TILE;
  var dir = dxPx === 0 ? 0 : (dxPx > 0 ? 1 : -1);
  /* 노드 위치를 칸 중앙으로 뭉뚱그렸으니(standXY), 출발 칸 안에서도 몸을
     더 앞으로 붙여 설 수 있는 여유(최대 한 칸 가까이)를 더해 준다. 안
     더하면 발판 끝 쪽에 서서 뛰는 정상적인 점프까지 "거리가 모자란다"고
     오판한다 — 1번 판의 계단 점프를 실제 Sim.tick 으로 재현해서 확인했다. */
  var maxDx = Sim.SPEED * T + coyDx + Levels.TILE;
  if (Math.abs(dxPx) > maxDx + 0.5) return null;      // 이 조합으로도 그 거리는 못 간다

  /* 궤적 표본: t=-coy(발판을 막 벗어난 순간)부터 t=T(착지)까지.
     음수 구간은 "아직 점프 입력 전, 그냥 걸어 나가며 떨어지는" 코요테
     구간이고, 0 이후가 실제 도약이다. 업힌 경우 몸이 이미 남의 어깨
     높이(몸 하나 위)에서 시작하므로 launch 를 그만큼 올려서 잰다. */
  var base = standXY(Levels, cx1, sr1);
  var launch = { x: base.x, y: base.y - (boostUsed ? Levels.PH : 0) };
  var steps = Math.max(8, Math.ceil((coy + T) / 0.02));
  for (var s = 1; s < steps; s++) {
    var t = -coy + (coy + T) * s / steps;
    var x, y;
    if (t < 0) {
      var el = t + coy;                               // 코요테 안에서 흐른 시간
      x = launch.x + dir * Sim.SPEED * el;
      y = launch.y + 0.5 * Sim.GRAVITY * el * el;      // 아직 안 눌렀으니 그냥 떨어지는 중
    } else {
      var gained = Sim.JUMP_V * t - 0.5 * Sim.GRAVITY * t * t;
      x = launch.x + dir * coyDx + dir * Sim.SPEED * t;
      y = (launch.y + coyDy) - gained;
    }
    if (Levels.hits(lv, x, y, doorOpen)) return null;  // 궤적 도중 뭔가에 박힌다 — 못 지나간다
  }
  return { time: T + coy, boostUsed: boostUsed };
}

var COYOTE_FRACS = [0, 0.25, 0.5, 0.75, 1];

function tryJump(Levels, Sim, lv, doorOpen, cx1, sr1, cx2, sr2, riseBudget, aloneRise) {
  var best = null;
  for (var i = 0; i < COYOTE_FRACS.length; i++) {
    var r = tryJumpWithCoyote(Levels, Sim, lv, doorOpen, cx1, sr1, cx2, sr2, riseBudget, aloneRise, COYOTE_FRACS[i]);
    if (r && (!best || r.time < best.time)) best = r;
  }
  return best;
}

function edgeList(Levels, Sim, lv, doorOpen, riseBudget, aloneRise, cx, sr) {
  var out = [];
  var w = walkNeighbors(Levels, lv, doorOpen, cx, sr);
  for (var i = 0; i < w.length; i++) {
    var e = w[i];
    var tH = Levels.TILE / Sim.SPEED;
    var tV = e.rise < 0 ? Math.sqrt(2 * (-e.rise) / Sim.GRAVITY) : 0;
    out.push({ cx: e.cx, sr: e.sr, t: Math.max(tH, tV) });
  }
  /* 점프는 판 전체를 후보로 본다(위 설명 참고) — 노드 수가 판 하나에서
     많아야 수백 개라 비싸지 않다. */
  for (var cx2 = 0; cx2 < Levels.COLS; cx2++) {
    for (var sr2 = 1; sr2 < sr; sr2++) {         // 올라가는 것만(내려가는 건 위에서 다뤘다)
      if (!isNode(Levels, lv, doorOpen, cx2, sr2)) continue;
      var j = tryJump(Levels, Sim, lv, doorOpen, cx, sr, cx2, sr2, riseBudget, aloneRise);
      if (j) out.push({ cx: cx2, sr: sr2, t: j.time });
    }
  }
  return out;
}

/* 목표 자리(출입구·버튼)를 실제 게임 판정 함수로 찾는다 — 좌표를 다시
   베끼면 levels.js 와 어긋날 수 있다. */
function goalNodes(Levels, lv, doorOpen) {
  var out = [];
  for (var cx = 0; cx < Levels.COLS; cx++)
    for (var sr = 1; sr < Levels.ROWS; sr++) {
      if (!isNode(Levels, lv, doorOpen, cx, sr)) continue;
      var p = standXY(Levels, cx, sr);
      if (Levels.inGoal(lv, p.x, p.y)) out.push({ cx: cx, sr: sr });
    }
  return out;
}

function buttonNodes(Levels, lv, doorOpen) {
  var out = [];
  for (var cx = 0; cx < Levels.COLS; cx++)
    for (var sr = 1; sr < Levels.ROWS; sr++) {
      if (!isNode(Levels, lv, doorOpen, cx, sr)) continue;
      var p = standXY(Levels, cx, sr);
      if (Levels.onButton(lv, p.x, p.y)) out.push({ cx: cx, sr: sr });
    }
  return out;
}

function spawnNode(Levels, lv, idx) {
  var s = lv.spawns[idx % lv.spawns.length];
  var cx = Math.round((s.x + Levels.PW / 2) / Levels.TILE);
  var sr = Math.round((s.y + Levels.PH) / Levels.TILE);
  return { cx: cx, sr: sr };
}

/* riseBudget 안에서 어디까지 서 볼 수 있나(시간은 안 잰다, 순수 도달성).
   starts 가 여럿이면 그 전부에서 동시 출발한 것으로 본다 — "누군가 이미
   그 자리에 있다"를 표현하는 방법이다. */
function reachable(Levels, Sim, lv, doorOpen, riseBudget, starts) {
  var aloneRise = Sim.JUMP_V * Sim.JUMP_V / (2 * Sim.GRAVITY);
  var seen = {}, stack = [];
  starts.forEach(function (s) {
    if (!isNode(Levels, lv, doorOpen, s.cx, s.sr)) return;
    var k = key(s.cx, s.sr);
    if (!seen[k]) { seen[k] = true; stack.push(s); }
  });
  while (stack.length) {
    var cur = stack.pop();
    var ns = edgeList(Levels, Sim, lv, doorOpen, riseBudget, aloneRise, cur.cx, cur.sr);
    for (var i = 0; i < ns.length; i++) {
      var k = key(ns[i].cx, ns[i].sr);
      if (seen[k]) continue;
      seen[k] = true;
      stack.push(ns[i]);
    }
  }
  return seen;
}

/* start 에서 target(cx,sr 목록) 중 아무 데나 가장 빨리 닿는 시간(초).
   못 가면 Infinity. 다익스트라 — 간선 시간이 서로 달라서 그냥 BFS 로는
   "가장 빠른 길"을 못 구한다. */
function shortestTime(Levels, Sim, lv, doorOpen, riseBudget, start, targets) {
  var aloneRise = Sim.JUMP_V * Sim.JUMP_V / (2 * Sim.GRAVITY);
  var targetSet = {};
  targets.forEach(function (t) { targetSet[key(t.cx, t.sr)] = true; });

  var dist = {}, startKey = key(start.cx, start.sr);
  dist[startKey] = 0;
  var visited = {};
  /* 노드 수가 최대 몇백 개라 우선순위 큐 없이 선형 탐색으로도 충분하다. */
  for (;;) {
    var uKey = null, uDist = Infinity;
    for (var k in dist) {
      if (visited[k]) continue;
      if (dist[k] < uDist) { uDist = dist[k]; uKey = k; }
    }
    if (uKey === null) break;
    visited[uKey] = true;
    if (targetSet[uKey]) return uDist;
    var uNode = parseKey(uKey);
    var ns = edgeList(Levels, Sim, lv, doorOpen, riseBudget, aloneRise, uNode.cx, uNode.sr);
    for (var i = 0; i < ns.length; i++) {
      var nk = key(ns[i].cx, ns[i].sr);
      var nd = uDist + ns[i].t;
      if (dist[nk] === undefined || nd < dist[nk]) dist[nk] = nd;
    }
  }
  return Infinity;
}

/* shortestTime 과 같은 다익스트라인데 경로도 남긴다 — 검증 스크립트가
   "어디를 거쳐 가는지" 알아야 실제 입력(좌우·점프)을 흉내 낼 수 있다.
   시험 판정에는 안 쓴다(시험은 시간/도달성만 본다), 헤드리스 플레이
   스크립트 전용. */
function shortestPath(Levels, Sim, lv, doorOpen, riseBudget, start, targets) {
  var aloneRise = Sim.JUMP_V * Sim.JUMP_V / (2 * Sim.GRAVITY);
  var targetSet = {};
  targets.forEach(function (t) { targetSet[key(t.cx, t.sr)] = true; });

  var dist = {}, prev = {}, startKey = key(start.cx, start.sr);
  dist[startKey] = 0;
  var visited = {};
  for (;;) {
    var uKey = null, uDist = Infinity;
    for (var k in dist) {
      if (visited[k]) continue;
      if (dist[k] < uDist) { uDist = dist[k]; uKey = k; }
    }
    if (uKey === null) break;
    visited[uKey] = true;
    if (targetSet[uKey]) {
      var path = [parseKey(uKey)], ck = uKey;
      while (prev[ck]) { ck = prev[ck]; path.unshift(parseKey(ck)); }
      return { time: uDist, path: path };
    }
    var uNode = parseKey(uKey);
    var ns = edgeList(Levels, Sim, lv, doorOpen, riseBudget, aloneRise, uNode.cx, uNode.sr);
    for (var i = 0; i < ns.length; i++) {
      var nk = key(ns[i].cx, ns[i].sr);
      var nd = uDist + ns[i].t;
      if (dist[nk] === undefined || nd < dist[nk]) { dist[nk] = nd; prev[nk] = uKey; }
    }
  }
  return null;
}

/* ============================================================
   "닿을 수 있나"가 아니라 "전원이 나갈 수 있나".

   업힌 사람만 닿는 이야기가 아니다 — 업어 준 사람(마지막 사람, 밟고 설
   사람이 없다)도 결국 나가야 한다. 그래서 순서를 이렇게 둔다:
     1. 애초에 혼자(aloneRise) 닿으면 그걸로 끝 — 아무도 안 남는다.
     2. 아니면 버튼이 있어야 하고, 그 버튼은 업혀서라도(boostRise) 눌러야
        한다 — 업을 사람도 없이 저절로 열리면 이 판의 협동이 사라진다.
     3. 버튼을 눌러 문이 열린 뒤에는, 스폰(=한 번도 업힌 적 없는, 즉
        "마지막 사람"이 서 있을 법한 자리)에서 다시 혼자(aloneRise)
        만으로 출입구에 닿아야 한다 — 문이 열려도 여전히 업혀야만
        갈 수 있으면, 업어 줄 사람이 없는 마지막 사람은 여전히 못 나간다.
   세 번째가 이 검사의 핵심이다 — 목마(2번 판)에서 놓쳤던 바로 그 지점. */
function everyoneCanFinish(Levels, Sim, lv) {
  var aloneRise = Sim.JUMP_V * Sim.JUMP_V / (2 * Sim.GRAVITY);
  var boostRise = aloneRise + Levels.PH;
  var start = spawnNode(Levels, lv, 0);

  var soloClosed = reachable(Levels, Sim, lv, false, aloneRise, [start]);
  var goalsClosed = goalNodes(Levels, lv, false);
  if (goalsClosed.some(function (g) { return soloClosed[key(g.cx, g.sr)]; })) {
    return { ok: true, reason: '혼자서도 닿는다' };
  }

  var buttons = buttonNodes(Levels, lv, false);
  if (!buttons.length) return { ok: false, reason: '혼자 못 닿는데 버튼도 없다' };

  var boostClosed = reachable(Levels, Sim, lv, false, boostRise, [start]);
  var buttonBoostable = buttons.some(function (b) { return boostClosed[key(b.cx, b.sr)]; });
  if (!buttonBoostable) return { ok: false, reason: '업혀서도 버튼에 못 닿는다' };

  var soloOpen = reachable(Levels, Sim, lv, true, aloneRise, [start]);
  var goalsOpen = goalNodes(Levels, lv, true);
  var lastCanLeave = goalsOpen.some(function (g) { return soloOpen[key(g.cx, g.sr)]; });
  if (!lastCanLeave) return { ok: false, reason: '문이 열려도 업히지 않고는(스폰에서) 못 간다 — 마지막 사람이 못 나간다' };

  return { ok: true, reason: '업어서 버튼을 누르면, 그 뒤엔 아무도 안 업혀도 나간다' };
}

module.exports = {
  isNode: isNode, standXY: standXY, key: key,
  spawnNode: spawnNode, goalNodes: goalNodes, buttonNodes: buttonNodes,
  reachable: reachable, shortestTime: shortestTime, shortestPath: shortestPath,
  everyoneCanFinish: everyoneCanFinish
};
