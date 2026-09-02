# 퇴근파크 1단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 2~8명이 방 코드로 모여, 옆에서 보는 플랫폼 판에서 서로의 머리를 밟아 다리를 만들고 버튼을 눌러 문을 열고 **전원이 출입구에 도착해** 판을 깬다.

**Architecture:** 호스트 권위 방식은 그대로. 게임만 탑다운 오버쿡드에서 사이드뷰 플랫폼으로 바꾼다. `net.js` `room.js` `interp.js` 는 한 줄도 안 고친다.

**Tech Stack:** Canvas2D, 외부 라이브러리 0개, 클래식 `<script>`, Node 24 내장 테스트 러너.

## Global Constraints

- 외부 라이브러리 0개. ES 모듈 금지 — `(function (global) { 'use strict'; ... })(window);`
- 디자인 좌표계 고정 **1280×720**. 판 하나가 정확히 한 화면 — 카메라도 스크롤도 없다.
- 타일 **40px** (32×18칸). 플레이어 몸통 **28×36**.
- `sim.js` 는 네트워크·캔버스·DOM 을 모른다. `view.js` 는 판정을 하지 않는다. `net.js` 는 게임을 모른다.
- `tick`/`join`/`leave`/`adopt` 는 인자를 그 자리에서 고치지 않는다.
- 스냅샷은 항상 전체, 델타 금지. 좌표는 정수로.
- 플레이어 순회는 **pid 정렬 순서**. 안 그러면 사람마다 다른 결과를 본다.
- 주석은 한국어, WHY not WHAT. 커밋 메시지는 한국어 + `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- 테스트: `node --test` (인자 없이). 기존 143개 중 `stations`/`world`/`sim` 테스트는 이 계획에서 대체된다.

## 이 계획의 핵심 규칙 — 어기면 게임이 안 된다

**남을 밟고 있는 동안에는 클라이언트가 예측하지 않는다.** 내 화면 속 남은 150ms 과거라,
그 사람을 발판 삼아 예측하면 매번 어긋나 "분명 밟았는데 떨어졌다"가 반복된다.
그래서 `sim` 이 플레이어마다 **무엇에 받쳐져 있는지(`sup`)** 를 기록하고 스냅샷에 실어,
클라이언트가 `sup === 2`(남을 밟음)일 때 예측을 끄게 한다.

---

### Task 1: 판 데이터와 타일 충돌 (`levels.js`)

`world.js` 를 대체한다. 사이드뷰 타일 맵 3개와, AABB 몸통이 타일에 부딪히는 판정.

**Files:** Create `js/levels.js`, `test/levels.test.js`. Delete `js/world.js`, `test/world.test.js`, `js/stations.js`, `test/stations.test.js`.

**Interfaces:**
- `Levels.W`=1280 `H`=720 `TILE`=40 `COLS`=32 `ROWS`=18
- `Levels.PW`=28 `PH`=36 (플레이어 몸통)
- `Levels.LIST` → 판 배열. 각 판 `{ name, grid, spawns, goal:{x,y,w,h} }`
  - `grid`: 길이 576 문자 배열. `.`빈칸 `#`벽 `B`버튼 `D`문 `G`출입구
  - `spawns`: `[{x,y}, ...]` 8개 (몸통 왼쪽 위 기준)
- `Levels.at(lv, cx, cy)` → 타일 글자. 맵 밖은 `'#'`
- `Levels.solid(lv, cx, cy, doorOpen)` → boolean. `D`는 `doorOpen`이면 통과
- `Levels.hits(lv, x, y, doorOpen)` → boolean. `x,y`는 몸통 왼쪽 위. 겹치는 칸이 하나라도 막혔나
- `Levels.moveX(lv, x, y, dx, doorOpen)` → `{x, hit}` — 가로로 밀되 벽에 붙여 세운다
- `Levels.moveY(lv, x, y, dy, doorOpen)` → `{y, hit}` — 세로로 같게
- `Levels.onButton(lv, x, y)` → boolean. 몸통 바로 아래 칸이 `B` 인가
- `Levels.inGoal(lv, x, y)` → boolean

- [ ] **Step 1: 테스트를 쓴다**

