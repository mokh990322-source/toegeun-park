/* ============================================================
   오버워크드 — 스냅샷 직렬화

   호스트가 10Hz 로 올리는 상태 꾸러미. 전송량이 이 파일에서 결정된다.

   키를 한 글자로 줄이고 좌표를 반올림하는 게 인색해 보이지만, 이 크기는
   8명 × 10Hz × 240초에 그대로 곱해진다. 소수점 좌표는 눈에 보이지도 않으면서
   글자 수만 두 배로 만든다. 물건 이름도 색인으로 바꾼다 — 'burnt' 다섯 글자를
   기계마다 매초 열 번씩 보낼 이유가 없다.

   ── 왜 항상 전체를 보내는가 ────────────────────────────
   푸시가 12번에 한 번쯤 누락된다. 델타를 보내면 그 한 번을 놓치는 순간
   영원히 어긋난 채로 남는다. 전체를 보내면 다음 프레임이 알아서 고쳐 준다.

   ── t 가 두 가지 일을 한다 ──────────────────────────────
   화면 보간의 기준이면서, 호스트가 살아 있는지 판단하는 근거이기도 하다.
   이 값이 3초간 안 늘면 호스트가 죽은 것으로 본다(Task 9).
   ============================================================ */
(function (global) {
  'use strict';

  /* 색인 순서를 바꾸면 예전 꾸러미를 잘못 읽는다. 뒤에만 붙일 것. */
  var ITEMS = ['ref', 'high', 'low', 'uv', 'tex', 'rig', 'done', 'burnt'];

  function itemIdx(s) {
    if (s === null || s === undefined) return -1;
    var i = ITEMS.indexOf(s);
    return i;                                     // 모르는 값도 -1 로 떨어진다
  }

  function itemOf(i) {
    return (i >= 0 && i < ITEMS.length) ? ITEMS[i] : null;
  }

  function round2(v) {
    return Math.round((v || 0) * 100) / 100;
  }

  function pack(state) {
    var p = {}, m = {}, k;

    for (k in state.players) {
      if (!Object.prototype.hasOwnProperty.call(state.players, k)) continue;
      var pl = state.players[k];
      p[k] = [Math.round(pl.x), Math.round(pl.y), pl.dir | 0, itemIdx(pl.hold)];
    }

    for (k in state.machines) {
      if (!Object.prototype.hasOwnProperty.call(state.machines, k)) continue;
      var mc = state.machines[k];
      m[k] = [itemIdx(mc.item), round2(mc.prog)];
    }

    return {
      t: Math.round(state.t * 10),                // 0.1초 단위 틱. 정수라 짧다.
      d: state.done | 0,
      p: p,
      m: m
    };
  }

  function unpack(packed, map) {
    var out = {
      t: 0, map: map, players: {}, machines: {}, done: 0,
      goal: (global.Stations && global.Stations.STAGE1_GOAL) || { need: 'low', count: 6 }
    };
    if (!packed || typeof packed !== 'object') return out;

    out.t = (packed.t || 0) / 10;
    out.done = packed.d | 0;

    var p = packed.p, k;
    if (p && typeof p === 'object') {
      for (k in p) {
        if (!Object.prototype.hasOwnProperty.call(p, k)) continue;
        var a = p[k];
        if (!a || a.length < 4) continue;
        out.players[k] = {
          x: a[0], y: a[1], dir: a[2] | 0, hold: itemOf(a[3]), tap: 0, seq: 0
        };
      }
    }

    /* 기계는 맵을 기준으로 세운다. 꾸러미에 없는 기계는 빈 채로 두고,
       맵에 없는 기계는 버린다 — 스테이지가 바뀌는 순간의 엇갈림을 여기서 흡수한다. */
    var st = (map && map.stations) || [];
    for (var i = 0; i < st.length; i++) {
      var s = st[i];
      var row = (packed.m && packed.m[s.id]) || null;
      out.machines[s.id] = {
        id: s.id, type: s.type,
        item: row ? itemOf(row[0]) : null,
        prog: row ? (row[1] || 0) : 0
      };
    }

    return out;
  }

  function bytes(packed) {
    return JSON.stringify(packed).length;
  }

  global.Snap = {
    ITEMS: ITEMS,
    pack: pack,
    unpack: unpack,
    bytes: bytes
  };
})(window);
