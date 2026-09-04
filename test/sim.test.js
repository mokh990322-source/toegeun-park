'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function W() { return load(['tiles', 'grid', 'levels', 'sim']); }
const DT = 1 / 60;

function run(S, st, inputs, n) {
  for (let i = 0; i < n; i++) st = S.tick(st, inputs, DT);
  return st;
}
function idle(pids) {
  const o = {};
  pids.forEach(p => { o[p] = { x: 0, jseq: 0 }; });
  return o;
}

test('상수가 말이 되는 범위다', () => {
  const { Sim: S, Levels: L } = W();
  const h = S.JUMP_V * S.JUMP_V / (2 * S.GRAVITY);
  assert.ok(h > L.TILE * 3 && h < L.TILE * 4.5,
    '점프 도달 높이가 3~4.5칸이어야 판 설계가 성립한다: ' + h.toFixed(0) + 'px');
  assert.ok(S.COYOTE > 0 && S.COYOTE < 0.3);
  assert.ok(S.JUMP_BUF > 0 && S.JUMP_BUF < 0.3);
  assert.ok(S.HEAD_BAND > 0);
});

test('create 는 판과 플레이어를 세운다', () => {
  const { Sim: S } = W();
  const st = S.create(0, ['a', 'b']);
  assert.strictEqual(st.lv, 0);
  assert.strictEqual(Object.keys(st.players).length, 2);
  assert.strictEqual(st.door, false);
  assert.strictEqual(st.cleared, false);
  assert.strictEqual(st.players.a.sup, 0);
});

test('tick 은 입력 상태를 고치지 않는다', () => {
  const { Sim: S } = W();
  const st = S.create(0, ['a']);
  const y0 = st.players.a.y;
  S.tick(st, idle(['a']), DT);
  assert.strictEqual(st.players.a.y, y0);
});

test('중력으로 떨어져 땅에 선다', () => {
  const { Sim: S, Levels: L } = W();
  let st = S.create(0, ['a']);
  st = run(S, st, idle(['a']), 90);
  const p = st.players.a;
  assert.strictEqual(p.sup, 1, '땅에 받쳐져 있어야 한다');
  assert.strictEqual(p.vy, 0);
  assert.strictEqual(W().Grid.hits(L.LIST[0], p.x, p.y, {}), false, '벽 안에 있으면 안 된다');
});

test('가만히 있으면 x 가 안 흐른다', () => {
  const { Sim: S } = W();
  let st = S.create(0, ['a']);
  const x0 = st.players.a.x;
  st = run(S, st, idle(['a']), 120);
  assert.strictEqual(st.players.a.x, x0,
    'moveX(0) 이 y 를 돌려주던 사고가 있었다. 서 있기만 해도 x 가 y 로 덮어써졌다');
});

test('좌우 입력으로 걷고 바라보는 쪽이 바뀐다', () => {
  const { Sim: S } = W();
  let st = S.create(0, ['a']);
  st = run(S, st, idle(['a']), 60);
  const x0 = st.players.a.x;
  st = run(S, st, { a: { x: 1, jseq: 0 } }, 30);
  assert.ok(st.players.a.x > x0, '오른쪽으로 가야 한다');
  assert.strictEqual(st.players.a.face, 1);
  st = run(S, st, { a: { x: -1, jseq: 0 } }, 30);
  assert.strictEqual(st.players.a.face, -1);
});

test('점프는 누른 횟수로 오고 도달 높이가 맞는다', () => {
  const { Sim: S } = W();
  let st = S.create(0, ['a']);
  st = run(S, st, idle(['a']), 60);
  const ground = st.players.a.y;
  st = S.tick(st, { a: { x: 0, jseq: 1 } }, DT);
  let top = st.players.a.y;
  for (let i = 0; i < 60; i++) {
    st = S.tick(st, { a: { x: 0, jseq: 1 } }, DT);
    top = Math.min(top, st.players.a.y);
  }
  const rise = ground - top;
  const want = S.JUMP_V * S.JUMP_V / (2 * S.GRAVITY);
  assert.ok(Math.abs(rise - want) < 12, '올라간 높이 ' + rise.toFixed(0) + ' 가 이론값 ' + want.toFixed(0) + ' 과 다르다');
});

