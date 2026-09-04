/* ============================================================
   모코파크 — 격자 위의 충돌과 이동

   판을 "글자가 박힌 격자"로 보고, 몸통 상자 하나를 그 위에서 움직인다.
   판이 몇 개인지, 누가 서 있는지, 지금 몇 라운드인지 모른다 —
   격자와 상자만 안다. 그래서 Node 에서 통째로 검증된다.

   levels.js 에서 떼어냈다. 판이 스물이 되면 데이터만으로도 파일이 꽉 차서,
   같은 파일에 수학까지 있으면 둘 다 안 읽힌다.

   ── 몸통이 28x36 인 이유 ────────────────────────────────
   한 칸이 40 이다. 가로가 한 칸보다 좁아야 한 칸 통로를 지나고,
   세로가 두 칸보다 낮아야 한 칸 턱에 안 걸린다.

   ── 왜 이분 탐색으로 미는가 ─────────────────────────────
   낙하 최고속도면 한 프레임에 20px 를 간다. "다음 자리가 벽인가"만 보면
   빠를 때 벽을 뚫는다. 갈 수 있는 만큼을 찾아 벽에 딱 붙인다.

   ── 움직이는 발판은 타일이 아니다 ───────────────────────
   움직이니까 격자 칸에 못 담는다. 판 데이터에 따로 적고, 위치는 라운드
   시각(rt)만으로 정해진다 — 그래서 스냅샷에 실을 것이 하나도 없고,
   호스트가 바뀌어도 발판이 튀지 않는다. 삼각파를 쓰는 이유는 속도가
   일정해야 사람이 타이밍을 배울 수 있어서다. 사인파는 끝에서 느려져
   "언제 뛰어야 하는지"가 매번 달라진다.
   ============================================================ */
