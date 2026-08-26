/* ============================================================
   오버워크드 — 공정 기계

   이 표가 게임 규칙의 전부다. 시뮬레이션도 그리기도 여기를 읽기만 한다.
   규칙을 바꾸고 싶으면 이 파일만 고친다.

   ── 물건이 지나가는 길 ──────────────────────────────────
   ref → high → low → uv → tex → rig → done
   (레퍼런스 → 하이폴리 → 로우폴리 → 언랩 → 텍스처 → 리깅 → 렌더 완료)

   burnt 는 어느 단계에서든 빠질 수 있는 막다른 상태다. 폐기통에 버려야 한다.

   ── mode ────────────────────────────────────────────────
   source  집으면 새 물건이 나온다 (레퍼런스 선반)
   tap     물건을 놓고 연타하면 바뀐다 (모델링·리토폴·리깅)
   wait    물건을 놓고 기다리면 바뀐다 (UV·베이크·렌더팜)
   sink    넣으면 사라진다 (납품대·폐기통)

   연타와 대기를 나눈 이유: 연타 기계 앞에는 사람이 붙어 있어야 하고 대기
   기계는 놓고 딴 일을 하러 가야 한다. 이 둘이 섞여야 "지금 누가 어디에
   있어야 하는가"를 계속 다시 판단하게 된다. 전부 연타면 각자 한 대씩 잡고
   끝이고, 전부 대기면 할 일이 없다.

   1단계는 ref → model → retopo → ship 만 쓴다. 나머지는 미리 넣어 두되
   1스테이지 맵에 기계를 두지 않는다 — 2단계에서 맵만 늘리면 된다.
   ============================================================ */
(function (global) {
  'use strict';

  var TYPES = {
    ref: {
      name: '레퍼런스 선반', mode: 'source',
      accepts: [], gives: 'ref', work: 0, burn: 0
    },
    model: {
      name: '모델링 데스크', mode: 'tap',
      accepts: ['ref'], gives: 'high', work: 6, burn: 0
    },
    retopo: {
      name: '리토폴로지', mode: 'tap',
      accepts: ['high'], gives: 'low', work: 8, burn: 0
    },
    uv: {
      name: 'UV 전개기', mode: 'wait',
      accepts: ['low'], gives: 'uv', work: 4.0, burn: 0
    },
    bake: {
      /* 유일하게 타는 기계다. 놓고 잊으면 벌을 받는 자리가 하나는 있어야
         "누가 베이커 좀 봐줘"라는 말이 나온다. */
      name: '텍스처 베이커', mode: 'wait',
      accepts: ['uv'], gives: 'tex', work: 5.0, burn: 6.0
    },
    rig: {
      name: '리깅 데스크', mode: 'tap',
      accepts: ['tex'], gives: 'rig', work: 10, burn: 0
    },
    farm: {
      name: '렌더팜', mode: 'wait',
      accepts: ['rig'], gives: 'done', work: 9.0, burn: 0
    },
    ship: {
      name: '납품대', mode: 'sink',
      accepts: null, gives: null, work: 0, burn: 0
    },
    bin: {
      /* 아무거나 받는다. 탄 것을 버릴 데가 없으면 그 물건이 영원히 손에 남는다. */
      name: '폐기통', mode: 'sink',
      accepts: null, gives: null, work: 0, burn: 0
    }
  };

  /* 1스테이지: 로우폴리 6개.
     한 개당 모델링 6번 + 리토폴 8번 + 오가는 시간이라 2~3분쯤 걸린다.
     처음 하는 사람들이 규칙을 익히기에 딱 그 정도다. */
  var STAGE1_GOAL = { need: 'low', count: 6 };

  function get(type) {
    return Object.prototype.hasOwnProperty.call(TYPES, type) ? TYPES[type] : null;
  }

  function canAccept(type, itemState) {
    var d = get(type);
    if (!d) return false;
    if (d.mode === 'source') return false;      // 선반에는 물건을 못 올린다
    if (d.accepts === null) return true;        // 납품대·폐기통은 아무거나
    return d.accepts.indexOf(itemState) >= 0;
  }

  /* wait 기계의 시간을 굴린다. 원본을 고치지 않고 새 객체를 돌려준다 —
     시뮬레이션 상태를 그 자리에서 바꾸면 "언제 바뀌었지"를 못 쫓는다.

     큰 dt가 요리와 타기 두 단계를 넘나들면, 남은 시간을 다음 단계에 이월한다.
     그래야 한 번에 줘진 dt와 잘게 쪼갠 여러 dt가 같은 결과에 도달한다. */
  function step(machine, dt) {
    var d = get(machine.type);
    if (!d || d.mode !== 'wait') return machine;
    if (machine.item === null || machine.item === undefined) return machine;
    if (machine.item === 'burnt') return machine;          // 더 탈 것이 없다

    var prog = machine.prog || 0;

    /* 아직 익는 중 */
    if (machine.item !== d.gives) {
      prog += dt / d.work;
      if (prog < 1) return { id: machine.id, type: machine.type, item: machine.item, prog: prog };

      // 요리가 끝났다. 타는 기계면 남은 시간을 타기 단계에 적용한다.
      if (d.burn <= 0) return { id: machine.id, type: machine.type, item: d.gives, prog: 1 };

      // 남은 진행도를 초로 변환해서 타기에 적용
      var remainingTime = (prog - 1) * d.work;
      prog = 1 + remainingTime / d.burn;
      if (prog < 2) return { id: machine.id, type: machine.type, item: d.gives, prog: prog };
      return { id: machine.id, type: machine.type, item: 'burnt', prog: 2 };
    }

    /* 다 익었다. 타는 기계면 방치 시간을 잰다. */
    if (d.burn <= 0) return machine;
    prog += dt / d.burn;
    if (prog < 2) return { id: machine.id, type: machine.type, item: machine.item, prog: prog };
    return { id: machine.id, type: machine.type, item: 'burnt', prog: 2 };
  }

  global.Stations = {
    TYPES: TYPES,
    STAGE1_GOAL: STAGE1_GOAL,
    get: get,
    canAccept: canAccept,
    step: step
  };
})(window);