test('공중에서는 점프가 안 된다', () => {
  const { Sim: S } = W();
  let st = S.create(0, ['a']);
  st = run(S, st, idle(['a']), 60);
  let seq = 1;
  st = S.tick(st, { a: { x: 0, jseq: seq } }, DT);      // 1단 점프
  /* 떨어지기 시작할 때까지 기다린다. 올라가는 중에 재면 "1차 점프로 아직
     상승 중"과 "2단 점프"를 구분할 수 없다. */
  for (let i = 0; i < 120 && st.players.a.vy <= 0; i++) {
    st = S.tick(st, { a: { x: 0, jseq: seq } }, DT);
  }
  assert.ok(st.players.a.vy > 0, '떨어지는 상태를 못 만들었다');
  assert.strictEqual(st.players.a.sup, 0, '아직 공중이어야 한다');
  st = S.tick(st, { a: { x: 0, jseq: ++seq } }, DT);    // 공중에서 한 번 더
  assert.ok(st.players.a.vy > 0, '공중에서 다시 점프가 됐다 (vy 가 음수로 튀었다)');
});

test('남의 머리 위에 올라선다 (빠르게 떨어져도)', () => {
  const { Sim: S, Levels: L } = W();
  let st = S.create(1, ['a', 'b']);
  st.players.b.x = 400; st.players.b.y = 640;
  st.players.a.x = 400; st.players.a.y = 200;          // 한참 위에서 떨어뜨린다
  st = run(S, st, idle(['a', 'b']), 120);
  const a = st.players.a, b = st.players.b;
  assert.strictEqual(a.sup, 2, '남을 밟은 것으로 기록돼야 한다');
  assert.ok(Math.abs((b.y - a.y) - L.PH) < 1.5,
    '정확히 몸 높이만큼 위에 서야 한다: 차이 ' + (b.y - a.y).toFixed(1));
});

test('머리 밟기가 낙하 속도와 무관하다', () => {
  const { Sim: S, Levels: L } = W();
  /* 띠로 재면 최고 낙하속도(한 프레임 20px)에서 그냥 뚫고 지나간다.
     "직전엔 위, 지금은 아래"로 재야 속도와 무관해진다. */
  [100, 300, 500].forEach(function (dropY) {
    let st = S.create(1, ['a', 'b']);
    st.players.b.x = 400; st.players.b.y = 640;
    st.players.a.x = 400; st.players.a.y = dropY;
    st = run(S, st, idle(['a', 'b']), 150);
    assert.strictEqual(st.players.a.sup, 2, dropY + '에서 떨어뜨리면 뚫고 지나간다');
  });
});

test('올라가는 중에는 남에게 안 얹힌다', () => {
  const { Sim: S } = W();
  let st = S.create(1, ['a', 'b']);
  st = run(S, st, idle(['a', 'b']), 60);
  st.players.a.x = st.players.b.x;
  st.players.a.vy = -400;                               // 위로 솟는 중
  st.players.a.y = st.players.b.y - 10;
  st = S.tick(st, idle(['a', 'b']), DT);
  assert.notStrictEqual(st.players.a.sup, 2);
});

