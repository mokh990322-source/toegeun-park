'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function W() { return load(['tiles', 'grid', 'levels', 'sim', 'snap']); }
const DT = 1 / 60;
function run(S, st, inputs, n) { for (let i = 0; i < n; i++) st = S.tick(st, inputs, DT); return st; }
function keyLevel(L) {
  for (let i = 0; i < L.LIST.length; i++) if (L.LIST[i].key) return i;
  throw new Error('열쇠를 쓰는 판이 없다');
}
function withGlyph(L, ch) {
  for (let i = 0; i < L.LIST.length; i++) if (L.LIST[i].grid.indexOf(ch) >= 0) return i;
  return -1;
}

/* ---------- 숫자가 규칙을 만든다 ----------
   이 장치들은 코드가 아니라 숫자로 규칙이 정해진다. 열쇠를 지고 세 칸을
   오를 수 있게 되는 순간 "던져 준다"는 행동이 통째로 사라진다. */

test('열쇠를 지면 세 칸 턱을 혼자 못 오른다', () => {
  const { Sim: S, Grid: G } = W();
  const plain = (S.JUMP_V * S.JUMP_V) / (2 * S.GRAVITY);
  const laden = Math.pow(S.JUMP_V * S.KEY_JUMP, 2) / (2 * S.GRAVITY);
  assert.ok(plain > G.TILE * 3, '맨몸으로는 세 칸을 올라야 한다: ' + plain.toFixed(0));
  assert.ok(laden < G.TILE * 3 - 8,
    '열쇠를 지고도 세 칸을 오르면 던져 줄 이유가 없어진다: ' + laden.toFixed(0));
  assert.ok(laden > G.TILE * 2,
    '두 칸도 못 오르면 열쇠를 옮길 방법이 아예 없다: ' + laden.toFixed(0));
});

test('사람을 던지면 목마로도 못 닿는 데까지 간다', () => {
  const { Sim: S, Grid: G } = W();
  const jump = (S.JUMP_V * S.JUMP_V) / (2 * S.GRAVITY);
  const toss = (S.TOSS_VY * S.TOSS_VY) / (2 * S.GRAVITY);
  assert.ok(toss > jump + G.PH + G.TILE,
    '던지기가 목마와 비슷하면 장치를 하나 더 만든 뜻이 없다: 점프 ' +
    jump.toFixed(0) + ' / 목마 ' + (jump + G.PH).toFixed(0) + ' / 던지기 ' + toss.toFixed(0));
});

/* ---------- 열쇠 ---------- */

test('열쇠를 줍고, 지고 다니고, 던진다', () => {
  const { Sim: S, Levels: L, Grid: G } = W();
  const li = keyLevel(L);
  const lv = L.LIST[li];
  let st = S.create(li, ['a']);
  assert.ok(st.key, '열쇠 판인데 열쇠가 없다');

  st.players.a.x = lv.key.x - 4;
  st = run(S, st, { a: { x: 0, jseq: 0, aseq: 1 } }, 3);
  assert.strictEqual(st.players.a.hold, 'K', '열쇠를 못 주웠다');
  assert.strictEqual(st.key.by, 'a');

  st = run(S, st, { a: { x: 1, jseq: 0, aseq: 1 } }, 20);
  assert.ok(Math.abs((st.key.x + S.KEY_W / 2) - (st.players.a.x + G.PW / 2)) < 3,
    '열쇠가 든 사람을 안 따라온다');

  st.players.a.face = 1;
  st = S.tick(st, { a: { x: 1, jseq: 0, aseq: 2 } }, DT);
  assert.strictEqual(st.players.a.hold, '', '던졌는데 아직 들고 있다');
  assert.strictEqual(st.key.by, '');
  assert.ok(st.key.vy < 0, '던진 열쇠가 위로 안 간다');
  assert.ok(st.key.vx > 0, '바라보는 쪽으로 안 날아간다');
});

