'use strict';
/* ============================================================
   "닿을 수 있나"가 아니라 "전원이 닿을 수 있나".

   이전 시험은 출입구에 아무나 한 명 닿으면 통과였다(실제로 마지막
   줄이 assert.ok(true) 였던 적도 있다). 그래서 목마(2번 판)에서
   받쳐 준 사람이 영원히 못 나가는 것과, 누가 남을래(3번 판)에서
   버튼 누른 사람이 못 나가는 것을 둘 다 실어 보냈다.

   여기서는 실제 Sim 상수(JUMP_V, GRAVITY, COYOTE, DOOR_LINGER)로
   "혼자 닿는 높이", "업혀서 닿는 높이", "문이 열려 있는 시간"을 재고,
   testlib/reach.js 의 그래프 탐색으로 세 가지를 확인한다:
     - 혼자 닿는 판(1번)은 정말 혼자 닿는가
     - 업혀야만 닿는 자리(2번의 버튼)는 정말 혼자서는 안 되는가
     - 문이 열린 뒤에는, 업힌 적 없는 사람(마지막 사람)도 정말 나가는가
     - 버튼을 누른 사람도 문이 닫히기 전에 정말 도착하는가(DOOR_LINGER)
   ============================================================ */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');
const R = require('../testlib/reach');

function W() { return load(['levels', 'sim']); }

function rises(S, L) {
  const aloneRise = S.JUMP_V * S.JUMP_V / (2 * S.GRAVITY);
  return { aloneRise: aloneRise, boostRise: aloneRise + L.PH };
}

test('1번 판(첫 출근)은 혼자서도 모든 스폰에서 출입구까지 닿는다', () => {
  const { Levels: L, Sim: S } = W();
  const lv = L.LIST[0];
  const { aloneRise } = rises(S, L);
  const goals = R.goalNodes(L, lv, false);
  assert.ok(goals.length, '출입구 자리를 못 찾았다');

  for (let i = 0; i < 8; i++) {
    const start = R.spawnNode(L, lv, i);
    const seen = R.reachable(L, S, lv, false, aloneRise, [start]);
    const ok = goals.some(g => seen[R.key(g.cx, g.sr)]);
    assert.ok(ok, i + '번 스폰에서 혼자 출입구에 못 닿는다 — 1번 판은 조작을 익히는 판이라 혼자 되어야 한다');
  }
});

test('2번 판(목마)은 혼자서는 턱 위(버튼)에도 출입구에도 못 닿는다', () => {
  const { Levels: L, Sim: S } = W();
  const lv = L.LIST[1];
  const { aloneRise } = rises(S, L);
  const start = R.spawnNode(L, lv, 0);
  const seen = R.reachable(L, S, lv, false, aloneRise, [start]);

  const goals = R.goalNodes(L, lv, false);
  assert.ok(!goals.some(g => seen[R.key(g.cx, g.sr)]), '혼자서 출입구에 닿으면 "목마"의 논지가 없다');

  const buttons = R.buttonNodes(L, lv, false);
  assert.ok(buttons.length, '2번 판에 버튼이 있어야 한다(턱 위 우회로)');
  assert.ok(!buttons.some(b => seen[R.key(b.cx, b.sr)]),
    '혼자서 턱 위 버튼에 닿으면 남의 머리를 밟을 이유가 없다');
});

test('2번 판(목마)은 업혀야만 턱 위 버튼에 닿는다', () => {
  const { Levels: L, Sim: S } = W();
  const lv = L.LIST[1];
  const { boostRise } = rises(S, L);
  const start = R.spawnNode(L, lv, 0);
  const seen = R.reachable(L, S, lv, false, boostRise, [start]);
  const buttons = R.buttonNodes(L, lv, false);
  assert.ok(buttons.some(b => seen[R.key(b.cx, b.sr)]),
    '업혀도 버튼에 안 닿으면 애초에 깰 방법이 없다 — 턱 높이(약 4칸)가 aloneRise+몸높이 안에 있어야 한다');
});