test('버튼을 밟으면 문이 열리고, 뗀 뒤에도 잠깐 열려 있다가 닫힌다', () => {
  const { Sim: S, Levels: L } = W();
  const lv = L.LIST[2];
  const bi = lv.grid.indexOf('B');
  const bx = (bi % L.COLS) * L.TILE + (L.TILE - L.PW) / 2;
  const by = Math.floor(bi / L.COLS) * L.TILE - L.PH;
  let st = S.create(2, ['a']);
  st.players.a.x = bx; st.players.a.y = by;
  st = run(S, st, idle(['a']), 10);
  assert.strictEqual(st.door, true, '버튼 위에 섰는데 문이 안 열린다');
  assert.ok(st.doorT > 0, '누르고 있는 동안 타이머가 안 채워졌다');

  st.players.a.x = bx + 300;                            // 버튼에서 내려온다
  st = S.tick(st, idle(['a']), DT);
  assert.strictEqual(st.door, true,
    '버튼을 뗀 그 프레임에 바로 닫히면 누른 사람은 구조적으로 못 나간다');

  /* 눈금(DOOR_LINGER)의 절반만 지나면 아직 열려 있어야 하고, 다 지나면
     닫혀야 한다 — 값을 하드코딩하지 않고 Sim 의 실제 상수로 잰다. */
  const half = Math.floor((S.DOOR_LINGER / 2) / DT);
  st = run(S, st, idle(['a']), half);
  assert.strictEqual(st.door, true, '눈금의 절반이 지났는데 벌써 닫혔다');
  assert.ok(st.doorT > 0 && st.doorT < S.DOOR_LINGER,
    '남은 시간이 줄어들고 있어야 한다: ' + st.doorT);

  const rest = Math.ceil((S.DOOR_LINGER / DT)) - half + 5;
  st = run(S, st, idle(['a']), rest);
  assert.strictEqual(st.door, false, '눈금이 다 지났는데도 문이 안 닫혔다');
  assert.strictEqual(st.doorT, 0);
});

test('전원이 출입구에 있어야 판이 끝난다', () => {
  const { Sim: S, Levels: L } = W();
  const lv = L.LIST[0];
  let st = S.create(0, ['a', 'b']);
  st.players.a.x = lv.goal.x + 4; st.players.a.y = lv.goal.y;
  st = S.tick(st, idle(['a', 'b']), DT);
  assert.strictEqual(st.cleared, false, '한 명만 도착했는데 끝났다');
  st.players.b.x = lv.goal.x + 30; st.players.b.y = lv.goal.y;
  st = S.tick(st, idle(['a', 'b']), DT);
  assert.strictEqual(st.cleared, true, '전원이 도착했는데 안 끝났다');
});

test('떨어지면 자기 시작점에서 되살아난다', () => {
  const { Sim: S, Levels: L } = W();
  let st = S.create(0, ['a', 'b']);
  const start = { x: st.players.a.x, y: st.players.a.y };
  const bWas = { x: st.players.b.x, y: st.players.b.y };
  st.players.a.y = L.H + 200;
  st = S.tick(st, idle(['a', 'b']), DT);
  assert.ok(Math.abs(st.players.a.x - start.x) < 1 && Math.abs(st.players.a.y - start.y) < 1,
    '떨어진 사람이 시작점으로 안 돌아왔다');
  assert.ok(Math.abs(st.players.b.x - bWas.x) < 1, '떨어지지 않은 사람까지 되돌리면 안 된다');
});

test('adopt 는 승계 뒤 유령 점프를 막는다', () => {
  const { Sim: S } = W();
  let st = S.create(0, ['a']);
  st = run(S, st, idle(['a']), 60);
  /* 스냅샷은 jseq 를 안 담으므로 이어받은 판은 0 이다.
     입력이 500 이라고 말하면 그대로 500번 점프를 재생하려 든다. */
  st.players.a.jseq = 0;
  const inputs = { a: { x: 0, jseq: 500 } };
  const y0 = st.players.a.y;
  const adopted = S.adopt(st, inputs);
  assert.strictEqual(adopted.players.a.jseq, 500);
  const after = run(S, adopted, inputs, 10);
  assert.ok(Math.abs(after.players.a.y - y0) < 2, 'adopt 뒤에도 유령 점프가 났다');
  /* 진짜 새 입력은 여전히 먹혀야 한다 */
  const jumped = run(S, adopted, { a: { x: 0, jseq: 501 } }, 8);
  assert.ok(jumped.players.a.y < y0 - 10, 'adopt 가 진짜 입력까지 막았다');
});

