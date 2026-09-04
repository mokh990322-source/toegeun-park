/* ============================================================
   모코파크 — 스냅샷 직렬화

   호스트가 10Hz 로 올리는 상태 꾸러미. 전송량이 이 파일에서 결정된다.

   키를 한 글자로 줄이고 좌표를 반올림하는 게 인색해 보이지만, 이 크기는
   8명 × 10Hz × 몇 분에 그대로 곱해진다. 소수점 좌표는 눈에 보이지도 않으면서
   글자 수만 두 배로 만든다.

   ── 왜 항상 전체를 보내는가 ────────────────────────────
   푸시가 12번에 한 번쯤 누락된다. 델타를 보내면 그 한 번을 놓치는 순간
   영원히 어긋난 채로 남는다. 전체를 보내면 다음 프레임이 알아서 고쳐 준다.

   ── sup 을 반드시 싣는다 ────────────────────────────────
   0 공중 · 1 타일 · 2 남의 머리.
   클라이언트는 sup === 2 일 때 예측을 끈다. 내 화면 속 남은 150ms 과거라,
   그 사람을 발판 삼아 예측하면 매번 어긋나 "분명 밟았는데 떨어졌다"가 된다.
   이 값이 안 실리면 그 규칙 자체가 성립하지 않는다.

   ── jseq 는 일부러 안 싣는다 ────────────────────────────
   입력 계열은 전송 상태가 아니다. 대신 승계한 호스트가 Sim.adopt 로
   지금 입력에 맞춰 놓는다. 안 그러면 첫 틱에 전 판의 점프가 전부 재생된다.

   ── t 가 두 가지 일을 한다 ──────────────────────────────
   화면 보간의 기준이면서, 호스트가 살아 있는지 판단하는 근거이기도 하다.
   이 값이 3초간 안 늘면 호스트가 죽은 것으로 본다.

   ── rt·멈춤·부서진 발판도 실어야 한다 ────────────────────
   시계 장치(움직이는 발판, 깜빡이는 가시)는 rt 로 정해진다. rt 만 실으면
   발판 위치를 한 바이트도 안 보내고 모두의 화면이 같아진다 — 이 설계의
   제일 큰 이득이라 rt 는 절대 빼면 안 된다.
   부서진 발판(cr)은 반대다. 밟아야 생기는 것이라 시각만으로는 못 만든다.
   칸번호와 남은시간을 납작한 배열로 싣는다.

   ── d(문 남은 시간)도 반드시 싣는다 ──────────────────────
   버튼을 뗀 뒤에도 문이 잠깐 열려 있는 시간(Sim.doorT)은 호스트 시뮬레이션
   안에만 있는 값이다. 안 실으면 승계 전까지 게스트 화면은 카운트다운을
   전혀 못 그리고, 승계 순간에는 그 값을 아예 모르는 채로(0으로) 새 판정을
   시작해 문이 남들보다 먼저 닫힌 것처럼 보인다.
   ============================================================ */
(function (global) {
  'use strict';

  function pack(state) {
    var p = {}, k;
    for (k in state.players) {
      if (!Object.prototype.hasOwnProperty.call(state.players, k)) continue;
      var q = state.players[k];
      /* [x, y, vx, vy, 바라보는쪽, 받쳐진것, 도착했나]
         속도까지 싣는 이유: 예측을 다시 켜는 순간 클라이언트가 호스트의
         속도로 이어받아야 튀지 않는다. 정수 반올림으로 충분하다. */
      p[k] = [
        Math.round(q.x), Math.round(q.y),
        Math.round(q.vx), Math.round(q.vy),
        q.face < 0 ? -1 : 1,
        q.sup | 0,
        q.done ? 1 : 0
      ];
    }
    /* 부서지는 발판: [칸번호, 0.1초단위 남은시간, ...] 로 납작하게.
       양수는 금이 간 채 버티는 중, 음수는 무너져서 복구를 기다리는 중이다. */
    var b = [];
    for (k in state.cr) {
      if (!Object.prototype.hasOwnProperty.call(state.cr, k)) continue;
      b.push(k | 0, Math.round(state.cr[k] * 10));
    }
    return {
      t: Math.round(state.t * 10),        // 0.1초 단위 틱. 정수라 짧다.
      r: Math.round((state.rt || 0) * 10),      // 라운드 시각 — 시계 장치가 여기 걸려 있다
      l: state.lv | 0,
      o: state.door ? 1 : 0,
      d: Math.round((state.doorT || 0) * 10),   // 문이 닫히기까지 남은 0.1초 단위 시간
      z: Math.round((state.freeze || 0) * 10),  // 재시작 직후 멈춤
      w: state.fail || '',                      // 누구 때문에 다시 하는지 (연출용)
      b: b,
      c: state.cleared ? 1 : 0,
      p: p
    };
  }

  /* 네트워크에서 온 것은 무엇이든 들어올 수 있다. 절대 예외를 던지지 않는다 —
     받는 쪽에서 던지면 그 사람의 화면이 그 자리에서 멈춘다. */
  function unpack(packed, spawnIdx) {
    var out = { t: 0, rt: 0, lv: 0, players: {}, door: false, doorT: 0,
                cr: {}, freeze: 0, fail: '', cleared: false,
                spawnIdx: spawnIdx || {} };
    if (!packed || typeof packed !== 'object') return out;

    out.t = (packed.t || 0) / 10;
    out.rt = (packed.r | 0) / 10;
    out.lv = packed.l | 0;
    out.door = !!packed.o;
    out.doorT = (packed.d | 0) / 10;
    out.freeze = (packed.z | 0) / 10;
    out.fail = typeof packed.w === 'string' ? packed.w : '';
    out.cleared = !!packed.c;

    var b = packed.b;
    if (b && b.length) {
      for (var bi = 0; bi + 1 < b.length; bi += 2) out.cr[b[bi] | 0] = (b[bi + 1] | 0) / 10;
    }

    var p = packed.p, k;
    if (p && typeof p === 'object') {
      for (k in p) {
        if (!Object.prototype.hasOwnProperty.call(p, k)) continue;
        var a = p[k];
        if (!a || a.length < 7) continue;
        out.players[k] = {
          x: a[0], y: a[1], py: a[1],
          vx: a[2], vy: a[3],
          face: a[4] < 0 ? -1 : 1,
          sup: a[5] | 0,
          done: !!a[6],
          /* 전송 안 되는 것들 — 이어받은 호스트가 Sim.adopt 로 맞춘다.
             rid(어느 움직이는 발판에 탔나)는 sup 이 3 이면 다음 틱에 다시 잡힌다. */
          coy: 0, buf: 0, jseq: 0, rseq: 0, rid: -1
        };
      }
    }
    return out;
  }

  function bytes(packed) { return JSON.stringify(packed).length; }

  global.Snap = { pack: pack, unpack: unpack, bytes: bytes };
})(window);
