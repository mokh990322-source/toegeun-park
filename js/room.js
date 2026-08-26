/* ============================================================
   오버워크드 — 방 코드

   코드는 말이나 메신저로 불러 주는 것이다. "오인가 영인가"를 되묻게
   되는 순간 코드로서 실패다. 그래서 I, L, O, 0, 1 을 빼고 31자만 쓴다.
   31의 4제곱 = 92만 가지. 사내에서 동시에 열리는 방은 많아야 두어 개라
   겹칠 일이 사실상 없다.

   코드에 없는 글자가 들어오면 고쳐 주지 않고 거부한다. 0 을 친 사람이
   O 를 뜻했는지 다른 글자를 잘못 본 건지 알 방법이 없기 때문이다.
   엉뚱한 방에 넣는 것보다 "그런 코드 없다"고 하는 쪽이 낫다.
   ============================================================ */
(function (global) {
  'use strict';

  /* A~Z 에서 I, L, O 를 뺀 23자 + 2~9 여덟 자 = 31자 */
  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  function makeCode(rand) {
    var r = rand || Math.random;
    var s = '';
    for (var i = 0; i < 4; i++) {
      var k = Math.floor(r() * CODE_CHARS.length);
      /* rand() 가 정확히 1 을 돌려주는 구현도 있다. 그때 범위를 넘지 않게 막는다. */
      if (k >= CODE_CHARS.length) k = CODE_CHARS.length - 1;
      if (k < 0) k = 0;
      s += CODE_CHARS.charAt(k);
    }
    return s;
  }

  function cleanCode(s) {
    if (typeof s !== 'string') return '';
    var up = s.toUpperCase().replace(/\s+/g, '');
    if (up.length !== 4) return '';
    for (var i = 0; i < 4; i++) {
      if (CODE_CHARS.indexOf(up.charAt(i)) < 0) return '';
    }
    return up;
  }

  /* ============================================================
     호스트 승계

     호스트가 탭을 닫으면 판이 죽는다. 4분짜리 스테이지가 누가 alt-tab 했다고
     날아가면 안 된다.

     판단(누가 다음인가, 지금 나서야 하나)을 순수 함수로 떼어냈다. 경합 상황을
     실제 8명으로 재현하는 건 불가능하므로, 이걸 순수하게 두는 것이 승계를
     신뢰할 수 있게 만드는 유일한 방법이다.

     ── 왜 관망 단계가 있는가 ──────────────────────────────
     두 사람이 동시에 "호스트가 죽었다"고 판단할 수 있다. 둘 다 meta/host 를
     자기로 쓰면 나중 쓴 쪽이 남는데, 진 쪽이 그걸 모르면 시뮬레이션을 둘이
     돌리게 된다. 그래서 나선 뒤 1초 기다렸다가 meta/host 를 다시 보고,
     내가 아니면 물러난다. 늦게 쓴 쪽이 이기는 성질을 그대로 이용하는 것이라
     따로 잠금이 필요 없다.
     ============================================================ */

  var HOST_TIMEOUT = 3.0;    // 틱이 이만큼 안 늘면 호스트가 죽은 것
  var CLAIM_WAIT = 1.0;      // 나선 뒤 관망
  var SEEN_TIMEOUT = 10.0;   // 이만큼 소식 없으면 나간 사람

  function alive(who, nowMs) {
    if (!who || typeof who !== 'object') return [];
    var out = [];
    for (var pid in who) {
      if (!Object.prototype.hasOwnProperty.call(who, pid)) continue;
      var w = who[pid];
      if (!w) continue;
      if (nowMs - (w.seen || 0) > SEEN_TIMEOUT * 1000) continue;
      out.push(pid);
    }
    /* 입장 순서로 줄을 세운다. 순번이 같으면 pid 로 갈라 모두가 같은 답을 얻게 한다 —
       사람마다 다른 순서를 보면 승계 대상이 갈린다. */
    out.sort(function (a, b) {
      var ja = who[a].join || 0, jb = who[b].join || 0;
      if (ja !== jb) return ja - jb;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    return out;
  }

  function nextHost(who, nowMs) {
    var list = alive(who, nowMs);
    return list.length ? list[0] : null;
  }

  function hostDead(lastTick, lastChangeMs, nowMs) {
    /* 아직 스냅샷을 한 번도 못 받았으면 판단하지 않는다. 방금 들어온 사람이
       "조용하네"라며 승계해 버리면 멀쩡한 호스트를 밀어낸다. */
    if (lastTick === null || lastTick === undefined) return false;
    return (nowMs - lastChangeMs) > HOST_TIMEOUT * 1000;
  }

  function shouldClaim(o) {
    if (!o || !o.me) return 'none';
    var now = o.nowMs || 0;

    /* 나선 뒤 관망 중 */
    if (o.claimedAtMs) {
      if (now - o.claimedAtMs < CLAIM_WAIT * 1000) return 'wait';
      return o.host === o.me ? 'none' : 'yield';
    }

    if (o.host === o.me) return 'none';               // 이미 내가 호스트

    var list = alive(o.who, now);
    var noSnapshotYet = (o.lastTick === null || o.lastTick === undefined);

    /* 스냅샷 틱이 흐르고 있으면 호스트는 살아 있다. who/seen 이 낡았어도
       상관없다 — 스냅샷이 오고 있다는 게 훨씬 강한 증거다. 심박수만 보고
       멀쩡한 호스트를 밀어내면 시뮬레이션이 둘로 갈린다. */
    if (!noSnapshotYet && !hostDead(o.lastTick, o.lastChangeMs, now)) return 'none';

    /* 아직 스냅샷을 한 번도 못 받았다 — 대기실이거나 방금 들어왔다.
       이때는 who 목록으로만 판단한다. 호스트가 목록에 있으면 가만히 둔다. */
    if (noSnapshotYet && list.indexOf(o.host) >= 0) return 'none';

    /* 호스트가 죽었으면(틱이 멈췄으면) 그 호스트를 후보 목록에서 빼고 본다.
       alive() 는 heartbeat 로 필터하는데, heartbeat 는 틱보다 느리게 낡는다.
       그래서 죽은 호스트도 아직 alive() 에 남아 있을 수 있다. */
    if (!noSnapshotYet && hostDead(o.lastTick, o.lastChangeMs, now)) {
      list = list.filter(function (pid) { return pid !== o.host; });
    }

    return (list.length && list[0] === o.me) ? 'claim' : 'none';
  }

  global.Room = {
    CODE_CHARS: CODE_CHARS,
    makeCode: makeCode,
    cleanCode: cleanCode,
    HOST_TIMEOUT: HOST_TIMEOUT,
    CLAIM_WAIT: CLAIM_WAIT,
    SEEN_TIMEOUT: SEEN_TIMEOUT,
    alive: alive,
    nextHost: nextHost,
    hostDead: hostDead,
    shouldClaim: shouldClaim
  };
})(window);
