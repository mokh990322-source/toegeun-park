'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function W() { return load(['tiles', 'grid', 'levels', 'sim']); }

/* ---------- 판 데이터 ---------- */

test('판이 20개고, 격자가 전부 32x18 이고, 모르는 글자가 없다', () => {
  const { Levels: L, Tiles: T, Grid: G } = W();
  assert.strictEqual(L.LIST.length, 20);
  L.LIST.forEach((lv, i) => {
    const tag = (i + 1) + '번(' + lv.name + ')';
    assert.strictEqual(lv.grid.length, G.COLS * G.ROWS, tag + ' 칸 수가 다르다');
    lv.grid.forEach(function (c) {
      assert.ok(T.known(c), tag + ' 에 모르는 글자 "' + c + '"');
    });
    assert.ok(lv.min >= 1 && lv.min <= 8, tag + ' min 이 이상하다: ' + lv.min);
  });
});

test('판마다 출입구가 있고, 버튼이 있으면 문도 있다 (반대도)', () => {
  const { Levels: L, Tiles: T } = W();
  L.LIST.forEach((lv, i) => {
    const tag = (i + 1) + '번(' + lv.name + ')';
    assert.ok(lv.grid.indexOf(T.GOAL) >= 0, tag + ' 출입구가 없다');
    const hasB = lv.grid.indexOf(T.BUTTON) >= 0;
    const hasD = lv.grid.indexOf(T.DOOR) >= 0;
    assert.strictEqual(hasB, hasD,
      tag + ' 버튼과 문 중 하나만 있다 (버튼 ' + hasB + ' 문 ' + hasD + ')');
  });
});

test('needs 는 버튼 수와 min 을 넘지 않는다', () => {
  const { Levels: L, Tiles: T } = W();
  L.LIST.forEach((lv, i) => {
    const tag = (i + 1) + '번(' + lv.name + ')';
    const n = lv.grid.filter(c => c === T.BUTTON).length;
    if (lv.needs > 1) {
      assert.ok(n >= lv.needs, tag + ' 버튼이 ' + n + '개인데 ' + lv.needs + '명이 눌러야 한다');
      assert.ok(lv.min >= lv.needs, tag + ' min ' + lv.min + ' 인데 ' + lv.needs + '명이 눌러야 한다');
    }
  });
});

test('깜빡이 가시가 있으면 주기가 있고, 없으면 없다', () => {
  const { Levels: L, Tiles: T } = W();
  L.LIST.forEach((lv, i) => {
    const tag = (i + 1) + '번(' + lv.name + ')';
    const has = lv.grid.indexOf(T.BLINK_A) >= 0 || lv.grid.indexOf(T.BLINK_B) >= 0;
    if (has) assert.ok(lv.blink > 0, tag + ' 깜빡이 가시가 있는데 주기가 0 이다 — 영영 안 깜빡인다');
    else assert.strictEqual(lv.blink, 0, tag + ' 깜빡이 가시가 없는데 주기가 있다');
  });
});

test('시작 자리가 벽 속이 아니다', () => {
  const { Levels: L, Grid: G } = W();
  const env = { door: false, cr: {} };
  L.LIST.forEach((lv, i) => {
    assert.strictEqual(lv.spawns.length, 8, (i + 1) + '번 시작 자리가 8개가 아니다');
    lv.spawns.forEach((s, k) => {
      assert.ok(!G.hits(lv, s.x, s.y, env),
        (i + 1) + '번(' + lv.name + ') ' + k + '번 시작 자리가 벽 속이다');
    });
  });
});

test('움직이는 발판이 화면 밖으로 안 나간다', () => {
  const { Levels: L, Grid: G } = W();
  L.LIST.forEach((lv, i) => {
    const tag = (i + 1) + '번(' + lv.name + ')';
    lv.movers.forEach((m, k) => {
      assert.ok(m.period > 0, tag + ' ' + k + '번 발판 주기가 0 이다 — 안 움직이면 발판이 아니다');
      for (let s = 0; s <= 20; s++) {
        const box = G.moverAt(m, (m.period * s) / 20);
        assert.ok(box.x >= 0 && box.x + box.w <= G.W, tag + ' ' + k + '번 발판이 좌우로 화면을 벗어난다');
        assert.ok(box.y >= 0 && box.y + box.h <= G.H, tag + ' ' + k + '번 발판이 위아래로 화면을 벗어난다');
      }
    });
  });
});