`test/levels.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function L() { return load('levels').Levels; }

test('상수와 판 개수', () => {
  const V = L();
  assert.strictEqual(V.W, 1280); assert.strictEqual(V.H, 720);
  assert.strictEqual(V.TILE, 40); assert.strictEqual(V.COLS, 32); assert.strictEqual(V.ROWS, 18);
  assert.ok(V.PW > 0 && V.PW < V.TILE, '몸통 너비가 한 칸보다 좁아야 통로를 지난다');
  assert.ok(V.PH > 0 && V.PH < V.TILE * 2);
  assert.strictEqual(V.LIST.length, 3);
});

test('판마다 격자가 맞고 필요한 칸이 있다', () => {
  const V = L();
  V.LIST.forEach(function (lv, i) {
    assert.strictEqual(lv.grid.length, V.COLS * V.ROWS, i + '번 판 격자 크기');
    assert.ok(lv.name && lv.name.length, i + '번 판 이름');
    assert.strictEqual(lv.spawns.length, 8, i + '번 판 스폰 8개');
    assert.ok(lv.grid.indexOf('G') >= 0, i + '번 판에 출입구가 없다');
  });
});

test('스폰은 벽 안이 아니고 서로 안 겹친다', () => {
  const V = L();
  V.LIST.forEach(function (lv, i) {
    lv.spawns.forEach(function (s, j) {
      assert.strictEqual(V.hits(lv, s.x, s.y, false), false, i + '번 판 ' + j + '번 스폰이 벽 안');
    });
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
      const p = lv.spawns[a], q = lv.spawns[b];
      const apart = (p.x + V.PW <= q.x) || (q.x + V.PW <= p.x) ||
                    (p.y + V.PH <= q.y) || (q.y + V.PH <= p.y);
      assert.ok(apart, i + '번 판 스폰 ' + a + ',' + b + ' 가 겹친다');
    }
  });
});

test('맵 밖은 벽이다', () => {
  const V = L(), lv = V.LIST[0];
  assert.strictEqual(V.at(lv, -1, 5), '#');
  assert.strictEqual(V.at(lv, 999, 5), '#');
  assert.strictEqual(V.at(lv, 5, -1), '#');
  assert.strictEqual(V.at(lv, 5, 999), '#');
});

test('문은 열렸을 때만 지나갈 수 있다', () => {
  const V = L();
  const lv = V.LIST.find(function (x) { return x.grid.indexOf('D') >= 0; });
  assert.ok(lv, '문이 있는 판이 하나는 있어야 한다');
  const i = lv.grid.indexOf('D');
  const cx = i % V.COLS, cy = Math.floor(i / V.COLS);
  assert.strictEqual(V.solid(lv, cx, cy, false), true, '닫혔으면 막힌다');
  assert.strictEqual(V.solid(lv, cx, cy, true), false, '열렸으면 통과');
});

test('moveX 는 벽에 붙여 세운다', () => {
  const V = L(), lv = V.LIST[0];
  const y = 40;                                   // 위쪽 빈 곳
  const out = V.moveX(lv, 40, y, -500, false);
  assert.strictEqual(out.hit, true);
  assert.ok(out.x >= 40 - 0.5, '왼쪽 벽(x=40) 안으로 들어가면 안 된다: ' + out.x);
  assert.strictEqual(V.hits(lv, out.x, y, false), false);
});

test('moveX 는 빈 곳에서 그대로 간다', () => {
  const V = L(), lv = V.LIST[0];
  const out = V.moveX(lv, 200, 40, 30, false);
  assert.strictEqual(out.hit, false);
  assert.strictEqual(out.x, 230);
});

test('moveY 는 큰 dy 에도 바닥을 뚫지 않는다', () => {
  const V = L(), lv = V.LIST[0];
  const out = V.moveY(lv, 200, 40, 5000, false);
  assert.strictEqual(out.hit, true);
  assert.strictEqual(V.hits(lv, 200, out.y, false), false, '벽 안에서 멈추면 안 된다');
});

test('onButton 은 발밑 칸을 본다', () => {
  const V = L();
  const lv = V.LIST.find(function (x) { return x.grid.indexOf('B') >= 0; });
  assert.ok(lv, '버튼이 있는 판이 하나는 있어야 한다');
  const i = lv.grid.indexOf('B');
  const cx = i % V.COLS, cy = Math.floor(i / V.COLS);
  const x = cx * V.TILE + (V.TILE - V.PW) / 2;
  const y = cy * V.TILE - V.PH;                    // 버튼 칸 바로 위에 선다
  assert.strictEqual(V.onButton(lv, x, y), true);
  assert.strictEqual(V.onButton(lv, x, y - 200), false, '공중에 뜨면 아니다');
});

test('inGoal 은 출입구 안에서만 참', () => {
  const V = L();
  V.LIST.forEach(function (lv, i) {
    const g = lv.goal;
    assert.strictEqual(V.inGoal(lv, g.x + 2, g.y + 2), true, i + '번 판 출입구 안');
    assert.strictEqual(V.inGoal(lv, g.x - 300, g.y), false, i + '번 판 출입구 밖');
  });
});

test('판이 의도대로 깰 수 있는가 (도달 검사)', () => {
  const V = L();
  const JUMP_UP = 3;      // 144px / 40 = 3.6 → 보수적으로 3칸
  const ACROSS = 5;

  function canStand(lv, cx, cy, open) {
    if (cx < 0 || cy < 0 || cx >= V.COLS || cy >= V.ROWS) return false;
    if (V.solid(lv, cx, cy, open)) return false;
    return V.solid(lv, cx, cy + 1, open);
  }
  function clearPath(lv, ax, ay, bx, by, open) {
    const n = (Math.abs(bx - ax) + Math.abs(by - ay)) * 8 + 8;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (V.solid(lv, Math.floor(ax + (bx-ax)*t + 0.5), Math.floor(ay + (by-ay)*t + 0.5), open)) return false;
    }
    const lo = Math.min(ay, by), hi = Math.max(ay, by);
    for (let cx = Math.min(ax,bx); cx <= Math.max(ax,bx); cx++) {
      let ok = false;
      for (let cy = lo; cy <= hi; cy++) if (!V.solid(lv, cx, cy, open)) { ok = true; break; }
      if (!ok) return false;
    }
    return true;
  }
  function reach(lv, open, boost) {
    const up = JUMP_UP + boost, starts = [];
    lv.spawns.forEach(function (s) {
      let cx = Math.floor((s.x + V.PW/2) / V.TILE), cy = Math.floor((s.y + V.PH/2) / V.TILE);
      while (cy < V.ROWS && !canStand(lv, cx, cy, open)) cy++;
      if (cy < V.ROWS) starts.push(cx + ',' + cy);
    });
    const seen = new Set(starts), q = starts.map(function (k) { return k.split(',').map(Number); });
    while (q.length) {
      const c = q.shift();
      for (let dx = -ACROSS; dx <= ACROSS; dx++)
        for (let dy = -up; dy <= V.ROWS; dy++) {
          const nx = c[0]+dx, ny = c[1]+dy;
          if (!dx && !dy) continue;
          if (!canStand(lv, nx, ny, open)) continue;
          if (!clearPath(lv, c[0], c[1], nx, ny, open)) continue;
          const k = nx + ',' + ny;
          if (!seen.has(k)) { seen.add(k); q.push([nx, ny]); }
        }
    }
    return seen;
  }
  function goalOk(lv, open, boost) {
    const seen = reach(lv, open, boost);
    const gy = Math.floor(lv.goal.y / V.TILE);
    for (let cx = Math.floor(lv.goal.x/V.TILE); cx <= Math.floor((lv.goal.x+lv.goal.w-1)/V.TILE); cx++)
      if (seen.has(cx + ',' + gy)) return true;
    return false;
  }

  const [l1, l2, l3] = V.LIST;

  /* 1번은 조작을 익히는 판이라 혼자 되어야 한다 */
  assert.strictEqual(goalOk(l1, false, 0), true, '1번 판을 혼자 못 깬다');

  /* 2번의 논지: 혼자서는 못 닿고 남의 머리를 밟아야(+1칸) 닿는다.
     둘 중 하나라도 어긋나면 이 판은 존재 이유가 없다. */
  assert.strictEqual(goalOk(l2, false, 0), false, '2번 판이 혼자 깨진다 — 목마가 필요 없다');
  assert.strictEqual(goalOk(l2, false, 1), true, '2번 판이 목마로도 안 깨진다');

  /* 3번의 논지: 문이 열려야만 갈 수 있고, 버튼은 혼자 닿아야 한다 */
  assert.strictEqual(goalOk(l3, false, 1), false, '3번 판이 문 없이도 깨진다');
  assert.strictEqual(goalOk(l3, true, 0), true, '문이 열려도 못 간다');
  const seen = reach(l3, false, 0);
  const bi = l3.grid.indexOf('B');
  assert.ok(seen.has((bi % V.COLS) + ',' + (Math.floor(bi / V.COLS) - 1)),
    '버튼에 닿을 수가 없다 — 시작조차 못 한다');
});
```

