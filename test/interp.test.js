'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function I() { return load('interp').Interp; }

test('상수가 말이 되는 범위다', () => {
  const N = I();
  assert.ok(N.DELAY >= 0.1 && N.DELAY <= 0.3, '지연 버퍼는 스냅샷 간격(0.1초)보다 커야 한다');
  assert.ok(N.SNAP_DIST > 100, '너무 작으면 평범한 이동에도 순간이동한다');
  assert.ok(N.CORRECT_RATE > 0);
});

test('lerp 기본', () => {
  const N = I();
  assert.strictEqual(N.lerp(0, 10, 0), 0);
  assert.strictEqual(N.lerp(0, 10, 1), 10);
  assert.strictEqual(N.lerp(0, 10, 0.5), 5);
});

test('between 은 두 점 사이를 준다', () => {
  const N = I();
  /* 거리 156 — 순간이동 문턱(220)보다 한참 안쪽 */
  assert.deepStrictEqual(N.between([0, 0], [100, 120], 0.5), { x: 50, y: 60 });
  assert.deepStrictEqual(N.between([0, 0], [100, 120], 0), { x: 0, y: 0 });
  assert.deepStrictEqual(N.between([0, 0], [100, 120], 1), { x: 100, y: 120 });
});

test('순간이동 문턱이 정상 이동보다 한참 크다', () => {
  const N = I();
  /* 스냅샷 두 개 사이(0.1초)에 정상적으로 움직일 수 있는 최대 거리는
     Sim.SPEED(210) x 0.1 = 21px 다. 문턱이 그보다 훨씬 커야 평범한 달리기가
     순간이동으로 오인되지 않는다. */
  const perSnapshot = 210 * 0.1;
  assert.ok(N.SNAP_DIST > perSnapshot * 5,
    '문턱 ' + N.SNAP_DIST + ' 가 한 스냅샷 이동거리 ' + perSnapshot + ' 에 비해 너무 좁다');
});

test('between 은 너무 멀면 뒤쪽으로 튄다', () => {
  const N = I();
  const far = N.SNAP_DIST + 100;
  const out = N.between([0, 0], [far, 0], 0.5);
  assert.strictEqual(out.x, far, '멀면 끌지 말고 바로 옮겨야 한다');
});

test('버퍼는 스냅샷이 하나뿐이면 그것만 준다', () => {
  const N = I();
  const b = new N.Buffer();
  b.push(1.0, { t: 10, p: { a: [0, 0, 0, -1] } });
  const s = b.sample(1.0);
  assert.ok(s, '하나라도 있으면 뭔가 줘야 한다');
  assert.strictEqual(s.a, s.b, '앞뒤가 같아야 한다');
  assert.strictEqual(s.k, 0);
});

test('버퍼는 아무것도 없으면 null', () => {
  const N = I();
  assert.strictEqual(new N.Buffer().sample(1.0), null);
});

test('버퍼는 지연만큼 과거를 보여 준다', () => {
  const N = I();
  const b = new N.Buffer();
  b.push(1.0, { t: 10 });
  b.push(1.1, { t: 11 });
  b.push(1.2, { t: 12 });
  /* 지금이 1.2 라면 (1.2 - DELAY) 시점을 본다 */
  const s = b.sample(1.2);
  const target = 1.2 - N.DELAY;
  assert.ok(s.a.t <= 11, '과거 스냅샷을 골라야 한다: ' + s.a.t + ' (목표시각 ' + target + ')');
});

test('버퍼는 두 스냅샷 사이 비율을 준다', () => {
  const N = I();
  const b = new N.Buffer();
  const d = N.DELAY;
  b.push(1.0, { t: 10 });
  b.push(1.2, { t: 12 });
  const s = b.sample(1.1 + d);          // 목표시각 1.1 — 딱 중간
  assert.strictEqual(s.a.t, 10);
  assert.strictEqual(s.b.t, 12);
  assert.ok(Math.abs(s.k - 0.5) < 0.02, '중간이어야 한다: ' + s.k);
});

test('버퍼는 목표시각이 최신보다 뒤면 최신에 붙는다', () => {
  const N = I();
  const b = new N.Buffer();
  b.push(1.0, { t: 10 });
  b.push(1.1, { t: 11 });
  /* 목표시각 = 2.0 - DELAY = 1.85 — 최신(1.1)보다도 미래다. 스냅샷이 한동안
     안 오는데 로컬 시계는 계속 흐르는 상황(네트워크 지연)을 흉내낸다.
     (예전 버전은 sample(1.1) 을 썼는데, 그러면 목표시각이 0.95 로 오히려
     "최신보다 앞" 분기를 타서 이 테스트가 실제로는 아무것도 확인하지
     못했다.) */
  const s = b.sample(2.0);
  assert.strictEqual(s.a, s.b, '더 새 스냅샷이 없으니 앞뒤가 같아야 한다');
  assert.strictEqual(s.a.t, 11, '최신에 붙어야 한다');
});

test('버퍼는 무한히 쌓이지 않는다', () => {
  const N = I();
  const b = new N.Buffer();
  for (let i = 0; i < 500; i++) b.push(i * 0.1, { t: i });
  assert.ok(b.size() <= 30, '오래된 건 버려야 한다: ' + b.size());
});

test('버퍼는 순서가 뒤집힌 스냅샷을 버린다', () => {
  const N = I();
  const b = new N.Buffer();
  b.push(1.0, { t: 10 });
  b.push(1.1, { t: 11 });
  b.push(1.05, { t: 9 });               // 늦게 도착한 옛날 것
  const s = b.sample(1.1 + N.DELAY);
  assert.strictEqual(s.b.t, 11, '옛날 것이 최신을 밀어내면 안 된다');
});

/* ---------- 내 캐릭터 보정 ---------- */

test('오차가 없으면 그대로 둔다', () => {
  const N = I();
  const out = N.correct({ x: 100, y: 100 }, { x: 100, y: 100 }, 1 / 60);
  assert.strictEqual(Math.round(out.x), 100);
});

test('작은 오차는 조금씩 당긴다', () => {
  const N = I();
  const out = N.correct({ x: 100, y: 100 }, { x: 120, y: 100 }, 1 / 60);
  assert.ok(out.x > 100 && out.x < 120, '한 번에 다 가면 튄다: ' + out.x);
});

test('당기다 보면 결국 맞는다', () => {
  const N = I();
  let p = { x: 100, y: 100 };
  for (let i = 0; i < 120; i++) p = N.correct(p, { x: 120, y: 100 }, 1 / 60);
  assert.ok(Math.abs(p.x - 120) < 1, '2초면 붙어야 한다: ' + p.x);
});

test('오차가 아주 크면 그냥 순간이동한다', () => {
  const N = I();
  const far = N.SNAP_DIST + 200;
  const out = N.correct({ x: 0, y: 0 }, { x: far, y: 0 }, 1 / 60);
  assert.strictEqual(out.x, far, '되감기 수준으로 벌어지면 끌지 말고 옮긴다');
});

test('correct 는 원본을 고치지 않는다', () => {
  const N = I();
  const local = { x: 100, y: 100 };
  N.correct(local, { x: 200, y: 100 }, 1 / 60);
  assert.strictEqual(local.x, 100);
});
