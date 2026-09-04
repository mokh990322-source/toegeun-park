'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function W() { return load(['tiles', 'grid', 'levels', 'sim', 'bot']); }
const DT = 1 / 60;

/* 봇만으로 판을 끝까지 돌려 본다. 이 파일의 존재 이유가 이 함수다 —
   경로가 맞는지 눈으로 읽어서는 알 수 없고, 실제 물리로 걷게 해 봐야 안다. */
function playAll(W, lvIndex, n, secs) {
  const { Sim: S, Bot: B } = W;
  const pids = [];
  for (let i = 0; i < n; i++) pids.push('bot' + (i + 1));
  let st = S.create(lvIndex, pids);
  const jobs = B.assign(lvIndex, pids);
  const minds = {};
  pids.forEach(p => { minds[p] = B.mind(); });
  const frames = Math.round((secs || 60) * 60);
  for (let f = 0; f < frames; f++) {
    const inputs = {};
    pids.forEach((p, i) => { inputs[p] = B.step(st, p, jobs[p], minds[p], i, DT); });
    st = S.tick(st, inputs, DT);
    if (st.cleared) return { ok: true, t: f / 60, st };
  }
  return { ok: false, t: secs, st };
}

test('봇 pid 만 봇으로 본다', () => {
  const { Bot: B } = W();
  assert.strictEqual(B.isBot('bot1'), true);
  assert.strictEqual(B.isBot('bot7'), true);
  /* 사람 pid 는 game.js 가 'p' + 난수로 만든다. 절대 겹치면 안 된다 —
     겹치는 순간 호스트 후보에서 사람이 빠진다. */
  assert.strictEqual(B.isBot('pk3f9za'), false);
  assert.strictEqual(B.isBot(''), false);
  assert.strictEqual(B.isBot(null), false);
  assert.strictEqual(B.isBot(undefined), false);
});

test('역할은 앞에서부터, 남으면 출입구로', () => {
  const { Bot: B } = W();
  /* 1번 판은 역할이 없다 */
  assert.deepStrictEqual(B.assign(0, ['bot1', 'bot2']), { bot1: 'exit', bot2: 'exit' });
  /* 2번 판은 받치는 사람이 먼저다 — 봇 하나로 놀면 봇이 받치고 사람이 오른다 */
  assert.deepStrictEqual(B.assign(1, ['bot1']), { bot1: 'boost' });
  assert.deepStrictEqual(B.assign(1, ['bot1', 'bot2', 'bot3']),
    { bot1: 'boost', bot2: 'climb', bot3: 'exit' });
  assert.deepStrictEqual(B.assign(2, ['bot1', 'bot2']), { bot1: 'hold', bot2: 'exit' });
});

test('같은 봇이 늘 같은 역할을 받는다 (호스트가 바뀌어도)', () => {
  const { Bot: B } = W();
  const a = B.assign(1, ['bot3', 'bot1', 'bot2']);
  const b = B.assign(1, ['bot2', 'bot3', 'bot1']);
  assert.deepStrictEqual(a, b, '넘어온 순서가 달라도 같은 답이 나와야 한다');
});

test('봇 입력은 사람 입력과 모양이 같다', () => {
  const { Sim: S, Bot: B } = W();
  const st = S.create(0, ['bot1']);
  const o = B.step(st, 'bot1', 'exit', B.mind(), 0, DT);
  assert.deepStrictEqual(Object.keys(o).sort(), ['jseq', 'x']);
  assert.ok(o.x >= -1 && o.x <= 1);
  assert.ok(typeof o.jseq === 'number');
});

test('판에 없는 봇을 조종해도 안 죽는다', () => {
  const { Sim: S, Bot: B } = W();
  const st = S.create(0, ['a']);
  const o = B.step(st, 'bot9', 'exit', B.mind(), 0, DT);
  assert.deepStrictEqual(o, { x: 0, jseq: 0 });
});

test('봇은 판을 고치지 않는다', () => {
  const { Sim: S, Bot: B } = W();
  const st = S.create(0, ['bot1']);
  const before = JSON.stringify(st);
  B.step(st, 'bot1', 'exit', B.mind(), 0, DT);
  assert.strictEqual(JSON.stringify(st), before);
});

/* ---- 여기부터가 본론 ---- */

for (const n of [1, 2, 3, 5, 8]) {
  test('1번 첫 출근 — 봇 ' + n + '명이 끝낸다', () => {
    const r = playAll(W(), 0, n, 60);
    assert.ok(r.ok, '못 깼다. 60초 뒤 상태: ' + JSON.stringify(r.st.players));
  });
}

for (const n of [2, 3, 5, 8]) {
  test('2번 목마 — 봇 ' + n + '명이 끝낸다', () => {
    const r = playAll(W(), 1, n, 60);
    assert.ok(r.ok, '못 깼다. 60초 뒤 상태: ' + JSON.stringify(r.st.players));
  });
}