- [ ] **Step 2: 실패 확인** — `node --test test/levels.test.js` → `ENOENT ... js/levels.js`

- [ ] **Step 3: 구현**

`js/levels.js`:

```js
/* ============================================================
   퇴근파크 — 판과 타일 충돌

   옆에서 보는 플랫폼이다. 판 하나가 정확히 한 화면(1280x720, 32x18칸)이라
   카메라도 스크롤도 없다 — 8명이 서로 어디 있는지 늘 보여야 협동이 된다.

   몸통은 28x36 으로 한 칸(40)보다 좁고 두 칸보다 낮다. 그래야 한 칸 통로를
   지나고, 한 칸 턱에 막히지 않는다.

   ── 글자 ────────────────────────────────────────────────
   .  빈칸      #  벽
   B  버튼 (밟으면 문이 열린다)
   D  문   (버튼이 눌린 동안만 통과)
   G  출입구 (전원이 여기 모이면 판 끝)
   ============================================================ */
(function (global) {
  'use strict';

  var W = 1280, H = 720, TILE = 40;
  var COLS = W / TILE, ROWS = H / TILE;      // 32 x 18
  var PW = 28, PH = 36;                      // 플레이어 몸통

  function at(lv, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return '#';   // 맵 밖은 벽
    return lv.grid[cy * COLS + cx];
  }

  function solid(lv, cx, cy, doorOpen) {
    var t = at(lv, cx, cy);
    if (t === '#') return true;
    /* 버튼은 밟는 것이다 — 딛고 설 수 없으면 누를 방법이 없다 */
    if (t === 'B') return true;
    if (t === 'D') return !doorOpen;
    return false;
  }

  /* 몸통(왼쪽 위 x,y)이 막힌 칸과 겹치는가.
     양 끝을 아주 조금 안쪽으로 당겨서 본다 — 정확히 칸 경계에 맞닿았을 때
     옆 칸까지 막힌 것으로 세면 통로에 끼어 못 지나간다. */
  function hits(lv, x, y, doorOpen) {
    var e = 0.001;
    var x0 = Math.floor((x + e) / TILE), x1 = Math.floor((x + PW - e) / TILE);
    var y0 = Math.floor((y + e) / TILE), y1 = Math.floor((y + PH - e) / TILE);
    for (var cy = y0; cy <= y1; cy++)
      for (var cx = x0; cx <= x1; cx++)
        if (solid(lv, cx, cy, doorOpen)) return true;
    return false;
  }

  /* 한 축을 밀어 본다. 막히면 벽에 딱 붙는 자리까지만 간다.
     이분 탐색을 쓰는 이유: 한 프레임에 여러 칸을 건너뛸 만큼 빠를 때도
     벽을 통과하지 않게 하려면 "얼마나 갈 수 있나"를 찾아야 한다. */
  function slide(lv, x, y, dx, dy, doorOpen) {
    if (!dx && !dy) return { v: dx ? x : y, hit: false };
    var nx = x + dx, ny = y + dy;
    if (!hits(lv, nx, ny, doorOpen)) return { v: dx ? nx : ny, hit: false };
    var lo = 0, hi = 1;
    for (var i = 0; i < 14; i++) {
      var mid = (lo + hi) / 2;
      if (hits(lv, x + dx * mid, y + dy * mid, doorOpen)) hi = mid; else lo = mid;
    }
    return { v: dx ? (x + dx * lo) : (y + dy * lo), hit: true };
  }

  function moveX(lv, x, y, dx, doorOpen) {
    var r = slide(lv, x, y, dx, 0, doorOpen);
    return { x: r.v, hit: r.hit };
  }

  function moveY(lv, x, y, dy, doorOpen) {
    var r = slide(lv, x, y, 0, dy, doorOpen);
    return { y: r.v, hit: r.hit };
  }

  /* 발밑 칸이 버튼인가. 몸통 바닥에서 1px 아래를 본다 —
     서 있는 상태에서 발바닥은 칸 경계에 정확히 닿아 있다. */
  function onButton(lv, x, y) {
    var fy = Math.floor((y + PH + 1) / TILE);
    var x0 = Math.floor((x + 1) / TILE), x1 = Math.floor((x + PW - 1) / TILE);
    for (var cx = x0; cx <= x1; cx++) if (at(lv, cx, fy) === 'B') return true;
    return false;
  }

  function inGoal(lv, x, y) {
    var g = lv.goal;
    return x + PW > g.x && x < g.x + g.w && y + PH > g.y && y < g.y + g.h;
  }

  /* ---------- 판 ----------
     32글자 x 18줄. 아래에서 grid 로 펴진다. */

  function build(name, rows, spawnCols, spawnRow) {
    var grid = rows.join('').split('');
    var lv = { name: name, grid: grid, spawns: [], goal: null };
    var i = grid.indexOf('G');
    var gx = (i % COLS) * TILE, gy = Math.floor(i / COLS) * TILE;
    /* 출입구는 가로 두 칸으로 둔다. 8명이 한 칸에 모이면 서로 밀려 나간다. */
    lv.goal = { x: gx, y: gy, w: TILE * 2, h: TILE };
    for (var k = 0; k < 8; k++) {
      lv.spawns.push({
        x: spawnCols[k] * TILE + (TILE - PW) / 2,
        y: spawnRow * TILE + (TILE - PH)
      });
    }
    return lv;
  }

  /* 1 첫 출근 — 걷기·점프·전원 도착만. 혼자서도 갈 수 있다. */
  var L1 = build('첫 출근', [
    '################################',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#........................GG....#',
    '#.......................#####..#',
    '#..............................#',
    '#..............................#',
    '#...............#####..........#',
    '#..............................#',
    '#..............................#',
    '#........#####.................#',
    '#..............................#',
    '#..............................#',
    '#...#####......................#',
    '#..............................#',
    '#..............................#',
    '################################'
  ], [2, 4, 6, 8, 10, 12, 14, 16], 16);

  /* 2 목마 — 혼자 못 오르는 턱. 남의 머리를 밟아야 한다.
     턱 높이가 점프(약 3.6칸)보다 높다. */
  var L2 = build('목마', [
    '################################',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#........................GG....#',
    '#.......................#####..#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '################################'
  ], [2, 4, 6, 8, 10, 12, 14, 16], 16);

  /* 3 누가 남을래 — 버튼을 밟고 있어야 문이 열린다.
     누른 사람은 못 간다. 마지막에 누가 남을지 정해야 한다. */
  var L3 = build('누가 남을래', [
    '################################',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#..............#...............#',
    '#..............#...............#',
    '#..............#...........GG..#',
    '#..............#..........######',
    '#..............#...............#',
    '#..............D...............#',
    '#####B##########################'
  ], [2, 3, 4, 6, 8, 10, 12, 14], 16);

  global.Levels = {
    W: W, H: H, TILE: TILE, COLS: COLS, ROWS: ROWS, PW: PW, PH: PH,
    LIST: [L1, L2, L3],
    at: at, solid: solid, hits: hits,
    moveX: moveX, moveY: moveY,
    onButton: onButton, inGoal: inGoal
  };
})(window);
```

