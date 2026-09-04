'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function W() { return load(['tiles', 'grid', 'levels', 'sim', 'snap']); }
const DT = 1 / 60;
function idle(pids) { const o = {}; pids.forEach(p => { o[p] = { x: 0, jseq: 0 }; }); return o; }

test('pack 은 좌표를 정수로 만든다', () => {
  const { Sim: S, Snap: N } = W();
  const st = S.create(0, ['a']);
  st.players.a.x = 123.456; st.players.a.y = 78.912;
  const k = N.pack(st);
  assert.strictEqual(k.p.a[0], 123);
  assert.strictEqual(k.p.a[1], 79);
});

test('pack 은 sup 을 싣는다 — 이게 없으면 예측 규칙이 성립 안 한다', () => {
  const { Sim: S, Snap: N } = W();
  const st = S.create(0, ['a']);
  [0, 1, 2].forEach(function (v) {
    st.players.a.sup = v;
    assert.strictEqual(N.pack(st).p.a[5], v, 'sup ' + v + ' 이 안 실렸다');
  });
});

test('pack 은 jseq 를 싣지 않는다 (입력 계열은 전송 상태가 아니다)', () => {
  const { Sim: S, Snap: N } = W();
  const st = S.create(0, ['a']);
  st.players.a.jseq = 777;
  const s = JSON.stringify(N.pack(st));
  assert.ok(s.indexOf('777') < 0, 'jseq 가 새어 나갔다: ' + s);
  assert.ok(s.indexOf('jseq') < 0);
});

test('pack 은 t 를 정수 틱으로 적는다', () => {
  const { Sim: S, Snap: N } = W();
  const st = S.create(0, ['a']);
  st.t = 12.77;
  const k = N.pack(st);
  assert.strictEqual(k.t, Math.round(k.t));
});

test('pack → unpack 이 뜻을 지킨다', () => {
  const { Sim: S, Snap: N } = W();
  const st = S.create(1, ['a', 'b']);
  st.players.a.x = 200; st.players.a.y = 100; st.players.a.vx = -240; st.players.a.vy = 55;
  st.players.a.face = -1; st.players.a.sup = 2; st.players.a.done = true;
  st.door = true; st.cleared = false; st.t = 3.4;

  const back = N.unpack(N.pack(st), st.spawnIdx);
  assert.strictEqual(back.lv, 1);
  assert.strictEqual(back.players.a.x, 200);
  assert.strictEqual(back.players.a.y, 100);
  assert.strictEqual(back.players.a.vx, -240);
  assert.strictEqual(back.players.a.vy, 55);
  assert.strictEqual(back.players.a.face, -1);
  assert.strictEqual(back.players.a.sup, 2);
  assert.strictEqual(back.players.a.done, true);
  assert.strictEqual(back.door, true);
  assert.strictEqual(back.cleared, false);
  assert.ok(Math.abs(back.t - 3.4) < 0.06);
});

test('unpack 은 망가진 꾸러미에도 안 죽는다', () => {
  const { Snap: N } = W();
  [null, undefined, 0, '', [], 5, { p: 'x' }, { p: { a: 1 } }, { p: { a: [] } },
   { p: { a: [1, 2] } }, { t: NaN, p: null }].forEach(function (bad) {
    const out = N.unpack(bad, {});
    assert.ok(out && out.players && typeof out.lv === 'number', '꾸러미: ' + JSON.stringify(bad));
  });
});

test('unpack 은 py 를 y 로 맞춰 준다 (첫 틱에 헛디디지 않게)', () => {
  const { Sim: S, Snap: N } = W();
  const st = S.create(0, ['a']);
  st.players.a.y = 300;
  const back = N.unpack(N.pack(st), {});
  assert.strictEqual(back.players.a.py, back.players.a.y,
    'py 가 어긋나면 이어받은 첫 틱에 남의 머리를 잘못 밟는다');
});

test('pack 은 원본을 고치지 않는다', () => {
  const { Sim: S, Snap: N } = W();
  const st = S.create(0, ['a']);
  st.players.a.x = 111.7;
  N.pack(st);
  assert.strictEqual(st.players.a.x, 111.7);
});

test('이어받아 tick 을 돌려도 터지지 않는다', () => {
  const { Sim: S, Snap: N } = W();
  let st = S.create(1, ['a', 'b']);
  for (let i = 0; i < 60; i++) st = S.tick(st, idle(['a', 'b']), DT);
  let back = N.unpack(N.pack(st), st.spawnIdx);
  back = S.adopt(back, idle(['a', 'b']));
  for (let i = 0; i < 60; i++) back = S.tick(back, idle(['a', 'b']), DT);
  assert.ok(back.players.a && back.players.b);
  assert.ok(isFinite(back.players.a.x) && isFinite(back.players.a.y));
});

test('8명 스냅샷이 예산 안에 든다', () => {
  const { Sim: S, Snap: N } = W();
  const pids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  const st = S.create(2, pids);
  pids.forEach(function (p) {
    st.players[p].x = 1234; st.players[p].y = -678;
    st.players[p].vx = -240; st.players[p].vy = 1200;
    st.players[p].face = -1; st.players[p].sup = 2; st.players[p].done = true;
  });
  st.door = true; st.t = 99999;
  const n = N.bytes(N.pack(st));
  console.log('   8명 스냅샷 크기:', n, 'bytes');
  assert.ok(n < 700, '스냅샷이 700바이트를 넘으면 예산을 다시 봐야 한다: ' + n);
});