for (const n of [1, 2, 3, 5, 8]) {
  test('3번 누가 남을래 — 봇 ' + n + '명이 끝낸다', () => {
    const r = playAll(W(), 2, n, 60);
    assert.ok(r.ok, '못 깼다. 60초 뒤 상태: ' + JSON.stringify(r.st.players));
  });
}

test('2번 판은 봇 혼자서는 못 깬다 (목마가 필요하다는 규칙이 그대로다)', () => {
  const r = playAll(W(), 1, 1, 30);
  assert.strictEqual(r.ok, false, '혼자 깼다면 이 판의 뜻이 사라진 것이다');
});

test('받치는 봇은 문이 열릴 때까지 받침 자리를 안 뜬다', () => {
  const { Sim: S, Bot: B, Levels: L } = W();
  let st = S.create(1, ['bot1']);
  const m = B.mind();
  let minX = 1e9, maxX = -1e9;
  for (let f = 0; f < 60 * 12; f++) {
    st = S.tick(st, { bot1: B.step(st, 'bot1', 'boost', m, 0, DT) }, DT);
    if (f > 60 * 3) {
      const cx = st.players.bot1.x + L.PW / 2;
      minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
    }
  }
  assert.ok(Math.abs(minX - 340) < 12 && Math.abs(maxX - 340) < 12,
    '받침 자리(340)를 벗어났다: ' + minX.toFixed(0) + '~' + maxX.toFixed(0));
});

test('버튼을 밟은 봇은 남이 문을 지날 때까지 안 뜬다', () => {
  const { Sim: S, Bot: B, Levels: L } = W();
  /* 문 왼쪽에 가만히 서 있는 동료를 하나 둔다 — 아무도 안 지나갔으니
     버튼을 밟은 봇은 계속 밟고 있어야 한다. */
  let st = S.create(2, ['bot1', 'z']);
  st.players.z.x = 300; st.players.z.y = 644;
  const m = B.mind();
  for (let f = 0; f < 60 * 20; f++) {
    st = S.tick(st, { bot1: B.step(st, 'bot1', 'hold', m, 0, DT), z: { x: 0, jseq: 0 } }, DT);
    st.players.z.x = 300; st.players.z.y = 644;    // 절대 안 움직이는 동료
  }
  assert.strictEqual(st.door, true, '동료가 아직 문 앞인데 버튼에서 내려왔다');
  assert.ok(W().Grid.onButton(L.LIST[2], st.players.bot1.x, st.players.bot1.y),
    '버튼 위가 아니다: x=' + st.players.bot1.x.toFixed(0));
});

/* ---- 봇이 드러낸 시뮬레이션 버그 두 개 ---- */

test('문이 닫힐 때 문 칸에 있던 사람은 빠져나온다', () => {
  const { Sim: S, Levels: L } = W();
  const lv = L.LIST[2];
  const di = lv.grid.indexOf('D');
  const dcx = (di % L.COLS) * L.TILE;
  let st = S.create(2, ['a']);
  /* 문이 열린 사이 문턱 한가운데 서 있다가 문이 닫힌 상황 */
  st.players.a.x = dcx + 6; st.players.a.y = 644; st.players.a.face = 1;
  st.doorT = 0; st.door = false;
  assert.ok(W().Grid.hits(lv, st.players.a.x, st.players.a.y, { door: false, cr: {} }), '시험 전제가 틀렸다');

  st = S.tick(st, { a: { x: 1, jseq: 0 } }, DT);
  assert.ok(!W().Grid.hits(lv, st.players.a.x, st.players.a.y, { door: st.door, cr: st.cr }),
    '벽 안에 박힌 채로 남았다: x=' + st.players.a.x.toFixed(1));

  /* 빠져나온 뒤에는 정상적으로 걸어야 한다 */
  const x0 = st.players.a.x;
  for (let i = 0; i < 20; i++) st = S.tick(st, { a: { x: 1, jseq: 0 } }, DT);
  assert.ok(st.players.a.x > x0, '빠져나오고도 못 움직인다');
});

test('출입구 안에서는 서로 밀어내지 않는다 (8명이 다 들어가야 하니까)', () => {
  const { Sim: S, Levels: L } = W();
  const lv = L.LIST[0];
  const pids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  let st = S.create(0, pids);
  /* 출입구(두 칸=80px)에 여덟을 넣는다. 몸이 28px 이라 밀어내기를 그대로
     두면 서로를 밖으로 밀어내 전원 도착이 영원히 성립하지 않는다. */
  pids.forEach((p, i) => {
    st.players[p].x = lv.goal.x + 4 + i * 2;
    st.players[p].y = lv.goal.y + lv.goal.h - L.PH;
    st.players[p].vy = 0;
  });
  for (let i = 0; i < 30; i++) st = S.tick(st, { }, DT);
  assert.strictEqual(st.cleared, true,
    '여덟이 다 출입구에 있는데 안 끝났다: ' +
    pids.map(p => p + (st.players[p].done ? '○' : '✗')).join(' '));
});
