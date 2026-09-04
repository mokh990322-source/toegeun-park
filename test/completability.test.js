'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../testlib/reach');

/* 20판이 실제로 깨지는지 검사한다.

   판이 셋일 때는 눈으로 읽어도 됐지만 스물이면 안 된다. 실제로 이 검사기가
   잡아낸 것들: 시작 자리가 발판 밖, 컨베이어를 발밑이 아니라 몸통 자리에
   놓음, 출입구가 점프 한 번보다 높은 자리에 있음. 셋 다 격자만 보면
   멀쩡해 보인다.

   검사기가 어떻게 판단하는지는 testlib/reach.js 머리말에 있다. 요점은
   "통과했으니 반드시 깬다"가 아니라 "막혔으니 반드시 못 깬다"라는 것 —
   그물로는 그게 맞는 방향이다. */

const w = R.W();

w.Levels.LIST.forEach(function (lv, i) {
  test((i + 1) + '번 ' + lv.name + ' — ' + lv.min + '명으로 출입구까지 닿는다', () => {
    const r = R.check(w, i, lv.min);
    assert.deepStrictEqual(r.problems, [],
      (i + 1) + '번(' + lv.name + ') 문제:\n  ' + r.problems.join('\n  '));
  });
});

test('AI 동료가 함께 갈 수 있는 1~3판은 봇 경로가 맞춰져 있다', () => {
  /* game.js 의 AI_LEVELS 와 bot.js 의 ROUTES 가 어긋나면, AI 를 넣은 방이
     경로 없는 판으로 넘어가 봇이 출입구에 영영 못 온다 — 전원 도착
     조건이라 판 자체가 안 끝난다. 숫자 하나로 묶여 있으니 시험도 같이 본다. */
  const b = require('../testlib/load').load(['tiles', 'grid', 'levels', 'sim', 'bot']);
  for (let i = 0; i < 3; i++) {
    const jobs = b.Bot.JOBS[i];
    assert.ok(jobs !== undefined, (i + 1) + '번 판에 봇 역할 목록이 없다');
    const routes = b.Bot.ROUTES[i];
    assert.ok(routes && routes.exit, (i + 1) + '번 판에 봇 경로가 없다');
    (jobs || []).forEach(function (j) {
      assert.ok(routes[j], (i + 1) + '번 판의 역할 "' + j + '" 에 경로가 없다');
    });
  }
  assert.strictEqual(b.Bot.ROUTES[3], undefined,
    '4번 판에 봇 경로가 생겼다면 AI_LEVELS 도 같이 올려야 한다');
});

test('난이도 곡선 — 앞은 혼자서도 되고, 뒤는 사람이 필요하고, 셋이면 다 깬다', () => {
  const L = w.Levels.LIST;
  /* 새 장치가 나오는 판은 일부러 min 을 낮춘다(혼자 배우게). 그래서 min 이
     계단처럼 오르지는 않는다. 대신 지켜야 하는 건 이 셋이다. */
  assert.strictEqual(L[0].min, 1, '1번은 혼자서도 되어야 한다 — 첫 판에서 사람을 모으라고 하면 안 된다');
  assert.strictEqual(L[19].min, 3, '마지막 판은 셋이어야 한다');

  const maxMin = Math.max.apply(null, L.map(lv => lv.min));
  assert.strictEqual(maxMin, 3,
    '어떤 판도 셋을 넘게 요구하면 안 된다 — 세 명이 모이면 20판을 다 깰 수 있어야 한다');

  const early = L.slice(0, 6).reduce((a, lv) => a + lv.min, 0);
  const late = L.slice(14).reduce((a, lv) => a + lv.min, 0);
  assert.ok(late > early, '뒤쪽 여섯 판이 앞쪽 여섯 판보다 사람을 더 요구해야 한다: ' + early + ' vs ' + late);
});
