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

  global.Room = {
    CODE_CHARS: CODE_CHARS,
    makeCode: makeCode,
    cleanCode: cleanCode
  };
})(window);
