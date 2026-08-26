/* ============================================================
   오버워크드 — 맵과 충돌

   좌표계는 1280x720 디자인 픽셀로 고정한다. 화면이 얼마든 게임 로직은
   항상 이 좌표를 쓰고, 스케일은 그리기 직전에만 건다. 이래야 사람마다
   창 크기가 달라도 같은 판을 본다.

   타일 40px, 플레이어 반지름 14px. 반지름이 타일 절반(20)보다 작아야
   한 칸짜리 통로를 지날 수 있다.

   ── 미끄러짐에 대해 ────────────────────────────────────
   벽에 부딪혔을 때 딱 멈추면 조작이 답답해서 못 한다. 8명이 좁은 통로에서
   엉키는 게임이라 벽을 따라 흘러야 한다. 그래서 x 와 y 를 따로 밀어 보고
   막힌 축만 버린다. 축 분리는 가장 싼 방법이면서 이 게임엔 충분하다.
   ============================================================ */
(function (global) {
  'use strict';

  var W = 1280, H = 720, TILE = 40, R = 14;
  var COLS = W / TILE;          // 32
  var ROWS = H / TILE;          // 18

  function tileAt(map, x, y) {
    var cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
    if (cx < 0 || cy < 0 || cx >= map.cols || cy >= map.rows) return '#';   // 맵 밖은 벽
    return map.grid[cy * map.cols + cx];
  }

  function solidAt(map, x, y) {
    var t = tileAt(map, x, y);
    return t === '#' || t === 'S';
  }

  /* 반지름 R 인 원이 (x,y) 에 있을 때 겹치는 칸이 있는가.
     원의 네 극점만 본다 — 타일이 반지름보다 크므로 이걸로 충분하다. */
  function blocked(map, x, y) {
    return solidAt(map, x - R, y) || solidAt(map, x + R, y) ||
           solidAt(map, x, y - R) || solidAt(map, x, y + R) ||
           solidAt(map, x - R * 0.7, y - R * 0.7) || solidAt(map, x + R * 0.7, y - R * 0.7) ||
           solidAt(map, x - R * 0.7, y + R * 0.7) || solidAt(map, x + R * 0.7, y + R * 0.7);
  }

  /* 한 축을 밀어 본다. 막히면 벽에 딱 붙는 자리까지만 간다.
     이분 탐색을 쓰는 이유: 한 프레임에 여러 칸을 건너뛸 만큼 빠를 때도
     벽을 통과하지 않게 하려면 "얼마나 갈 수 있나"를 찾아야 한다. */
  function slide(map, x, y, dx, dy) {
    var nx = x + dx, ny = y + dy;
    if (!blocked(map, nx, ny)) return { x: nx, y: ny };

    var lo = 0, hi = 1;
    for (var i = 0; i < 12; i++) {
      var mid = (lo + hi) / 2;
      if (blocked(map, x + dx * mid, y + dy * mid)) hi = mid; else lo = mid;
    }
    return { x: x + dx * lo, y: y + dy * lo };
  }

  function move(map, x, y, dx, dy) {
    var p = { x: x, y: y };
    if (dx) p = slide(map, p.x, p.y, dx, 0);
    if (dy) p = slide(map, p.x, p.y, 0, dy);
    return p;
  }

  function nearest(map, x, y, maxDist) {
    var best = null, bd = maxDist * maxDist;
    for (var i = 0; i < map.stations.length; i++) {
      var s = map.stations[i];
      var ddx = s.cx - x, ddy = s.cy - y;
      var d = ddx * ddx + ddy * ddy;
      if (d <= bd) { bd = d; best = s; }
    }
    return best;
  }

  /* ---------- 1스테이지: 인턴의 첫 발주 ----------
     32x18 칸. 가운데 섬이 하나 있어 8명이 한 줄로 몰리지 않고 갈라진다.
     기계는 벽에 붙여 두고 앞칸을 비워, 서는 자리가 통로를 막지 않게 한다.

     . 바닥   # 벽   S 작업대(막힘)                                        */
  var G1 = [
    '################################',
    '#..............................#',
    '#..SS......................SS..#',
    '#..............................#',
    '#..............................#',
    '#........####........####......#',
    '#........#..#........#..#......#',
    '#........####........####......#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#........####........####......#',
    '#........#..#........#..#......#',
    '#........####........####......#',
    '#..............................#',
    '#..SS......................SS..#',
    '#..............................#',
    '################################'
  ];

  function buildStage1() {
    var grid = G1.join('').split('');
    var map = { cols: COLS, rows: ROWS, grid: grid, spawns: [], stations: [] };

    /* 기계 자리는 위에서 'SS' 로 찍어 둔 네 곳이다. 좌표는 그 두 칸의 가운데. */
    map.stations = [
      { id: 'ref1',    type: 'ref',    cx: 4 * TILE + TILE / 2,  cy: 2 * TILE + TILE / 2 },
      { id: 'model1',  type: 'model',  cx: 28 * TILE - TILE / 2, cy: 2 * TILE + TILE / 2 },
      { id: 'retopo1', type: 'retopo', cx: 4 * TILE + TILE / 2,  cy: 15 * TILE + TILE / 2 },
      { id: 'ship1',   type: 'ship',   cx: 28 * TILE - TILE / 2, cy: 15 * TILE + TILE / 2 }
    ];

    /* 폐기통은 가운데 섬 옆 바닥에 둔다. 벽이 아니라 바닥 위 물건이라
       지나갈 수 있다 — 통로 한가운데 막힌 걸 두면 8명이 엉킨다. */
    map.stations.push({ id: 'bin1', type: 'bin', cx: 16 * TILE, cy: 9 * TILE + TILE / 2 });

    /* 스폰 8개 — 가운데 열린 띠(9~10행)에 좌우로 흩는다 */
    for (var i = 0; i < 8; i++) {
      map.spawns.push({
        x: (5 + i * 3) * TILE + TILE / 2,
        y: (i % 2 === 0 ? 9 : 10) * TILE + TILE / 2
      });
    }
    return map;
  }

  global.World = {
    W: W, H: H, TILE: TILE, R: R, COLS: COLS, ROWS: ROWS,
    solidAt: solidAt,
    blocked: blocked,
    move: move,
    nearest: nearest,
    STAGE1: buildStage1()
  };
})(window);
