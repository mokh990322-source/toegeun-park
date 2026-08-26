'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function world() { return load('world').World; }

/* 테스트용 작은 맵: 5x3, 테두리가 벽
   #####
   #...#
   ##### */
function tiny(W) {
  return {
    cols: 5, rows: 3,
    grid: ('#####' + '#...#' + '#####').split(''),
    spawns: [], stations: []
  };
}

test('맵 크기와 상수', () => {
  const W = world();
  assert.strictEqual(W.W, 1280);
  assert.strictEqual(W.H, 720);
  assert.strictEqual(W.TILE, 40);
  assert.ok(W.R > 0 && W.R < W.TILE / 2, '반지름이 타일 절반보다 작아야 통로를 지난다');
});

test('solidAt 은 벽 칸을 막힌 것으로 본다', () => {
  const W = world(), m = tiny(W);
  assert.strictEqual(W.solidAt(m, 20, 20), true);    // (0,0) 벽
  assert.strictEqual(W.solidAt(m, 60, 60), false);   // (1,1) 바닥
  assert.strictEqual(W.solidAt(m, 140, 60), false);  // (3,1) 바닥
  assert.strictEqual(W.solidAt(m, 180, 60), true);   // (4,1) 오른쪽 벽
  assert.strictEqual(W.solidAt(m, 20, 60), true);    // (0,1) 왼쪽 벽
});

test('solidAt 은 맵 밖을 막힌 것으로 본다', () => {
  const W = world(), m = tiny(W);
  assert.strictEqual(W.solidAt(m, -5, 60), true);
  assert.strictEqual(W.solidAt(m, 9999, 60), true);
  assert.strictEqual(W.solidAt(m, 60, -5), true);
  assert.strictEqual(W.solidAt(m, 60, 9999), true);
});

test('빈 곳에서는 그대로 움직인다', () => {
  const W = world(), m = tiny(W);
  const p = W.move(m, 60, 60, 10, 0);
  assert.strictEqual(Math.round(p.x), 70);
  assert.strictEqual(Math.round(p.y), 60);
});

test('벽을 향해 밀면 벽에 닿아 멈춘다', () => {
  const W = world(), m = tiny(W);
  const p = W.move(m, 60, 60, -100, 0);
  assert.ok(p.x >= 40 + W.R - 0.5, '왼쪽 벽(x=40) 안으로 들어가면 안 된다: ' + p.x);
  assert.ok(p.x <= 40 + W.R + 0.5);
});

test('벽에 비스듬히 밀면 벽을 따라 미끄러진다', () => {
  const W = world(), m = tiny(W);
  /* 위쪽 벽(y<40)을 향해 오른쪽 위로 민다. y 는 막히고 x 는 가야 한다. */
  const p = W.move(m, 60, 60, 20, -100);
  assert.ok(p.x > 70, '가로 성분이 살아 있어야 한다: ' + p.x);
  assert.ok(p.y >= 40 + W.R - 0.5, '위쪽 벽을 뚫으면 안 된다: ' + p.y);
});

test('움직이지 않으면 자리가 그대로다', () => {
  const W = world(), m = tiny(W);
  const p = W.move(m, 60, 60, 0, 0);
  assert.strictEqual(p.x, 60);
  assert.strictEqual(p.y, 60);
});

test('1스테이지 맵이 화면에 들어맞는다', () => {
  const W = world(), m = W.STAGE1;
  assert.strictEqual(m.cols * W.TILE, W.W);
  assert.strictEqual(m.rows * W.TILE, W.H);
  assert.strictEqual(m.grid.length, m.cols * m.rows);
});

test('1스테이지에 스폰 8개가 있고 전부 바닥이다', () => {
  const W = world(), m = W.STAGE1;
  assert.strictEqual(m.spawns.length, 8);
  for (const s of m.spawns) {
    assert.strictEqual(W.solidAt(m, s.x, s.y), false, '스폰이 벽 안이다: ' + JSON.stringify(s));
  }
});

test('1스테이지에 필요한 기계가 다 있다', () => {
  const W = world(), m = W.STAGE1;
  const types = m.stations.map(s => s.type).sort();
  for (const need of ['ref', 'model', 'retopo', 'ship', 'bin']) {
    assert.ok(types.includes(need), need + ' 기계가 없다');
  }
  const ids = m.stations.map(s => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'id 가 겹친다');
});

test('모든 기계 앞에 설 자리가 있다', () => {
  const W = world(), m = W.STAGE1;
  for (const st of m.stations) {
    const around = [[0,-W.TILE],[0,W.TILE],[-W.TILE,0],[W.TILE,0]];
    const open = around.filter(d => !W.solidAt(m, st.cx + d[0], st.cy + d[1]));
    assert.ok(open.length > 0, st.id + ' 앞에 설 자리가 없다');
  }
});

/* M5: 폐기통이 가운데 통로 한복판·스폰 바로 옆에 있으면 지나가다 실수로
   물건을 버리게 된다. 스폰에서 충분히 떨어져 있는지 고정해 둔다. */
test('폐기통은 스폰 바로 옆이 아니다', () => {
  const W = world(), m = W.STAGE1;
  const bin = m.stations.find(s => s.type === 'bin');
  for (const s of m.spawns) {
    const d = Math.hypot(bin.cx - s.x, bin.cy - s.y);
    assert.ok(d > W.TILE * 2, '폐기통이 스폰에서 ' + d + 'px 밖에 안 떨어져 있다: 지나가다 밟는다');
  }
});

test('nearest 는 범위 안의 가장 가까운 기계를 준다', () => {
  const W = world(), m = W.STAGE1;
  const st = m.stations[0];
  assert.strictEqual(W.nearest(m, st.cx, st.cy, 60).id, st.id);
  assert.strictEqual(W.nearest(m, st.cx + 20, st.cy, 60).id, st.id);
});

test('nearest 는 범위 밖이면 null', () => {
  const W = world(), m = W.STAGE1;
  /* 가운데 열린 띠 한복판 — 어느 기계에서도 멀다 */
  assert.strictEqual(W.nearest(m, 16 * W.TILE, 6 * W.TILE, 40), null);
});

test('nearest 는 둘 중 더 가까운 쪽을 고른다', () => {
  const W = world();
  /* 실제 맵으로 하면 세 번째 기계가 더 가까워서 시험이 흐려진다.
     "둘 중 가까운 쪽"만 보려면 기계가 둘뿐인 맵을 지어서 쓴다. */
  const m = {
    cols: 5, rows: 3, grid: ('#####' + '#...#' + '#####').split(''), spawns: [],
    stations: [
      { id: 'a', type: 'ref', cx: 60, cy: 60 },
      { id: 'b', type: 'ship', cx: 140, cy: 60 }
    ]
  };
  assert.strictEqual(W.nearest(m, 90, 60, 400).id, 'a');
  assert.strictEqual(W.nearest(m, 110, 60, 400).id, 'b');
});