test('adopt 는 원본을 고치지 않는다', () => {
  const { Sim: S } = W();
  const st = S.create(0, ['a']);
  st.players.a.jseq = 3;
  S.adopt(st, { a: { x: 0, jseq: 99 } });
  assert.strictEqual(st.players.a.jseq, 3);
});

test('join / leave', () => {
  const { Sim: S } = W();
  let st = S.create(0, ['a']);
  st = S.join(st, 'b', 1);
  assert.ok(st.players.b);
  st = S.join(st, 'a', 0);
  assert.ok(st.players.a, '이미 있는 사람을 다시 넣어도 안 사라진다');
  st = S.leave(st, 'b');
  assert.strictEqual(st.players.b, undefined);
});

test('사람이 겹쳐 서면 가로로 밀려난다', () => {
  const { Sim: S, Levels: L } = W();
  let st = S.create(0, ['a', 'b']);
  st = run(S, st, idle(['a', 'b']), 60);
  st.players.b.x = st.players.a.x;
  st.players.b.y = st.players.a.y;
  st = run(S, st, idle(['a', 'b']), 60);
  const gap = Math.abs(st.players.a.x - st.players.b.x);
  assert.ok(gap > L.PW * 0.6, '겹친 채로 남아 있다: ' + gap.toFixed(1));
});

test('키 순서가 달라도 결과가 같다', () => {
  const { Sim: S } = W();
  function play(order) {
    /* 순서만 바꾼다. 초기 위치는 누가 먼저 들어가든 똑같아야
       "순서 때문에 갈리는가"를 재는 시험이 된다. */
    let st = S.create(1, order);
    st.players.a.x = 400; st.players.a.y = 300;
    st.players.b.x = 400; st.players.b.y = 640;
    for (let i = 0; i < 150; i++) st = S.tick(st, idle(order), DT);
    return ['a', 'b'].map(p => p + ':' + st.players[p].x.toFixed(2) + ',' + st.players[p].y.toFixed(2)).join('|');
  }
  assert.strictEqual(play(['a', 'b']), play(['b', 'a']),
    '사람마다 다른 결과를 보면 화면이 갈린다');
});

test('nextLevel 은 판을 넘기고 마지막에서는 그대로 둔다', () => {
  const { Sim: S, Levels: L } = W();
  let st = S.create(0, ['a']);
  st = S.nextLevel(st);
  assert.strictEqual(st.lv, 1);
  let last = S.create(L.LIST.length - 1, ['a']);
  assert.strictEqual(S.nextLevel(last).lv, L.LIST.length - 1);
});

test('큰 dt 에도 바닥을 뚫지 않는다', () => {
  const { Sim: S, Levels: L } = W();
  let st = S.create(0, ['a']);
  st = S.tick(st, idle(['a']), 2.0);                    // 배경 탭에서 깨어난 프레임
  const p = st.players.a;
  assert.strictEqual(W().Grid.hits(L.LIST[0], p.x, p.y, {}), false, '벽 안에 박혔다');
  assert.ok(p.y < L.H + 80, '맵 밖으로 빠졌다');
});

/* ---- 떨어지는 것과 가시는 대가가 다르다 ---- */