test('열쇠가 문에 닿으면 그 라운드 내내 열린다 (버튼처럼 도로 안 닫힌다)', () => {
  const { Sim: S, Levels: L, Grid: G } = W();
  const li = keyLevel(L);
  const lv = L.LIST[li];
  const di = lv.grid.indexOf('D');
  let st = S.create(li, ['a']);
  st.key.x = (di % G.COLS) * G.TILE + 10;
  st.key.y = Math.floor(di / G.COLS) * G.TILE + 10;

  st = S.tick(st, { a: { x: 0, jseq: 0 } }, DT);
  assert.strictEqual(st.key.done, true);
  assert.strictEqual(st.door, true);

  /* 지고 온 것을 계속 지키게 만들면 열쇠가 두 번째 버튼일 뿐이다 */
  st = run(S, st, { a: { x: 0, jseq: 0 } }, 60 * (S.DOOR_LINGER + 2));
  assert.strictEqual(st.door, true, '열쇠로 연 문이 도로 닫혔다');
});

test('열쇠를 지고 떨어지면 열쇠를 놓는다 (지름길이 되면 안 된다)', () => {
  const { Sim: S, Levels: L } = W();
  const li = keyLevel(L);
  let st = S.create(li, ['a']);
  st.players.a.x = L.LIST[li].key.x - 4;
  st = run(S, st, { a: { x: 0, jseq: 0, aseq: 1 } }, 3);
  assert.strictEqual(st.players.a.hold, 'K');

  st.players.a.y = L.H + 200;
  st = S.tick(st, { a: { x: 0, jseq: 0, aseq: 1 } }, DT);
  assert.strictEqual(st.players.a.hold, '', '떨어졌는데 열쇠를 들고 되살아났다');
  assert.strictEqual(st.key.by, '');
});

test('열쇠가 화면 밖으로 나가면 놓였던 자리로 돌아온다', () => {
  const { Sim: S, Levels: L } = W();
  const li = keyLevel(L);
  const lv = L.LIST[li];
  let st = S.create(li, ['a']);
  st.key.x = 100; st.key.y = L.H + 200;
  st = S.tick(st, { a: { x: 0, jseq: 0 } }, DT);
  assert.ok(Math.abs(st.key.x - lv.key.x) < 1 && Math.abs(st.key.y - lv.key.y) < 1,
    '열쇠가 사라지면 그 판은 아무도 못 깨는데 왜 못 깨는지도 안 보인다');
});

/* ---------- 들기·던지기 ---------- */

test('동료를 집으면 머리 위로 올라오고, 던지면 날아간다', () => {
  const { Sim: S, Grid: G } = W();
  let st = S.create(0, ['a', 'b']);
  st = run(S, st, { a: { x: 0, jseq: 0 }, b: { x: 0, jseq: 0 } }, 60);
  st.players.b.x = st.players.a.x + 20;
  st.players.b.y = st.players.a.y;

  st = S.tick(st, { a: { x: 0, jseq: 0, aseq: 1 }, b: { x: 0, jseq: 0 } }, DT);
  assert.strictEqual(st.players.a.hold, 'b', '옆 사람을 못 집었다');
  assert.strictEqual(st.players.b.heldBy, 'a');
  assert.ok(Math.abs(st.players.b.y - (st.players.a.y - G.PH)) < 1, '머리 위가 아니다');

  /* 들려 있는 사람의 조작은 무시된다 */
  const bx = st.players.b.x;
  st = run(S, st, { a: { x: 0, jseq: 0, aseq: 1 }, b: { x: -1, jseq: 5 } }, 10);
  assert.ok(Math.abs(st.players.b.x - bx) < 1, '들려 있는데 혼자 걸어갔다');

  st.players.a.face = 1;
  st = S.tick(st, { a: { x: 0, jseq: 0, aseq: 2 }, b: { x: 0, jseq: 0 } }, DT);
  assert.strictEqual(st.players.a.hold, '');
  assert.strictEqual(st.players.b.heldBy, '');
  assert.ok(st.players.b.vy < 0, '던진 사람이 위로 안 간다');
});

test('이미 들려 있는 사람은 또 못 집는다 (사람 탑은 풀 방법이 없다)', () => {
  const { Sim: S } = W();
  let st = S.create(0, ['a', 'b', 'c']);
  st = run(S, st, {}, 60);
  st.players.b.x = st.players.a.x + 20; st.players.b.y = st.players.a.y;
  st = S.tick(st, { a: { x: 0, jseq: 0, aseq: 1 } }, DT);
  assert.strictEqual(st.players.a.hold, 'b');

  st.players.c.x = st.players.b.x + 10; st.players.c.y = st.players.b.y;
  st = S.tick(st, { a: { x: 0, jseq: 0, aseq: 1 }, c: { x: 0, jseq: 0, aseq: 1 } }, DT);
  assert.notStrictEqual(st.players.c.hold, 'b', '들려 있는 사람을 또 집었다');
});