(function (global) {
  'use strict';

  var T = null;
  function deps() { if (!T) T = global.Tiles; }

  var W = 1280, H = 720, TILE = 40;
  var COLS = W / TILE, ROWS = H / TILE;      // 32 x 18
  var PW = 28, PH = 36;                      // 플레이어 몸통

  var MOVER_H = 12;                          // 움직이는 발판 두께

  function at(lv, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return '#';   // 맵 밖은 벽
    return lv.grid[cy * COLS + cx];
  }

  function solid(lv, cx, cy, env) {
    deps();
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return true;
    return T.solid(lv.grid[cy * COLS + cx], cy, cy * COLS + cx, env || {});
  }

  /* 몸통(왼쪽 위 x,y)이 딱딱한 칸과 겹치는가.
     양 끝을 아주 조금 안쪽으로 당겨서 본다 — 정확히 칸 경계에 맞닿았을 때
     옆 칸까지 막힌 것으로 세면 통로에 끼어 못 지나간다. */
  function hits(lv, x, y, env) {
    var e = 0.001;
    var x0 = Math.floor((x + e) / TILE), x1 = Math.floor((x + PW - e) / TILE);
    var y0 = Math.floor((y + e) / TILE), y1 = Math.floor((y + PH - e) / TILE);
    for (var cy = y0; cy <= y1; cy++)
      for (var cx = x0; cx <= x1; cx++)
        if (solid(lv, cx, cy, env)) return true;
    return false;
  }

  function slide(lv, x, y, dx, dy, env) {
    var nx = x + dx, ny = y + dy;
    if (!hits(lv, nx, ny, env)) return { v: dx ? nx : ny, hit: false };
    var lo = 0, hi = 1;
    for (var i = 0; i < 14; i++) {
      var mid = (lo + hi) / 2;
      if (hits(lv, x + dx * mid, y + dy * mid, env)) hi = mid; else lo = mid;
    }
    return { v: dx ? (x + dx * lo) : (y + dy * lo), hit: true };
  }

  /* 안 움직이면 여기서 끝낸다. slide 에 0 을 넘기면 어느 축을 밀던 중인지
     알 수 없어 엉뚱한 축의 값을 돌려주게 된다 — 실제로 그 사고가 났었다. */
  function moveX(lv, x, y, dx, env) {
    if (!dx) return { x: x, hit: false };
    /* 일방통행 발판은 가로로는 절대 안 막는다 */
    var e2 = withOneway(env, false, 0);
    var r = slide(lv, x, y, dx, 0, e2);
    return { x: r.v, hit: r.hit };
  }

  function moveY(lv, x, y, dy, env) {
    if (!dy) return { y: y, hit: false };
    /* 내려가는 중이고, 움직이기 전 발바닥이 발판 윗면보다 위였을 때만
       일방통행 발판이 딱딱하다. 한 번의 이동 내내 고정된 판단이라
       이분 탐색 도중에 뒤집히지 않는다. */
    var e2 = withOneway(env, dy > 0, y + PH);
    var r = slide(lv, x, y, 0, dy, e2);
    return { y: r.v, hit: r.hit };
  }

  function withOneway(env, down, feet) {
    var o = { door: false, cr: null, ow: { down: down, feet: feet } };
    if (env) { o.door = !!env.door; o.cr = env.cr || null; }
    return o;
  }

  /* 발밑 한 줄의 칸들. 버튼·미는 바닥·부서지는 발판이 전부 이걸 쓴다 —
     "무엇을 딛고 있나"를 묻는 자리가 하나여야 규칙이 안 갈린다. */
  function footTiles(lv, x, y) {
    var out = [];
    var fy = Math.floor((y + PH + 1) / TILE);
    if (fy < 0 || fy >= ROWS) return out;
    var x0 = Math.floor((x + 1) / TILE), x1 = Math.floor((x + PW - 1) / TILE);
    for (var cx = x0; cx <= x1; cx++) {
      if (cx < 0 || cx >= COLS) continue;
      out.push({ cx: cx, cy: fy, idx: fy * COLS + cx, t: lv.grid[fy * COLS + cx] });
    }
    return out;
  }

  function onButton(lv, x, y) {
    deps();
    var f = footTiles(lv, x, y);
    for (var i = 0; i < f.length; i++) if (f[i].t === T.BUTTON) return true;
    return false;
  }

  /* 딛고 선 바닥이 미는 방향. 여러 칸에 걸쳐 있으면 서로 상쇄된다 —
     반대 방향 두 칸에 걸쳐 서면 안 밀리는 게 눈에 자연스럽다. */
  function pushOf(lv, x, y) {
    deps();
    var f = footTiles(lv, x, y), d = 0;
    for (var i = 0; i < f.length; i++) d += T.pushDir(f[i].t);
    return d === 0 ? 0 : (d > 0 ? 1 : -1);
  }

  /* 몸통이 지금 위험한 칸에 겹쳐 있는가 */
  function inHazard(lv, x, y, blink) {
    deps();
    var e = 0.001;
    /* 가시는 칸을 꽉 채우지 않는다. 몸통을 조금 줄여서 봐야 "스칠 뻔했다"가
       죽음이 되지 않는다 — 억울한 죽음은 협동 게임에서 제일 나쁘다. */
    var m = 6;
    var x0 = Math.floor((x + m) / TILE), x1 = Math.floor((x + PW - m - e) / TILE);
    var y0 = Math.floor((y + m) / TILE), y1 = Math.floor((y + PH - m - e) / TILE);
    for (var cy = y0; cy <= y1; cy++) {
      if (cy < 0 || cy >= ROWS) continue;
      for (var cx = x0; cx <= x1; cx++) {
        if (cx < 0 || cx >= COLS) continue;
        if (T.hazard(lv.grid[cy * COLS + cx], blink)) return true;
      }
    }
    return false;
  }

  function inGoal(lv, x, y) {
    var g = lv.goal;
    return x + PW > g.x && x < g.x + g.w && y + PH > g.y && y < g.y + g.h;
  }

  /* ---------- 움직이는 발판 ----------
     m = { x, y, w, dx, dy, period, phase }
     (x,y) 는 출발 자리(픽셀), (dx,dy) 는 왕복 거리, period 는 한 번 왕복하는 데
     걸리는 시간. phase 는 0~1 로 출발 위상을 어긋나게 둘 때 쓴다. */

  function tri(u) {
    u = u - Math.floor(u);
    return u < 0.5 ? u * 2 : 2 - u * 2;
  }

  function moverAt(m, rt) {
    var p = m.period || 4;
    var s = tri(rt / p + (m.phase || 0));
    return { x: m.x + (m.dx || 0) * s, y: m.y + (m.dy || 0) * s,
             w: (m.w || 2) * TILE, h: MOVER_H };
  }

  /* 지금 이 순간의 속도(초당 픽셀). 발판에 올라선 사람을 같이 옮기는 데 쓴다.
     삼각파라 방향만 바뀌고 크기는 늘 같다. */
  function moverVel(m, rt) {
    var p = m.period || 4;
    var u = (rt / p + (m.phase || 0));
    u = u - Math.floor(u);
    var sign = u < 0.5 ? 1 : -1;
    var k = 2 * sign / p;
    return { vx: (m.dx || 0) * k, vy: (m.dy || 0) * k };
  }

  global.Grid = {
    W: W, H: H, TILE: TILE, COLS: COLS, ROWS: ROWS, PW: PW, PH: PH,
    MOVER_H: MOVER_H,
    at: at, solid: solid, hits: hits, slide: slide,
    moveX: moveX, moveY: moveY,
    footTiles: footTiles, onButton: onButton, pushOf: pushOf,
    inHazard: inHazard, inGoal: inGoal,
    tri: tri, moverAt: moverAt, moverVel: moverVel
  };
})(window);