/* ---------- 격자 위의 이동 (grid.js) ---------- */

test('맵 밖은 벽이다', () => {
  const { Levels: L, Grid: G } = W();
  const lv = L.LIST[0];
  assert.strictEqual(G.solid(lv, -1, 5, {}), true);
  assert.strictEqual(G.solid(lv, G.COLS, 5, {}), true);
  assert.strictEqual(G.solid(lv, 5, -1, {}), true);
  assert.strictEqual(G.solid(lv, 5, G.ROWS, {}), true);
});

test('문은 열렸을 때만 지나갈 수 있다', () => {
  const { Levels: L, Grid: G, Tiles: T } = W();
  const lv = L.LIST[2];
  const i = lv.grid.indexOf(T.DOOR);
  const cx = i % G.COLS, cy = Math.floor(i / G.COLS);
  assert.strictEqual(G.solid(lv, cx, cy, { door: false }), true);
  assert.strictEqual(G.solid(lv, cx, cy, { door: true }), false);
});

test('일방통행은 위에서 내려올 때만 딛는다', () => {
  const { Levels: L, Grid: G, Tiles: T } = W();
  const lv = L.LIST[3];
  const i = lv.grid.indexOf(T.ONEWAY);
  const cx = i % G.COLS, cy = Math.floor(i / G.COLS);
  const top = cy * G.TILE;
  assert.strictEqual(G.solid(lv, cx, cy, { ow: { down: true, feet: top - 5 } }), true,
    '위에서 내려오는 중이면 딛는다');
  assert.strictEqual(G.solid(lv, cx, cy, { ow: { down: false, feet: top + 50 } }), false,
    '올라가는 중이면 통과한다');
  assert.strictEqual(G.solid(lv, cx, cy, { ow: { down: true, feet: top + 50 } }), false,
    '이미 발판보다 아래면 내려가는 중이어도 통과한다');
});

test('부서진 발판은 못 딛는다 (금만 갔을 때는 딛는다)', () => {
  const { Levels: L, Grid: G, Tiles: T } = W();
  const lv = L.LIST[15];
  const i = lv.grid.indexOf(T.CRUMBLE);
  const cx = i % G.COLS, cy = Math.floor(i / G.COLS);
  assert.strictEqual(G.solid(lv, cx, cy, { cr: {} }), true, '멀쩡할 때');
  const cracking = {}; cracking[i] = 0.2;
  assert.strictEqual(G.solid(lv, cx, cy, { cr: cracking }), true, '금만 갔을 때');
  const broken = {}; broken[i] = -1.5;
  assert.strictEqual(G.solid(lv, cx, cy, { cr: broken }), false, '무너졌을 때');
});

test('moveX 는 벽에 붙여 세우고, 빈 곳에서는 그대로 간다', () => {
  const { Levels: L, Grid: G } = W();
  const lv = L.LIST[0];
  const y = 16 * G.TILE + (G.TILE - G.PH);
  const hit = G.moveX(lv, G.TILE * 2, y, -500, {});
  assert.strictEqual(hit.hit, true);
  assert.ok(hit.x >= G.TILE - 0.1 && hit.x <= G.TILE + 0.6, '왼쪽 벽에 붙어야 한다: ' + hit.x);
  const free = G.moveX(lv, G.TILE * 5, y, 20, {});
  assert.strictEqual(free.hit, false);
  assert.strictEqual(free.x, G.TILE * 5 + 20);
});

test('moveY 는 큰 dy 에도 바닥을 뚫지 않는다', () => {
  const { Levels: L, Grid: G } = W();
  const r = G.moveY(L.LIST[0], G.TILE * 5, 100, 5000, {});
  assert.strictEqual(r.hit, true);
  assert.ok(r.y + G.PH <= 17 * G.TILE + 0.6, '바닥 위에 서야 한다: ' + (r.y + G.PH));
});

