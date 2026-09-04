'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

/* 진짜 DOM 이 없으므로 View.layout 이 "캔버스처럼" 보고 판정하는 조건만
   흉내 낸다 — nodeType:1, tagName:'CANVAS', getContext 함수. 빈 <canvas> 의
   HTML 기본값(300x150)도 그대로 재현해서, 배율이 우연히 1이 되는 경우
   (창 너비 1280 이상) 그 기본값을 "이미 배치됐다"는 증거로 오인하지 않는지
   가 이 테스트의 핵심이다. */
function fakeCanvas() {
  return {
    nodeType: 1,
    tagName: 'CANVAS',
    width: 300, height: 150,          // HTML 이 빈 <canvas> 에 주는 기본값
    style: {},
    getContext: function () { return {}; }
  };
}

function setup(innerWidth, innerHeight, dpr) {
  const w = { innerWidth: innerWidth, innerHeight: innerHeight, devicePixelRatio: dpr || 1 };
  load(['tiles','grid','levels'], w);
  load('view', w);
  return w;
}

test('배율이 정확히 1이 되는 창(1280x760)에서도 캔버스가 실제 크기로 배치된다', () => {
  // 회귀 대상: 초기값 scale=1, dpr=1 과 s===1, d===1 이 우연히 같아,
  // floorCv.width(빈 캔버스 기본값 300, truthy)를 "이미 배치했다"로 오인해
  // 첫 호출부터 조기반환하던 사고. 캔버스가 300x150 으로 굳어 화면에
  // 아무것도 안 그려졌다.
  const w = setup(1280, 760, 1);
  const floorCv = fakeCanvas(), actorsCv = fakeCanvas();

  const s = w.View.layout(floorCv, actorsCv);

  assert.strictEqual(s, 1, '1280x760 창에서는 min(1280/1280, 760/720) = 1이다');
  assert.strictEqual(floorCv.width, 1280, '캔버스가 기본값(300)에 머물면 안 된다');
  assert.strictEqual(floorCv.height, 720);
  assert.strictEqual(actorsCv.width, 1280);
  assert.strictEqual(actorsCv.height, 720);
});

test('같은 배율로 다시 불러도 두 번째부터는 재배치하지 않는다(성능)', () => {
  const w = setup(1280, 760, 1);
  const floorCv = fakeCanvas(), actorsCv = fakeCanvas();

  w.View.layout(floorCv, actorsCv);
  floorCv.width = 999;               // 강제로 바꿔서 재배치 여부를 확인한다
  w.View.layout(floorCv, actorsCv);

  assert.strictEqual(floorCv.width, 999, '배율이 안 바뀌면 다시 칠하지 않는다');
});

test('창 크기가 바뀌면(배율이 달라지면) 다시 배치한다', () => {
  const w = setup(1280, 760, 1);
  const floorCv = fakeCanvas(), actorsCv = fakeCanvas();
  w.View.layout(floorCv, actorsCv);

  w.innerWidth = 1100; w.innerHeight = 650;
  const s = w.View.layout(floorCv, actorsCv);

  assert.ok(s < 1, '더 좁은 창은 더 작은 배율이어야 한다');
  assert.notStrictEqual(floorCv.width, 1280, '배율이 바뀌었으면 다시 그려야 한다');
});

test('캔버스가 아닌 인자로 불러도 모듈 상태를 망가뜨리지 않는다', () => {
  // 확인 코드가 View.layout() 이나 View.layout(1280, 720) 처럼 잘못 불러
  // floorCv 가 숫자로 덮이는 사고가 실제로 있었다. 잘못 불러도 조용히
  // 지금 배율만 돌려주고, 그 다음 정상 호출은 여전히 멀쩡해야 한다.
  const w = setup(1280, 760, 1);
  const floorCv = fakeCanvas(), actorsCv = fakeCanvas();
  w.View.layout(floorCv, actorsCv);
  const before = w.View.scale();

  assert.doesNotThrow(() => w.View.layout());
  assert.doesNotThrow(() => w.View.layout(1280, 720));
  assert.strictEqual(w.View.scale(), before, '잘못된 호출이 배율을 바꾸면 안 된다');

  // 그 다음 정상 호출이 여전히 동작해야 한다 (내부 floorCv 가 숫자로
  // 덮여 있었다면 여기서 cv.width = ... 대입이 조용히 실패하거나 던진다)
  w.innerWidth = 900; w.innerHeight = 600;
  assert.doesNotThrow(() => w.View.layout(floorCv, actorsCv));
  assert.ok(floorCv.width > 0);
});