test('떨어져도 라운드는 안 되돌아간다 (그 사람만 시작점으로)', () => {
  const { Sim: S, Levels: L } = W();
  let st = S.create(0, ['a', 'b']);
  st = run(S, st, idle(['a', 'b']), 60);
  const bWas = { x: st.players.b.x, y: st.players.b.y };
  const start = { x: st.players.a.x, y: st.players.a.y };

  /* a 를 화면 밖으로 떨어뜨린다. 라운드 시계는 이미 1초쯤 흘렀다. */
  const rtWas = st.rt;
  st.players.a.y = L.H + 200;
  st = S.tick(st, idle(['a', 'b']), DT);

  assert.ok(Math.abs(st.players.a.x - start.x) < 1 && Math.abs(st.players.a.y - start.y) < 1,
    '떨어진 사람이 시작점으로 안 돌아왔다');
  assert.ok(Math.abs(st.players.b.x - bWas.x) < 1 && Math.abs(st.players.b.y - bWas.y) < 1,
    '떨어지지 않은 사람까지 되돌리면 안 된다');
  assert.ok(st.rt > rtWas, '라운드 시계가 0 으로 돌아갔다 — 떨어진 건 라운드 재시작이 아니다');
  assert.strictEqual(st.freeze, 0, '떨어졌다고 전원을 멈춰 세우면 안 된다');
  assert.strictEqual(st.fail, '', '떨어진 것은 "다시!" 가 아니다');
});

test('가시에 닿으면 라운드가 다 같이 처음부터', () => {
  const { Sim: S, Levels: L, Grid: G, Tiles: T } = W();
  const lvIndex = 5;                       // 6번 가시밭
  const lv = L.LIST[lvIndex];
  const i = lv.grid.indexOf(T.SPIKE);
  let st = S.create(lvIndex, ['a', 'b']);
  const bHome = { x: st.players.b.x, y: st.players.b.y };
  /* b 를 시작점에서 멀리, 가시 없는 자리에 놓는다. 시작점에 그대로 두면
     되돌아왔는지 아닌지 구분할 수가 없다. (걸어가게 하면 도중에 가시를
     밟아서 그것부터 라운드를 되돌린다 — 그래서 자리를 직접 옮긴다.) */
  st.players.b.x = 25 * L.TILE + 6;
  st = run(S, st, idle(['a', 'b']), 40);
  assert.ok(Math.abs(st.players.b.x - bHome.x) > 60, '시험 전제: b 가 시작점에서 떨어져 있어야 한다');
  const rtWas = st.rt;
  assert.ok(rtWas > 0.5, '시험 전제: 라운드 시계가 흐르고 있어야 한다');

  /* a 를 가시 칸 한가운데로 옮긴다 */
  st.players.a.x = (i % L.COLS) * L.TILE + (L.TILE - L.PW) / 2;
  st.players.a.y = Math.floor(i / L.COLS) * L.TILE + 2;
  assert.ok(G.inHazard(lv, st.players.a.x, st.players.a.y, true), '시험 전제가 틀렸다');

  st = S.tick(st, idle(['a', 'b']), DT);
  assert.strictEqual(st.rt, 0, '라운드 시계가 0 으로 돌아가야 한다');
  assert.strictEqual(st.fail, 'a', '누구 때문인지 남아야 한다');
  assert.ok(st.freeze > 0, '왜 튕겼는지 볼 시간을 줘야 한다');
  assert.ok(Math.abs(st.players.b.x - bHome.x) < 1 && Math.abs(st.players.b.y - bHome.y) < 1,
    '가시는 팀이 같이 물린다 — 안 밟은 사람도 시작점으로 돌아가야 한다: ' +
    Math.round(st.players.b.x) + ',' + Math.round(st.players.b.y));
});

test('되살아나는 자리는 판마다 안전하다 (가시 위가 아니다)', () => {
  const { Levels: L, Grid: G } = W();
  /* 떨어진 사람이 돌아오는 자리가 가시면 돌아오자마자 또 죽는다.
     그게 라운드 재시작이면 영원히 반복된다 — 19번 판에서 실제로 그랬다. */
  L.LIST.forEach((lv, i) => {
    lv.spawns.forEach((s, k) => {
      let y = s.y;
      for (let n = 0; n < 200; n++) {
        const r = G.moveY(lv, s.x, y, 8, { door: false, cr: {} });
        y = r.y;
        if (r.hit) break;
      }
      assert.ok(!G.inHazard(lv, s.x, y, true) && !G.inHazard(lv, s.x, y, false),
        (i + 1) + '번(' + lv.name + ') ' + k + '번 시작 자리가 가시에 닿는다');
    });
  });
});
