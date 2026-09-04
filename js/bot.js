/* ============================================================
   모코파크 — AI 동료

   혼자서도 판을 깰 수 있게, 호스트가 대신 조종해 주는 동료다.

   ── 봇은 사람과 똑같은 입력을 낸다 ───────────────────────
   결과물은 { x, jseq } 하나뿐이다. 시뮬레이션은 이게 사람 손에서 왔는지
   여기서 왔는지 알 필요가 없고, 알아서도 안 된다 — 규칙이 두 벌이 되는
   순간 "봇은 되는데 사람은 안 되는" 자리가 생긴다.

   ── 호스트만 생각한다 ───────────────────────────────────
   봇 입력을 두 사람이 만들면 판이 갈린다. 호스트가 바뀌면 새 호스트가
   이어서 만든다 — 기억(지금 몇 번째 단계인가)은 초기화되지만, 단계마다
   도착 여부를 판 상태로 다시 재기 때문에 몇 초 안에 제자리를 찾는다.

   ── 왜 일반 플랫포머 AI 가 아니라 판마다 적어 둔 경로인가 ──
   이 게임의 판은 "누가 받쳐 주고 누가 올라간다", "누가 버튼을 밟고
   남는다" 처럼 역할이 정해져 있다. 일반 길찾기로는 그 역할이 안 나온다.
   게다가 발판 사이가 세 칸(120px)인데 점프 도달 높이가 144px 라 여유가
   24px 뿐이라, 어디서 뛰느냐가 전부다. 그 자리를 손으로 적고 Node 로
   실제 물리를 돌려 확인하는 편이 훨씬 싸고 확실하다(test/bot.test.js).

   ── 좌표는 전부 몸 가운데(cx) 다 ────────────────────────
   Sim 의 좌표는 몸통 왼쪽 위지만, 경로를 손으로 적을 때는 "몸 가운데가
   여기"가 읽기 쉽다. 경계 변환은 이 파일 안에서만 한다.

   ── 단계 ────────────────────────────────────────────────
   { go: cx }                    거기까지 걸어간다
   { go: cx, wait: ... }         거기 서서 조건을 기다린다
   { hop: cx|null, to: cx,       cx 에서 점프한다. 뜬 뒤 발바닥이 clear
     clear: y, land: y }         위로 올라가면 to 를 향해 민다.
                                 발바닥이 land 에 닿아야 성공.
   { hop: ..., onHead: true }    남의 머리에 올라서면 성공
   { go: cx, end: true }         여기서 끝. 안 떠난다.

   clear 를 두는 이유: 발판 옆구리를 들이받지 않으려고 다 올라갈 때까지
   가만히 뜬다. 반대로 두세 칸 건너뛰기(1번 판 뒷부분)는 그럴 여유가 없어
   clear 를 9999 로 둬서 뜨자마자 민다 — 그 자리에서는 옆구리에 안 닿는
   것을 계산과 시험으로 확인했다.
   ============================================================ */
