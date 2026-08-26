'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function all() { return load(['world', 'stations', 'sim', 'snap']); }

function bench(w) {
  const T = w.World.TILE;
  return {
    cols: 10, rows: 5,
    grid: ('##########' + '#SS....SS#' + '#........#' + '#SS....SS#' + '##########').split(''),
    spawns: [{ x: 5 * T, y: 2 * T }, { x: 4 * T, y: 2 * T }],
    stations: [
      { id: 'r', type: 'ref',    cx: 1 * T + T / 2, cy: 1 * T + T / 2 },
      { id: 'm', type: 'model',  cx: 7 * T + T / 2, cy: 1 * T + T / 2 },
      { id: 's', type: 'ship',   cx: 7 * T + T / 2, cy: 3 * T + T / 2 }
    ]
  };
}

test('ITEMS 에 모든 물건 상태가 있다', () => {
  const I = all().Snap.ITEMS;
  for (const s of ['ref', 'high', 'low', 'uv', 'tex', 'rig', 'done', 'burnt']) {
    assert.ok(I.indexOf(s) >= 0, s + ' 가 빠졌다');
  }
  assert.strictEqual(new Set(I).size, I.length, '중복이 있다');
});

test('pack 은 좌표를 정수로 만든다', () => {
  const w = all(), S = w.Sim, P = w.Snap;
  let st = S.create(bench(w), ['a']);
  st.players.a.x = 123.456;
  st.players.a.y = 78.912;
  const k = P.pack(st);
  assert.strictEqual(k.p.a[0], 123);
  assert.strictEqual(k.p.a[1], 79);
});

test('pack 은 빈손을 -1 로 적는다', () => {
  const w = all(), P = w.Snap;
  let st = w.Sim.create(bench(w), ['a']);
  assert.strictEqual(P.pack(st).p.a[3], -1);
});

test('pack 은 들고 있는 물건을 색인으로 적는다', () => {
  const w = all(), P = w.Snap;
  let st = w.Sim.create(bench(w), ['a']);
  st.players.a.hold = 'high';
  assert.strictEqual(P.pack(st).p.a[3], P.ITEMS.indexOf('high'));
});

test('pack 은 t 를 정수 틱으로 적는다', () => {
  const w = all(), P = w.Snap;
  let st = w.Sim.create(bench(w), ['a']);
  st.t = 12.7;
  const k = P.pack(st);
  assert.strictEqual(typeof k.t, 'number');
  assert.strictEqual(k.t, Math.round(k.t), 't 는 정수여야 한다');
});

test('pack → unpack 이 뜻을 지킨다', () => {
  const w = all(), S = w.Sim, P = w.Snap;
  const map = bench(w);
  let st = S.create(map, ['a', 'b']);
  st.players.a.x = 200; st.players.a.y = 100; st.players.a.dir = 2; st.players.a.hold = 'ref';
  st.players.b.x = 300; st.players.b.y = 150; st.players.b.dir = 1;
  st.machines.m = { id: 'm', type: 'model', item: 'ref', prog: 3 };
  st.done = 2;

  const back = P.unpack(P.pack(st), map);
  assert.strictEqual(back.players.a.x, 200);
  assert.strictEqual(back.players.a.dir, 2);
  assert.strictEqual(back.players.a.hold, 'ref');
  assert.strictEqual(back.players.b.hold, null);
  assert.strictEqual(back.machines.m.item, 'ref');
  assert.strictEqual(back.machines.m.prog, 3);
  assert.strictEqual(back.done, 2);
  assert.strictEqual(back.map, map);
});

test('unpack 은 빈 기계를 null 로 되돌린다', () => {
  const w = all(), P = w.Snap;
  const map = bench(w);
  const st = w.Sim.create(map, ['a']);
  const back = P.unpack(P.pack(st), map);
  assert.strictEqual(back.machines.m.item, null);
});

test('unpack 은 맵에 없는 기계를 무시한다', () => {
  const w = all(), P = w.Snap;
  const map = bench(w);
  const k = P.pack(w.Sim.create(map, ['a']));
  k.m.유령 = [0, 0];
  const back = P.unpack(k, map);
  assert.strictEqual(back.machines.유령, undefined, '맵에 없는 기계가 생기면 안 된다');
});

test('unpack 은 망가진 꾸러미에도 안 죽는다', () => {
  const w = all(), P = w.Snap;
  const map = bench(w);
  for (const bad of [null, undefined, {}, { t: 1 }, { p: null, m: null }, 'x', 5]) {
    const back = P.unpack(bad, map);
    assert.ok(back && back.players && back.machines, '꾸러미: ' + JSON.stringify(bad));
  }
});

test('prog 는 소수 둘째 자리까지만 실린다', () => {
  const w = all(), P = w.Snap;
  const map = bench(w);
  let st = w.Sim.create(map, ['a']);
  st.machines.m = { id: 'm', type: 'model', item: 'ref', prog: 0.123456789 };
  const k = P.pack(st);
  assert.strictEqual(k.m.m[1], 0.12);
});

test('8명 스냅샷이 예산 안에 든다', () => {
  const w = all(), S = w.Sim, P = w.Snap;
  const map = w.World.STAGE1;
  const pids = ['p1','p2','p3','p4','p5','p6','p7','p8'];
  let st = S.create(map, pids);
  for (const id of pids) {
    st.players[id].x = 1234.5678;
    st.players[id].y = 678.1234;
    st.players[id].hold = 'high';
  }
  for (const id in st.machines) st.machines[id] = { id, type: st.machines[id].type, item: 'ref', prog: 0.55 };

  const n = P.bytes(P.pack(st));
  console.log('   8명 스냅샷 크기:', n, 'bytes');
  assert.ok(n < 900, '스냅샷이 900바이트를 넘으면 예산(13MB/판)을 넘긴다: ' + n);
});