- [ ] **Step 4: 통과 확인 + 눈으로 판을 본다**

```bash
cd /c/Users/NAU/Desktop/Overworked && node --test test/levels.test.js
```

그리고 판을 찍어서 직접 본다 — 격자를 손으로 세면 반드시 틀린다:

```bash
node -e "
const {load}=require('./testlib/load'); const V=load('levels').Levels;
V.LIST.forEach(function(lv,i){
  console.log('=== '+i+' '+lv.name+' ===');
  for(let r=0;r<V.ROWS;r++) console.log(String(r).padStart(2), lv.grid.slice(r*V.COLS,(r+1)*V.COLS).join(''));
  console.log('출입구', JSON.stringify(lv.goal), '스폰', lv.spawns.length);
});
"
```

각 줄이 정확히 32글자인지, 스폰이 바닥 위인지, 2번 판의 턱이 실제로 점프보다 높은지 본다.
점프 도달 높이는 Task 2 에서 `JUMP_V²/(2·GRAVITY)` = 760²/4000 ≈ **144px (3.6칸)** 이다.
2번 판의 턱은 그보다 높아야 "혼자 못 넘는다"가 성립한다.

- [ ] **Step 5: 옛 파일을 지우고 커밋**

```bash
cd /c/Users/NAU/Desktop/Overworked
git rm js/world.js test/world.test.js js/stations.js test/stations.test.js
git add js/levels.js test/levels.test.js
node --test
git commit -m "$(printf '%s\n' '판과 타일 충돌: 사이드뷰로 갈아엎는다' '' '판 하나가 정확히 한 화면이라 카메라도 스크롤도 없다 — 8명이 서로 어디' '있는지 늘 보여야 협동이 된다.' '' '몸통 28x36 은 한 칸(40)보다 좁고 두 칸보다 낮다. 그래야 한 칸 통로를' '지나고 한 칸 턱에 안 막힌다.' '' '겹침 판정에서 양 끝을 0.001 안쪽으로 당긴다. 정확히 칸 경계에 맞닿았을 때' '옆 칸까지 막힌 것으로 세면 통로에 끼어 못 지나간다.' '' 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---
