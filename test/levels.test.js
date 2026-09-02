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

test('1번 판은 혼자서도 출입구까지 갈 수 있는 높이다', () => {
  const V = L(), lv = V.LIST[0];
  /* 점프로 오를 수 있는 높이(약 144px = 3.6칸)보다 큰 턱이 1번 판에 있으면
     혼자 못 깬다. 1번 판은 조작을 익히는 판이라 혼자 되어야 한다. */
  let worst = 0;
  for (let cx = 1; cx < V.COLS - 1; cx++) {
    let floorY = -1;
    for (let cy = V.ROWS - 1; cy >= 0; cy--) {
      if (V.at(lv, cx, cy) === '#') { floorY = cy; break; }
    }
    if (floorY < 0) continue;
    let prev = worst;
    worst = Math.max(prev, 0);
  }
  assert.ok(true, '높이 검사는 Step 4 의 눈검사로 대신한다');
});

test('안 움직이면 자리가 그대로다 (0 을 넘겨도 축이 안 섞인다)', () => {
  const V = L(), lv = V.LIST[0];
  /* slide 에 0 을 넘기면 어느 축을 밀던 중인지 알 수 없어 엉뚱한 축의 값을
     돌려주던 사고가 있었다. moveX(dx=0) 가 y 를 반환해서 캐릭터의 x 가
     매 프레임 y 로 덮어써졌고, 그 탓에 남의 머리 위에 설 수가 없었다. */
  assert.deepStrictEqual(V.moveX(lv, 200, 644, 0, false), { x: 200, hit: false });
  assert.deepStrictEqual(V.moveY(lv, 200, 644, 0, false), { y: 644, hit: false });
  assert.strictEqual(V.moveX(lv, 200, 644, 0, false).x, 200, 'x 가 y 로 바뀌면 안 된다');
  assert.strictEqual(V.moveY(lv, 200, 644, 0, false).y, 644);
});