(function (global) {
  'use strict';

  var L = null;
  function deps() { if (!L) L = global.Levels; }

  var PREFIX = 'bot';
  var TOL = 6;              // 목표 cx 에 이만큼 붙으면 도착
  var HOP_LIMIT = 4;        // 점프 한 번이 이보다 길어지면 그 단계를 다시
  var GO_LIMIT = 14;        // 걸어가기가 이보다 길어지면 경로를 처음부터
  var SPREAD = 20;          // 출입구에서 봇끼리 벌려 서는 간격
  var STAGGER = 1.5;        // 봇마다 출발을 늦추는 간격

  function isBot(pid) {
    return typeof pid === 'string' && pid.slice(0, PREFIX.length) === PREFIX;
  }

  function mind() {
    return { i: 0, t: 0, t0: 0, started: false, air: false, jseq: 0, off: 0, lv: -1, job: '' };
  }

  /* ---------- 판마다 필요한 역할 ----------
     앞에 있는 것부터 봇이 가져간다. 봇이 모자라면 남는 역할은 사람 몫이다 —
     혼자 + 봇 하나로 놀 때 봇이 받쳐 주고 사람이 올라가는 쪽이 재미있다.
     역할을 못 받은 봇은 exit 로 그냥 출입구까지 간다. */
  var JOBS = { 0: [], 1: ['boost', 'climb'], 2: ['hold'] };

  var ROUTES = {
    /* 1 첫 출근 — 계단. 발판 사이가 세 칸이라 뛰는 자리가 정해져 있다. */
    0: {
      exit: [
        { go: 134 },
        { hop: 134, to: 240, clear: 560, land: 560 },   // 바닥 → 14행
        { go: 336 },
        { hop: 336, to: 440, clear: 440, land: 440 },   // 14행 → 11행
        { go: 552 },
        { hop: 552, to: 700, clear: 9999, land: 320 },  // 11행 → 8행 (두 칸 건너)
        { go: 844 },
        { hop: 844, to: 1040, clear: 9999, land: 200 }, // 8행 → 5행 (세 칸 건너)
        { go: 1040, end: true }
      ]
    },

    /* 2 목마 — 받치는 사람과 올라가는 사람.
       받친 사람(boost)은 문이 열리면 먼저 지나간다. 올라간 사람(climb)은
       버튼을 밟은 채로 그걸 지켜보다가, 다 지나간 뒤에 내려와 따라간다 —
       문은 뗀 뒤에도 4초 열려 있으니 그 안에 닿는다. */
    1: {
      boost: [
        { go: 340, wait: 'door' },
        { go: 1080, end: true }
      ],
      climb: [
        { go: 394, waitAt: 340 },                        // 받쳐 줄 사람이 설 때까지
        { hop: 394, to: 340, onHead: true },             // 그 사람 머리 위로
        { hop: null, to: 220, clear: 520, land: 520, head: true },  // 머리에서 턱 위로
        { go: 220, wait: 'clear' },                      // 버튼을 밟고 기다린다
        { go: 1080, end: true }
      ],
      exit: [
        { go: 700, wait: 'door' },
        { go: 1080, end: true }
      ]
    },

    /* 3 누가 남을래 — 버튼을 밟고 있어야 문이 열린다. */
    2: {
      hold: [
        { go: 220, wait: 'clear' },
        { go: 1018, upAt: 560 },
        { hop: 1018, to: 1120, clear: 560, land: 560 },
        { go: 1120, end: true }
      ],
      exit: [
        { go: 554, wait: 'door' },
        { go: 1018, upAt: 560 },
        { hop: 1018, to: 1120, clear: 560, land: 560 },
        { go: 1120, end: true }
      ]
    }
  };

  function route(lvIndex, job) {
    var r = ROUTES[lvIndex] || ROUTES[0];
    return r[job] || r.exit || ROUTES[0].exit;
  }

  /* 봇 pid 를 정렬해 앞에서부터 역할을 준다. 정렬하는 이유는 호스트가
     바뀌어도 같은 봇이 같은 역할을 이어받게 하기 위해서다. */
  function assign(lvIndex, botPids) {
    var jobs = JOBS[lvIndex] || [];
    var list = (botPids || []).slice().sort();
    var out = {};
    for (var i = 0; i < list.length; i++) {
      out[list[i]] = i < jobs.length ? jobs[i] : 'exit';
    }
    return out;
  }

  /* ---------- 조건 ---------- */

  /* 문 칸의 오른쪽 x. 문이 없는 판이면 -1 */
  function doorRight(lv) {
    var i = lv.grid.indexOf('D');
    if (i < 0) return -1;
    return ((i % L.COLS) + 1) * L.TILE;
  }

  /* 나 말고 다들 문을 지났나(또는 이미 도착했나). 버튼을 밟고 남은 사람이
     "이제 가도 되나"를 판단하는 조건이다. 나 혼자면 기다릴 사람이 없다. */
  function othersPast(state, me) {
    deps();
    var lv = L.LIST[state.lv];
    var dx = doorRight(lv);
    var k, q;
    for (k in state.players) {
      if (!Object.prototype.hasOwnProperty.call(state.players, k)) continue;
      if (k === me) continue;
      q = state.players[k];
      if (q.done) continue;
      if (dx >= 0 && q.x > dx) continue;
      return false;
    }
    return true;
  }

  /* 다른 누군가가 cx 자리에 땅을 딛고 서 있나 — 목마를 받쳐 줄 사람 확인 */
  function mateAt(state, me, cx) {
    deps();
    var k, q;
    for (k in state.players) {
      if (!Object.prototype.hasOwnProperty.call(state.players, k)) continue;
      if (k === me) continue;
      q = state.players[k];
      if (q.sup !== 1) continue;
      if (Math.abs((q.x + L.PW / 2) - cx) <= 20) return true;
    }
    return false;
  }

  function waitDone(state, me, s) {
    if (s.waitAt !== undefined) return mateAt(state, me, s.waitAt);
    if (s.wait === 'door') return !!state.door;
    if (s.wait === 'clear') return othersPast(state, me);
    return true;
  }

  /* "문 앞에서 기다린다"는 단계는 이미 문을 지난 뒤라면 아무 뜻이 없다.
     그런데 기다리는 자리는 문 왼쪽이라, 지나친 봇은 닫힌 문을 향해 계속
     되돌아가려 든다 — 문 오른쪽에서 왼쪽으로는 못 지나가므로 그 자리에
     선 채로 뒤따라오는 동료와 정면으로 밀치며 둘 다 영영 멈춘다.
     실제로 봇 다섯이 그렇게 굳는 것을 봤다. 지나왔으면 그냥 넘긴다. */
  /* 이미 그 높이에 올라서 있으면 그 단계는 지나간 것으로 본다.

     점프가 한 번 실패하면(남의 머리에 얹히는 등) 그 단계를 다시 하는데,
     그 사이에 어찌어찌 발판 위에 올라가 있을 수 있다. 그때 뛰던 자리로
     되돌아가라고 하면 발판에서 도로 뛰어내린다 — 출입구를 5px 앞에 두고
     굳은 봇이 실제로 나왔다. */
  function alreadyUp(p, y) {
    return y !== undefined && p.sup === 1 && Math.abs(p.y + L.PH - y) < 8;
  }

  function pastDoor(state, p) {
    var dx = doorRight(L.LIST[state.lv]);
    return dx >= 0 && p.x > dx;
  }

  function alreadyPast(state, p, s) {
    return s.wait === 'door' && pastDoor(state, p);
  }

  /* ---------- 조종 ---------- */

  function toward(p, cx) {
    var d = cx - (p.x + L.PW / 2);
    if (d > TOL) return 1;
    if (d < -TOL) return -1;
    return 0;
  }

  function arrived(p, cx) {
    return Math.abs((p.x + L.PW / 2) - cx) <= TOL;
  }

  /* 남의 머리 위에 얹혔는데 그럴 차례가 아니면 내려온다.

     내려오는 방향을 기억해 두는 게 핵심이다. 매 프레임 목표 쪽을 다시
     계산하면, 목표 바로 위에 얹힌 봇은 한 프레임 오른쪽 한 프레임 왼쪽으로
     4px 씩 오가며 영원히 그 자리에 머문다 — 실제로 그렇게 굳었다. 게다가
     밑에 깔린 동료는 그 자리를 비켜 달라고 기다리고 있어서 둘 다 멈춘다. */
  function dismount(p, m, want) {
    if (!m.off) m.off = want || 1;
    return m.off;
  }

  /* 가려는 자리에 이미 남이 서 있고 그 사람이 나보다 그 자리에 가까우면
     밀고 들어가지 않는다.

     이게 없으면 봇 둘이 같은 자리(뛰는 자리)를 양쪽에서 노리다가 서로에게
     걸어 들어가 영원히 멈춘다 — 밀어내기는 몸 너비만큼 떨어지면 멈추는데
     둘 다 상대 쪽으로 계속 걷고 있어서 딱 그 거리에서 균형이 잡힌다.
     떠 있는 사람은 세지 않는다. 곧 비켜 줄 자리다. */
  function laneBusy(state, me, cx, p) {
    var mine = Math.abs((p.x + L.PW / 2) - cx);
    /* 멀리 있으면 양보하지 않는다. 아무 데서나 멈춰 서면 그 자리가 또
       남의 길을 막는다 — 여덟이 줄을 서면 맨 뒤가 버튼 옆에 굳어서
       버튼을 밟아야 할 동료를 막고, 그러면 문이 영영 안 열린다.
       가까이 와서야 양보하면 뒤쪽은 그냥 밀며 붙어 서서 줄이 된다. */
    if (mine > 90) return false;
    var k, q, d;
    for (k in state.players) {
      if (!Object.prototype.hasOwnProperty.call(state.players, k)) continue;
      if (k === me) continue;
      /* 사람에게는 양보하지 않는다. 양보는 "둘 다 같은 자리를 노리도록
         적혀 있어서" 생기는 교착을 푸는 장치인데, 사람은 대본이 없다.
         시작 자리에 가만히 서 있기만 해도 봇이 영원히 기다리게 된다 —
         실제로 브라우저에서 그렇게 굳었다. 사람과는 그냥 부딪친다.
         밀어내기가 알아서 떼어 놓고, 사람은 어차피 곧 움직인다. */
      if (!isBot(k)) continue;
      q = state.players[k];
      /* 떠 있는 사람도 센다. 뛰는 자리 위에 떠 있는 동료는 곧 그 자리로
         내려온다 — 안 세면 그 밑으로 걸어 들어가 머리에 얹히고, 얹힌 쪽은
         점프 판정에 실패해 다시 뛰고, 그게 넷이 모이면 서로를 밟고 튀는
         트램펄린이 되어 아무도 발판에 못 오른다. 실제로 그렇게 굳었다. */
      d = Math.abs((q.x + L.PW / 2) - cx);
      if (d < 40 && d < mine) return true;
    }
    return false;
  }

  /* state: Sim 상태. pid: 이 봇. job: 역할. m: 이 봇의 기억. slot: 봇 순번.
     돌려주는 것은 사람 입력과 같은 모양의 { x, jseq } 다. */
  function step(state, pid, job, m, slot, dt) {
    deps();
    var out = { x: 0, jseq: m.jseq };
    var p = state && state.players && state.players[pid];
    if (!p) return out;

    /* 판이나 역할이 바뀌면 처음부터 */
    if (m.lv !== state.lv || m.job !== job) {
      m.lv = state.lv; m.job = job;
      m.i = 0; m.t = 0; m.air = false;
      m.t0 = 0; m.started = false;
    }

    /* 순번마다 출발을 늦춘다. 안 그러면 봇들이 똑같은 자리(뛰는 자리)로
       한꺼번에 몰려 서로 밀어내느라 아무도 그 자리에 못 선다 — 계단을
       한 줄로 오르게 만드는 가장 싼 방법이 시차다. */
    m.t0 += dt || 0;
    if (!m.started) {
      if (m.t0 < (slot | 0) * STAGGER) return out;
      m.started = true;
    }

    var plan = route(state.lv, job);
    if (m.i >= plan.length) m.i = plan.length - 1;
    var s = plan[m.i];
    m.t += dt || 0;

    /* 출입구에서는 봇끼리 조금씩 벌려 선다 — 두 칸짜리 출입구에 겹쳐 서면
       서로 밀어내다가 아무도 안에 못 있게 된다. */
    var offset = s.end ? Math.round((((slot | 0) % 4) - 1.5) * SPREAD) : 0;

    /* ---- 걸어가기 / 기다리기 ---- */
    if (s.hop === undefined) {
      var gx = s.go + offset;
      out.x = toward(p, gx);
      if (s.end) return out;
      if (alreadyPast(state, p, s) || alreadyUp(p, s.upAt)) {
        m.i++; m.t = 0; return { x: 0, jseq: m.jseq };
      }
      if (laneBusy(state, pid, gx, p)) return { x: 0, jseq: m.jseq };
      if (p.sup === 2) out.x = dismount(p, m, out.x); else m.off = 0;
      if (arrived(p, gx) && p.sup === 1) {
        if (waitDone(state, pid, s)) { m.i++; m.t = 0; m.air = false; }
      } else if (!s.wait && s.waitAt === undefined && m.t > GO_LIMIT) {
        /* 길을 잃었다 — 경로를 처음부터 다시 잡는다. 어디서 어긋났는지
           알아내는 것보다 다시 걷는 편이 확실하다.
           단, 문을 이미 지났으면 처음으로 못 돌아간다. 문은 한쪽으로만
           열리는 게 아니라 닫히면 양쪽 다 막는데, 경로의 첫 단계는 늘
           문 왼쪽에 있다 — 되돌아가려다 문 앞에서 영영 멈춘다. */
        m.t = 0;
        if (!pastDoor(state, p)) { m.i = 0; m.air = false; m.off = 0; }
      }
      return out;
    }

    /* ---- 점프: 뛸 자리로 ---- */
    if (!m.air) {
      if (alreadyUp(p, s.land)) { m.i++; m.t = 0; return { x: 0, jseq: m.jseq }; }
      var tx = (s.hop === null) ? (p.x + L.PW / 2) : s.hop;
      out.x = toward(p, tx);
      if (s.hop !== null && laneBusy(state, pid, tx, p)) return { x: 0, jseq: m.jseq };
      if (p.sup === 2 && !s.head) out.x = dismount(p, m, out.x); else m.off = 0;
      if (p.sup === (s.head ? 2 : 1) && (s.hop === null || arrived(p, tx))) {
        out.x = 0;
        m.jseq++; out.jseq = m.jseq;
        m.air = true; m.t = 0;
      } else if (m.t > GO_LIMIT) { m.i = 0; m.t = 0; }
      return out;
    }

    /* ---- 점프: 떠 있는 중 ----
       발바닥이 clear 위로 올라간 뒤에야 목표 쪽으로 민다. */
    var clear = (s.clear === undefined) ? 9999 : s.clear;
    if (p.y + L.PH <= clear) out.x = toward(p, s.to);

    /* 뜬 직후 한두 프레임은 아직 sup 이 남아 있을 수 있어 조금 기다렸다 잰다 */
    if (m.t > 0.15 && p.sup !== 0) {
      var ok = s.onHead ? (p.sup === 2)
                        : (s.land === undefined || Math.abs(p.y + L.PH - s.land) < 8);
      m.air = false; m.t = 0;
      if (ok) m.i++;
      /* 실패면 같은 단계를 다시 한다 — 뛸 자리로 되돌아가는 것부터 */
    } else if (m.t > HOP_LIMIT) {
      m.air = false; m.t = 0;
    }
    return out;
  }

  global.Bot = {
    PREFIX: PREFIX, JOBS: JOBS, ROUTES: ROUTES, SPREAD: SPREAD, STAGGER: STAGGER,
    isBot: isBot, mind: mind, assign: assign, route: route,
    doorRight: doorRight, othersPast: othersPast,
    step: step
  };
})(window);
