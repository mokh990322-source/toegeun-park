/* ============================================================
   모코파크 — 타일의 뜻

   "이 글자가 무엇인가"만 아는 파일이다. 판이 어떻게 생겼는지도, 누가
   그 위에 서 있는지도 모른다. 규칙을 여기 한 군데로 모아 두는 이유는,
   같은 판단(딛을 수 있나?)을 시뮬레이션·그림·경로 계산기 세 곳에서
   따로 하다가 어긋나면 "보이는 것과 닿는 것이 다른" 버그가 되기 때문이다.
   그건 사람이 절대 못 고치는 종류의 버그다.

   ── env 가 무엇인가 ─────────────────────────────────────
   타일 하나가 딱딱한지가 판 상태에 따라 달라진다. 그 상태를 통째로
   넘기는 꾸러미가 env 다.
     door    문이 열려 있나
     cr      부서지는 발판 { 칸번호: 남은시간 } — 음수면 이미 무너진 것
     ow      일방통행 판정용 { down: 내려가는 중인가, feet: 움직이기 전 발바닥 y }

   ── 일방통행이 왜 이렇게 생겼나 ─────────────────────────
   "위에서는 딛고 아래에서는 통과"는 지금 위치만으로는 못 정한다. 발판
   한가운데 있을 때 위에서 온 건지 아래에서 온 건지 알 수 없기 때문이다.
   그래서 움직이기 전의 발바닥 높이(ow.feet)를 같이 받는다 — 그 값이 발판
   윗면보다 위였으면 딛고, 아니면 통과다. 이 판단은 한 번의 이동 전체에
   대해 고정이라, 이분 탐색(Levels.slide) 중간에 뒤집히지 않는다.

   ── 가시는 딱딱하지 않다 ────────────────────────────────
   가시는 충돌이 아니라 판정이다. 딱딱하게 만들면 가시 위에 올라설 수 있게
   되고, 그러면 "닿으면 죽는다"와 "딛고 선다"가 같은 프레임에 성립한다.
   충돌(solid)과 위험(hazard)을 완전히 갈라 놓는다.
   ============================================================ */
(function (global) {
  'use strict';

  var TILE = 40;

  var EMPTY   = '.';
  var WALL    = '#';
  var ONEWAY  = '-';   // 위에서만 딛는다
  var BUTTON  = 'B';   // 밟고 있는 동안 문이 열린다
  var DOOR    = 'D';
  var GOAL    = 'G';
  var SPIKE   = '^';   // 닿으면 라운드 재시작
  var BLINK_A = '!';   // 나왔다 들어갔다 하는 가시
  var BLINK_B = '?';   // 같은 가시, 반대 위상
  var CRUMBLE = 'x';   // 밟으면 잠시 뒤 무너진다
  var PUSH_R  = '>';   // 딛고 서면 오른쪽으로 밀린다
  var PUSH_L  = '<';

  /* 판을 짜다 오타를 내면(예: 소문자 b) 조용히 빈칸이 된다 — 판이 안 깨지는
     이유를 한참 찾게 된다. 아는 글자를 한 곳에 적어 두고 시험이 검사한다. */
  var ALL = EMPTY + WALL + ONEWAY + BUTTON + DOOR + GOAL +
            SPIKE + BLINK_A + BLINK_B + CRUMBLE + PUSH_R + PUSH_L;

  function known(t) { return ALL.indexOf(t) >= 0; }

  /* 딛고 설 수 있나. cy 는 칸의 세로 번호, idx 는 격자에서의 칸 번호. */
  function solid(t, cy, idx, env) {
    if (t === WALL || t === PUSH_R || t === PUSH_L) return true;
    /* 버튼은 밟는 것이다 — 딛고 설 수 없으면 누를 방법이 없다 */
    if (t === BUTTON) return true;
    if (t === DOOR) return !(env && env.door);
    if (t === CRUMBLE) {
      /* cr[칸] 은 남은 시간이다. 양수면 금이 간 채로 아직 버티는 중이고,
         음수면 이미 무너져서 복구를 기다리는 중이다. 상태 둘을 숫자 하나로
         쓰는 이유는 스냅샷 때문이다 — 지도를 두 벌 실으면 크기가 두 배가 된다. */
      var v = env && env.cr ? env.cr[idx] : 0;
      return !(v < 0);
    }
    if (t === ONEWAY) {
      var ow = env && env.ow;
      if (!ow || !ow.down) return false;
      return ow.feet <= cy * TILE + 1;
    }
    return false;
  }

  /* 닿으면 라운드가 다시 시작되는 칸인가.
     blink 는 지금 어느 위상인지 — true 면 ! 가 나와 있고 ? 는 들어가 있다. */
  function hazard(t, blink) {
    if (t === SPIKE) return true;
    if (t === BLINK_A) return !!blink;
    if (t === BLINK_B) return !blink;
    return false;
  }

  /* 딛고 섰을 때 밀려나는 방향 (0 이면 안 밀린다) */
  function pushDir(t) {
    if (t === PUSH_R) return 1;
    if (t === PUSH_L) return -1;
    return 0;
  }

  global.Tiles = {
    TILE: TILE, ALL: ALL,
    EMPTY: EMPTY, WALL: WALL, ONEWAY: ONEWAY, BUTTON: BUTTON, DOOR: DOOR, GOAL: GOAL,
    SPIKE: SPIKE, BLINK_A: BLINK_A, BLINK_B: BLINK_B, CRUMBLE: CRUMBLE,
    PUSH_R: PUSH_R, PUSH_L: PUSH_L,
    known: known, solid: solid, hazard: hazard, pushDir: pushDir
  };
})(window);
