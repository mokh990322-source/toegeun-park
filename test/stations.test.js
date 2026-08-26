'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function S() { return load('stations').Stations; }

test('1단계에 필요한 기계가 정의돼 있다', () => {
  const T = S().TYPES;
  for (const k of ['ref', 'model', 'retopo', 'ship', 'bin']) {
    assert.ok(T[k], k + ' 정의가 없다');
    assert.ok(typeof T[k].name === 'string' && T[k].name.length > 0, k + ' 이름이 없다');
  }
});

test('2단계용 기계도 미리 들어 있다', () => {
  const T = S().TYPES;
  for (const k of ['uv', 'bake', 'rig', 'farm']) assert.ok(T[k], k + ' 정의가 없다');
});

test('mode 는 정해진 넷 중 하나다', () => {
  const T = S().TYPES;
  for (const k in T) {
    assert.ok(['source', 'tap', 'wait', 'sink'].indexOf(T[k].mode) >= 0, k + ' 의 mode 가 이상하다');
  }
});

test('공정이 ref 에서 done 까지 한 줄로 이어진다', () => {
  const T = S().TYPES;
  assert.strictEqual(T.ref.gives, 'ref');
  assert.deepStrictEqual(T.model.accepts, ['ref']);
  assert.strictEqual(T.model.gives, 'high');
  assert.deepStrictEqual(T.retopo.accepts, ['high']);
  assert.strictEqual(T.retopo.gives, 'low');
  assert.deepStrictEqual(T.uv.accepts, ['low']);
  assert.strictEqual(T.uv.gives, 'uv');
  assert.deepStrictEqual(T.bake.accepts, ['uv']);
  assert.strictEqual(T.bake.gives, 'tex');
  assert.deepStrictEqual(T.rig.accepts, ['tex']);
  assert.strictEqual(T.rig.gives, 'rig');
  assert.deepStrictEqual(T.farm.accepts, ['rig']);
  assert.strictEqual(T.farm.gives, 'done');
});

test('폐기통은 아무거나 받고 아무것도 안 준다', () => {
  const T = S().TYPES;
  assert.strictEqual(T.bin.accepts, null);
  assert.strictEqual(T.bin.gives, null);
  assert.strictEqual(T.bin.mode, 'sink');
});

test('canAccept 는 받을 수 있는 것만 통과시킨다', () => {
  const St = S();
  assert.strictEqual(St.canAccept('model', 'ref'), true);
  assert.strictEqual(St.canAccept('model', 'high'), false);
  assert.strictEqual(St.canAccept('retopo', 'high'), true);
  assert.strictEqual(St.canAccept('retopo', 'ref'), false);
  assert.strictEqual(St.canAccept('bin', 'burnt'), true, '폐기통은 탄 것도 받는다');
  assert.strictEqual(St.canAccept('bin', 'ref'), true);
  assert.strictEqual(St.canAccept('없는기계', 'ref'), false);
});

test('ref 는 source 라 아무것도 안 받는다', () => {
  const St = S();
  assert.strictEqual(St.TYPES.ref.mode, 'source');
  assert.strictEqual(St.canAccept('ref', 'ref'), false);
  assert.strictEqual(St.canAccept('ref', 'low'), false);
});

test('1스테이지 목표는 로우폴리 6개', () => {
  const G = S().STAGE1_GOAL;
  assert.strictEqual(G.need, 'low');
  assert.ok(G.count >= 4 && G.count <= 10, '목표가 4~10 사이여야 판이 지루하지도 길지도 않다');
});

test('ship 은 mode 가 sink 다', () => {
  assert.strictEqual(S().TYPES.ship.mode, 'sink');
});

test('tap 기계는 누름 횟수가 있고 wait 기계는 초가 있다', () => {
  const T = S().TYPES;
  assert.ok(T.model.work >= 1, '연타 횟수가 1 이상이어야 한다');
  assert.ok(T.retopo.work >= 1);
  assert.ok(T.uv.work > 0, '대기 초가 0 보다 커야 한다');
  assert.ok(T.bake.work > 0);
});

/* ---------- step ---------- */

test('step 은 빈 기계를 그대로 둔다', () => {
  const St = S();
  const m = { id: 'uv1', type: 'uv', item: null, prog: 0 };
  assert.deepStrictEqual(St.step(m, 1), m);
});

test('step 은 tap 기계를 시간으로 굴리지 않는다', () => {
  const St = S();
  const m = { id: 'model1', type: 'model', item: 'ref', prog: 0 };
  assert.strictEqual(St.step(m, 5).prog, 0);
});

test('step 은 wait 기계의 진행을 올린다', () => {
  const St = S();
  const T = St.TYPES.uv;
  const m = { id: 'uv1', type: 'uv', item: 'low', prog: 0 };
  const out = St.step(m, T.work / 2);
  assert.ok(out.prog > 0.4 && out.prog < 0.6, '절반쯤 와야 한다: ' + out.prog);
  assert.strictEqual(out.item, 'low', '아직 안 끝났으면 상태 그대로');
});

test('step 은 다 되면 결과물로 바꾸고 진행을 1 로 둔다', () => {
  const St = S();
  const m = { id: 'uv1', type: 'uv', item: 'low', prog: 0 };
  const out = St.step(m, St.TYPES.uv.work + 0.1);
  assert.strictEqual(out.item, 'uv');
  assert.strictEqual(out.prog, 1);
});

test('step 은 원본을 고치지 않는다', () => {
  const St = S();
  const m = { id: 'uv1', type: 'uv', item: 'low', prog: 0 };
  St.step(m, 99);
  assert.strictEqual(m.item, 'low');
  assert.strictEqual(m.prog, 0);
});

test('베이커는 다 익은 뒤 방치하면 탄다', () => {
  const St = S();
  const T = St.TYPES.bake;
  assert.ok(T.burn > 0, '베이커는 타야 한다');
  let m = { id: 'bake1', type: 'bake', item: 'uv', prog: 0 };
  m = St.step(m, T.work + 0.1);
  assert.strictEqual(m.item, 'tex', '먼저 다 익는다');
  m = St.step(m, T.burn + 0.1);
  assert.strictEqual(m.item, 'burnt', '방치하면 탄다');
});

test('타지 않는 기계는 두어도 안 탄다', () => {
  const St = S();
  assert.strictEqual(St.TYPES.uv.burn, 0);
  let m = { id: 'uv1', type: 'uv', item: 'low', prog: 0 };
  m = St.step(m, 999);
  m = St.step(m, 999);
  assert.strictEqual(m.item, 'uv', 'UV 는 타지 않는다');
});

test('탄 것은 더 타지 않는다', () => {
  const St = S();
  let m = { id: 'bake1', type: 'bake', item: 'burnt', prog: 1 };
  assert.strictEqual(St.step(m, 999).item, 'burnt');
});