test('안 움직이면 자리가 그대로다 (0 을 넘겨도 축이 안 섞인다)', () => {
  const { Levels: L, Grid: G } = W();
  const lv = L.LIST[0];
  assert.deepStrictEqual(G.moveX(lv, 123, 456, 0, {}), { x: 123, hit: false });
  assert.deepStrictEqual(G.moveY(lv, 123, 456, 0, {}), { y: 456, hit: false });
});

test('onButton 은 발밑 칸을 본다', () => {
  const { Levels: L, Grid: G, Tiles: T } = W();
  const lv = L.LIST[2];
  const i = lv.grid.indexOf(T.BUTTON);
  const bx = (i % G.COLS) * G.TILE + (G.TILE - G.PW) / 2;
  const by = Math.floor(i / G.COLS) * G.TILE - G.PH;
  assert.strictEqual(G.onButton(lv, bx, by), true);
  assert.strictEqual(G.onButton(lv, bx + G.TILE * 4, by), false, '멀리 서면 안 눌린다');
});

test('inGoal 은 출입구 안에서만 참', () => {
  const { Levels: L, Grid: G } = W();
  const lv = L.LIST[0];
  const g = lv.goal;
  assert.strictEqual(G.inGoal(lv, g.x + 4, g.y + g.h - G.PH), true);
  assert.strictEqual(G.inGoal(lv, g.x - 200, g.y), false);
});

test('미는 바닥은 딛는 방향을 알려 준다', () => {
  const { Levels: L, Grid: G, Tiles: T } = W();
  const lv = L.LIST[4];
  const r = lv.grid.indexOf(T.PUSH_R);
  assert.ok(r >= 0, '5번 판에 오른쪽으로 미는 바닥이 있어야 한다');
  const rx = (r % G.COLS) * G.TILE + (G.TILE - G.PW) / 2;
  const ry = Math.floor(r / G.COLS) * G.TILE - G.PH;
  assert.strictEqual(G.pushOf(lv, rx, ry), 1);
  const l = lv.grid.indexOf(T.PUSH_L);
  const lx = (l % G.COLS) * G.TILE + (G.TILE - G.PW) / 2;
  const ly = Math.floor(l / G.COLS) * G.TILE - G.PH;
  assert.strictEqual(G.pushOf(lv, lx, ly), -1);
});

test('움직이는 발판은 삼각파라 속도가 어디서나 같다', () => {
  const { Levels: L, Grid: G } = W();
  const m = L.mover(4, 10, 3, 6, 0, 4, 0);
  assert.ok(Math.abs(G.moverAt(m, 0).x - m.x) < 0.001, '0초에 출발 자리');
  assert.ok(Math.abs(G.moverAt(m, 2).x - (m.x + m.dx)) < 0.001, '반 주기에 반대 끝');
  assert.ok(Math.abs(G.moverAt(m, 4).x - m.x) < 0.001, '한 주기에 제자리');
  /* 속도가 들쭉날쭉하면 "언제 뛰어야 하는지"가 매번 달라져 배울 수가 없다 */
  const v = [0.3, 1.7, 3.1].map(t => Math.abs(G.moverVel(m, t).vx));
  assert.ok(Math.abs(v[0] - v[1]) < 0.001 && Math.abs(v[1] - v[2]) < 0.001,
    '속도가 들쭉날쭉하다: ' + v.join(' '));
});

test('깜빡이 가시는 ! 와 ? 가 늘 반대다', () => {
  const { Sim: S, Levels: L, Tiles: T } = W();
  const lv = L.LIST[12];
  for (let t = 0; t < 6; t += 0.37) {
    const on = S.blinkOn(lv, t);
    assert.strictEqual(T.hazard(T.BLINK_A, on), !T.hazard(T.BLINK_B, on),
      't=' + t.toFixed(2) + ' 에서 둘이 같은 상태다');
  }
});
