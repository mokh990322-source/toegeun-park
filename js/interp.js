/* ============================================================
   오버워크드 — 보간과 예측

   10Hz 로 오는 스냅샷을 60Hz 화면으로 편다. 이 게임에서 가장 미묘한 코드라
   화면에서 떼어내 순수 함수로 두었다 — 그리기에 섞으면 "왜 캐릭터가 떨리지"를
   눈으로 쫓아야 하는데, 8명이 붙은 자리에서 할 수 있는 일이 아니다.

   ── 남의 캐릭터: 150ms 늦게 보여 준다 ──────────────────
   스냅샷 간격이 100ms 이고 가끔 한 번씩 누락된다. 지금 막 도착한 값을 바로
   그리면 다음 것이 늦을 때마다 멈췄다 튄다. 항상 150ms 과거를 그리면 손에
   늘 두 개가 있어서 그 사이를 부드럽게 지나간다. 협동 게임이라 남이 150ms
   늦게 보이는 건 아무도 눈치채지 못한다.

   ── 내 캐릭터: 먼저 움직이고 나중에 맞춘다 ─────────────
   내 입력이 호스트를 거쳐 돌아오려면 150ms 걸린다. 그걸 기다리면 조작이
   먹통처럼 느껴진다. 그래서 로컬에서 먼저 움직이고, 호스트 값이 오면 차이를
   초당 6배율로 당긴다. 순간이동시키지 않는 이유는 벽에 밀릴 때마다 화면이
   튀기 때문이다.

   ── 언제 포기하는가 ────────────────────────────────────
   차이가 220px 를 넘으면 보간도 보정도 포기하고 그냥 옮긴다. 그 정도로
   벌어졌다면 순간이동했거나(재입장·호스트 승계) 오래 끊겼던 것이라, 부드럽게
   끌면 몇 초 동안 엉뚱한 데를 걸어간다.
   ============================================================ */
(function (global) {
  'use strict';

  var DELAY = 0.15;
  var SNAP_DIST = 220;
  var CORRECT_RATE = 6.0;
  var KEEP = 30;              // 버퍼에 쌓아 두는 스냅샷 수 (3초치)

  function lerp(a, b, k) { return a + (b - a) * k; }

  function between(pa, pb, k) {
    var dx = pb[0] - pa[0], dy = pb[1] - pa[1];
    if (dx * dx + dy * dy > SNAP_DIST * SNAP_DIST) return { x: pb[0], y: pb[1] };
    return { x: lerp(pa[0], pb[0], k), y: lerp(pa[1], pb[1], k) };
  }

  function Buffer() {
    this.items = [];          // [{ time, snap }] — time 오름차순
  }

  Buffer.prototype.push = function (tSec, snap) {
    var n = this.items.length;
    /* 늦게 도착한 옛날 것은 버린다. 최신을 밀어내면 화면이 되감긴다. */
    if (n && tSec <= this.items[n - 1].time) return;
    this.items.push({ time: tSec, snap: snap });
    if (this.items.length > KEEP) this.items.splice(0, this.items.length - KEEP);
  };

  Buffer.prototype.size = function () { return this.items.length; };

  Buffer.prototype.sample = function (nowSec) {
    var it = this.items, n = it.length;
    if (!n) return null;
    if (n === 1) return { a: it[0].snap, b: it[0].snap, k: 0 };

    var target = nowSec - DELAY;

    if (target <= it[0].time) return { a: it[0].snap, b: it[0].snap, k: 0 };
    if (target >= it[n - 1].time) {
      var last = it[n - 1].snap;
      return { a: last, b: last, k: 0 };
    }

    for (var i = n - 1; i > 0; i--) {
      if (it[i - 1].time <= target && target <= it[i].time) {
        var span = it[i].time - it[i - 1].time;
        var k = span > 0 ? (target - it[i - 1].time) / span : 0;
        return { a: it[i - 1].snap, b: it[i].snap, k: k };
      }
    }
    return { a: it[0].snap, b: it[1].snap, k: 0 };
  };

  function correct(local, server, dt) {
    var dx = server.x - local.x, dy = server.y - local.y;
    if (dx * dx + dy * dy > SNAP_DIST * SNAP_DIST) return { x: server.x, y: server.y };
    /* 지수 감쇠 — 프레임 시간이 들쭉날쭉해도 같은 속도로 붙는다 */
    var k = 1 - Math.exp(-CORRECT_RATE * dt);
    return { x: local.x + dx * k, y: local.y + dy * k };
  }

  global.Interp = {
    DELAY: DELAY,
    SNAP_DIST: SNAP_DIST,
    CORRECT_RATE: CORRECT_RATE,
    lerp: lerp,
    between: between,
    correct: correct,
    Buffer: Buffer
  };
})(window);