/* ---------- 대포 ---------- */

test('대포에 들어가면 점프보다 훨씬 높이 쏘아 올려진다', () => {
  const { Sim: S, Levels: L, Grid: G, Tiles: T } = W();
  const li = withGlyph(L, T.CANNON);
  assert.ok(li >= 0, '대포를 쓰는 판이 없다');
  const lv = L.LIST[li];
  const ci = lv.grid.indexOf(T.CANNON);

  let st = S.create(li, ['a']);
  st.players.a.x = (ci % G.COLS) * G.TILE + (G.TILE - G.PW) / 2;
  st.players.a.y = Math.floor(ci / G.COLS) * G.TILE + 2;
  const y0 = st.players.a.y;

  st = S.tick(st, { a: { x: 0, jseq: 0 } }, DT);
  assert.ok(st.players.a.vy < -S.CANNON_V * 0.9, '안 쏘아졌다: vy=' + st.players.a.vy.toFixed(0));

  let top = st.players.a.y;
  for (let i = 0; i < 90; i++) {
    st = S.tick(st, { a: { x: 0, jseq: 0 } }, DT);
    top = Math.min(top, st.players.a.y);
  }
  const jump = (S.JUMP_V * S.JUMP_V) / (2 * S.GRAVITY);
  assert.ok(y0 - top > jump * 1.5, '대포가 점프보다 크게 안 올린다: ' + (y0 - top).toFixed(0));
});

/* ---------- 선 위로 실려 가나 ---------- */

test('스냅샷이 열쇠와 "누가 무엇을 들고 있나"를 나른다', () => {
  const { Sim: S, Snap: N, Levels: L } = W();
  const li = keyLevel(L);
  let st = S.create(li, ['a', 'b']);
  st.players.a.x = L.LIST[li].key.x - 4;
  st = run(S, st, { a: { x: 0, jseq: 0, aseq: 1 }, b: { x: 0, jseq: 0 } }, 3);
  assert.strictEqual(st.players.a.hold, 'K');

  const back = N.unpack(N.pack(st), st.spawnIdx);
  assert.ok(back.key, '열쇠가 안 실렸다');
  assert.strictEqual(back.key.by, 'a');
  assert.strictEqual(back.players.a.hold, 'K', '누가 들고 있는지가 안 실렸다');

  let st2 = S.create(0, ['a', 'b']);
  st2 = run(S, st2, {}, 60);
  st2.players.b.x = st2.players.a.x + 20; st2.players.b.y = st2.players.a.y;
  st2 = S.tick(st2, { a: { x: 0, jseq: 0, aseq: 1 } }, DT);
  const back2 = N.unpack(N.pack(st2), st2.spawnIdx);
  assert.strictEqual(back2.players.a.hold, 'b');
  assert.strictEqual(back2.players.b.heldBy, 'a', '들린 쪽 표시가 복원 안 됐다');
});

test('잡기 카운터는 512 에서 한 바퀴 돌아도 안 씹힌다', () => {
  const { Sim: S } = W();
  /* 선 위에서 act 칸 하나에 잡기와 다시하기를 같이 태우느라 512 로 나눈다.
     511 다음이 0 인데 그걸 "0번 눌렀다"로 읽으면 그 한 번이 사라진다. */
  assert.strictEqual(S.bumped(0, 511), true, '한 바퀴 돈 것을 못 읽었다');
  assert.strictEqual(S.bumped(5, 5), false);
  assert.strictEqual(S.bumped(6, 5), true);
});

test('열쇠 판은 열쇠 없이는 안 끝난다', () => {
  const { Sim: S, Levels: L, Grid: G } = W();
  const li = keyLevel(L);
  const lv = L.LIST[li];
  let st = S.create(li, ['a']);
  /* 열쇠를 그대로 두고 출입구로 걸어가 본다 — 문이 막고 있어야 한다 */
  st = run(S, st, { a: { x: 1, jseq: 1 } }, 60 * 12);
  assert.strictEqual(st.cleared, false, '열쇠를 안 옮겼는데 판이 끝났다');
  assert.strictEqual(st.door, false, '열쇠를 안 옮겼는데 문이 열렸다');
  assert.ok(st.players.a.x < lv.goal.x, '문을 지나쳐 버렸다: x=' + st.players.a.x.toFixed(0));
  assert.ok(G.PW > 0);
});