test('3번 판(누가 남을래)은 문이 닫혀 있으면 버튼은 혼자 눌러도 출입구엔 못 닿는다', () => {
  const { Levels: L, Sim: S } = W();
  const lv = L.LIST[2];
  const { aloneRise } = rises(S, L);
  const start = R.spawnNode(L, lv, 0);

  const buttons = R.buttonNodes(L, lv, false);
  assert.ok(buttons.length, '3번 판엔 버튼이 있어야 한다');
  const seenClosed = R.reachable(L, S, lv, false, aloneRise, [start]);
  assert.ok(buttons.some(b => seenClosed[R.key(b.cx, b.sr)]),
    '누구나 버튼은 밟을 수 있어야 한다(업기 없이) — 안 그러면 "누가 남을래"가 아니라 "누가 못 올라가나"가 된다');

  const goalsClosed = R.goalNodes(L, lv, false);
  assert.ok(!goalsClosed.some(g => seenClosed[R.key(g.cx, g.sr)]),
    '문이 닫혀 있는데 출입구에 닿으면 문이 있을 이유가 없다');
});

test('3번 판(누가 남을래)은 문이 열리면 출입구에 닿는다', () => {
  const { Levels: L, Sim: S } = W();
  const lv = L.LIST[2];
  const { aloneRise } = rises(S, L);
  const start = R.spawnNode(L, lv, 0);
  const seenOpen = R.reachable(L, S, lv, true, aloneRise, [start]);
  const goalsOpen = R.goalNodes(L, lv, true);
  assert.ok(goalsOpen.some(g => seenOpen[R.key(g.cx, g.sr)]), '문이 열렸는데도 출입구에 못 닿는다');
});

/* ── 여기부터가 이번에 새로 생긴, 진짜로 물어야 했던 질문 ──────────
   "닿을 수 있나"가 아니라 "업어 준 사람(마지막 사람, 밟고 설 사람이
   없다)도 결국 나가는가"다. everyoneCanFinish 의 판정 순서 자체가
   그 질문이다(reach.js 주석 참고) — 여기서는 그 결과만 확인한다. */
test('세 판 모두 — 업어 준 사람(마지막 사람)까지 포함해 전원이 나갈 수 있다', () => {
  const { Levels: L, Sim: S } = W();
  L.LIST.forEach((lv, i) => {
    const r = R.everyoneCanFinish(L, S, lv);
    assert.ok(r.ok, i + '번 판(' + lv.name + '): ' + r.reason);
  });
});

/* 문이 버튼을 뗀 뒤에도 잠깐 열려 있는 건(DOOR_LINGER), "누른 사람도
   나갈 여유"를 주려는 것이다. 그 여유가 실제로 충분한지는 감이 아니라
   버튼→출입구까지 실제 거리·속도·중력으로 잰 시간과 비교해야 한다.
   하드코딩하지 않고 Sim.DOOR_LINGER 를 그대로 기준으로 쓴다. */
test('버튼이 있는 판에서, 누른 사람도 문이 닫히기 전에 출입구에 닿는다', () => {
  const { Levels: L, Sim: S } = W();
  const { aloneRise } = rises(S, L);
  L.LIST.forEach((lv, i) => {
    const buttons = R.buttonNodes(L, lv, false);
    if (!buttons.length) return;                    // 버튼 없는 판(1번)은 해당 없음
    const goalsOpen = R.goalNodes(L, lv, true);
    const worst = buttons.reduce((max, b) => {
      const t = R.shortestTime(L, S, lv, true, aloneRise, b, goalsOpen);
      return Math.max(max, t);
    }, 0);
    assert.ok(isFinite(worst), i + '번 판: 문이 열려도 버튼 자리에서 출입구로 가는 길이 없다');
    assert.ok(worst < S.DOOR_LINGER,
      i + '번 판: 버튼에서 출입구까지 ' + worst.toFixed(2) + '초 걸리는데 ' +
      'DOOR_LINGER 가 ' + S.DOOR_LINGER + '초뿐이다 — 누른 사람이 문에 낀다');
  });
});
