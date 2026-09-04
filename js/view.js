/* ============================================================
   모코파크 — 그리기

   이 파일은 판정을 하지 않는다. "이 사람이 버튼을 눌렀나", "문이 열렸나",
   "몇 초 남았나"를 여기서 다시 계산하면 호스트와 답이 갈려서, 화면에는
   열렸다고 나오는데 지나가면 막혀 있는 상태가 된다. 필요한 것은 전부
   state 에 들어 있다(state.door, state.doorT, player.sup, player.done).
   여기서 하는 계산은 걷는 위상처럼 틀려도 아무도 손해 보지 않는 것뿐이다.

   ── 캔버스가 두 장인 이유 ───────────────────────────────
   #floor(벽·출입구 몸통)는 창 크기가 바뀌거나 판이 바뀔 때만 다시 그린다.
   #actors(캐릭터·버튼·문·진행 표시)만 매 프레임이다. 벽 576칸을 60Hz 로
   다시 그리면 8명이 붙은 방에서 이건 느린 PC 가 먼저 죽는 이유가 된다.

   ── 좌표 ────────────────────────────────────────────────
   전부 1280x720 디자인 좌표다. 배율은 setTransform 으로 ctx 에 한 번만
   걸고, 그 뒤로는 아무도 곱하지 않는다. 그리는 코드가 배율을 알면 어딘가
   한 군데는 반드시 곱하는 걸 잊는다.
   ============================================================ */
(function (global) {
  'use strict';

  var L = null, Sim = null;
  /* Sim 은 문 카운트다운의 눈금(DOOR_LINGER)을 읽는 용도로만 쓴다 — 열렸나/
     닫혔나 자체는 여전히 state.door 를 그대로 읽는다(판정은 안 한다).
     view-layout 테스트처럼 Sim 을 안 실은 자리도 있어 없으면 없는 대로 둔다. */
  function deps() { if (!L) L = global.Levels; if (!Sim) Sim = global.Sim; }

  var scale = 1, dpr = 1;
  var floorDirty = true;
  var sized = false;            // "이미 캔버스를 배치했다" — width 로 추측하지 않는다.
                                 // 빈 <canvas> 의 기본값(300)이 우연히 배율 1과
                                 // 맞아떨어지는 창(1280 이상 너비)에서 첫 호출이
                                 // 조기반환해 캔버스가 300x150 으로 굳는 사고가 났다.
  var lastLv = -1;               // 마지막으로 바닥을 그린 판 번호 — 판이 바뀌면
                                  // 리사이즈가 없어도 바닥을 다시 그려야 한다.
  var geo = null;                // { lv, buttons:[{x,y}], doors:[{x,y}], exits:[...] } 캐시

  /* 걷는 위상은 화면에서만 쓰는 값이라 여기서 갖는다. 시뮬레이션에 넣으면
     스냅샷에 실려 전송량만 늘고, 어차피 남의 입력 계열은 오지도 않는다. */
  var walk = {};

  function rr(ctx, x, y, w, h, r) {
    var rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  function fillRR(ctx, x, y, w, h, r, color) {
    rr(ctx, x, y, w, h, r); ctx.fillStyle = color; ctx.fill();
  }

  /* ---------- 배치 ----------
     min(창너비/1280, 창높이/720) 로 잡고 가운데 정렬. 남는 데는 레터박스로
     둔다 — 늘려서 채우면 사람마다 다른 판을 보게 된다. */
  function isCanvas(cv) {
    /* 잘못 불리면(인자 생략, 숫자 전달 등) 모듈 상태를 건드리지 않고 조용히
       빠진다 — 확인 코드가 실수로 View.layout() 이나 View.layout(1280,720) 을
       불렀다가 floorCv 가 1280 같은 숫자로 덮여 다음 정상 호출까지 깨지는
       사고가 실제로 있었다. */
    return !!cv && typeof cv.getContext === 'function' &&
           cv.nodeType === 1 && /^canvas$/i.test(cv.tagName || '');
  }

  function byId(id) {
    var d = global.document;
    return d && d.getElementById ? d.getElementById(id) : null;
  }

  function layout(floorCv, actorsCv) {
    deps();

    /* 캔버스가 아닌 게 들어오면(인자 누락·오용) id 로 직접 찾아본다. 그래도
       없으면 아무 것도 손대지 않고 지금 배율만 돌려준다. */
    if (!isCanvas(floorCv)) floorCv = byId('floor');
    if (!isCanvas(actorsCv)) actorsCv = byId('actors');
    if (!isCanvas(floorCv) || !isCanvas(actorsCv)) return scale;

    var s = Math.min(global.innerWidth / L.W, global.innerHeight / L.H);
    if (!(s > 0)) s = 1;
    /* 배속 화면에서 글자가 뭉개지지 않게 픽셀 밀도를 반영하되 2배에서 끊는다.
       3배까지 올리면 4K 에서 캔버스가 갑자기 세 배로 무거워진다. */
    var d = Math.min(global.devicePixelRatio || 1, 2);

    /* "이미 배치했나"는 sized 플래그로만 본다. floorCv.width 는 빈 캔버스의
       HTML 기본값(300)이라 배율이 우연히 1이 되는(창 너비 1280 이상) 흔한
       경우에 조기반환해 캔버스가 300x150 으로 굳는 사고가 났었다. */
    if (sized && s === scale && d === dpr) return scale;
    scale = s; dpr = d;
    sized = true;

    var cssW = Math.round(L.W * s), cssH = Math.round(L.H * s);
    [floorCv, actorsCv].forEach(function (cv) {
      cv.width = Math.round(L.W * s * d);
      cv.height = Math.round(L.H * s * d);
      cv.style.width = cssW + 'px';
      cv.style.height = cssH + 'px';
    });
    floorDirty = true;
    return scale;
  }

  function ctxOf(cv) {
    var c = cv.getContext('2d');
    c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    return c;
  }

  /* ---------- 판 하나에서 버튼·문 칸 위치를 뽑는다 ----------
     판이 바뀔 때만 다시 훑는다. 버튼·문 상태(눌렸나/열렸나)는 여기서
     안 정한다 — 위치만 캐시하고, 실제로 눌렸는지·열렸는지는 매 프레임
     state.door 를 그대로 읽는다. */
  function analyze(lv, lvIndex) {
    if (geo && geo.lv === lvIndex) return geo;
    var buttons = [], doors = [];
    for (var cy = 0; cy < L.ROWS; cy++) {
      for (var cx = 0; cx < L.COLS; cx++) {
        var t = lv.grid[cy * L.COLS + cx];
        var x = cx * L.TILE, y = cy * L.TILE;
        if (t === 'B') buttons.push({ x: x, y: y });
        else if (t === 'D') doors.push({ x: x, y: y });
      }
    }
    geo = { lv: lvIndex, buttons: buttons, doors: doors };
    return geo;
  }

  /* ---------- 바닥 (판이 바뀌거나 리사이즈될 때만) ----------
     여기 그리는 건 전부 판이 안 바뀌면 안 바뀌는 것들 — 벽과 출입구.
     버튼·문은 위치만 여기서 잡고, 눌림/열림 표시는 actors 레이어가 매
     프레임 그 자리 위에 덧그린다(state.door 를 그대로 읽는다). */
  function drawFloorLayer(ctx, lv, lvIndex) {
    deps();
    var g = analyze(lv, lvIndex);
    var TILE = L.TILE;

    ctx.clearRect(0, 0, L.W, L.H);
    ctx.fillStyle = '#150e2e';
    ctx.fillRect(0, 0, L.W, L.H);

    for (var cy = 0; cy < L.ROWS; cy++) {
      for (var cx = 0; cx < L.COLS; cx++) {
        var t = lv.grid[cy * L.COLS + cx];
        var x = cx * TILE, y = cy * TILE;
        if (t === '#') {
          fillRR(ctx, x + 1, y + 1, TILE - 2, TILE - 2, 4, '#241a52');
          ctx.fillStyle = 'rgba(163,92,255,.28)';       // --purple
          ctx.fillRect(x + 1, y + 1, TILE - 2, 3);
        } else if (t === '-') {
          /* 일방통행 — 얇게 그린다. 두껍게 그리면 벽처럼 보여서
             "밑에서 뚫고 올라간다"가 눈에 안 읽힌다. */
          fillRR(ctx, x + 1, y + 2, TILE - 2, 7, 3, '#3a2c6e');
          ctx.fillStyle = 'rgba(163,92,255,.5)';
          ctx.fillRect(x + 1, y + 2, TILE - 2, 2);
        } else if (t === '>' || t === '<') {
          /* 미는 바닥 — 화살표가 흐르는 방향을 말한다 */
          fillRR(ctx, x + 1, y + 1, TILE - 2, TILE - 2, 4, '#1d3350');
          var dir = (t === '>') ? 1 : -1;
          ctx.fillStyle = 'rgba(60,232,212,.7)';
          for (var a = 0; a < 3; a++) {
            var ax = x + 8 + a * 10, ay = y + TILE / 2;
            ctx.beginPath();
            ctx.moveTo(ax - dir * 4, ay - 5);
            ctx.lineTo(ax + dir * 4, ay);
            ctx.lineTo(ax - dir * 4, ay + 5);
            ctx.closePath();
            ctx.fill();
          }
        } else {
          /* 격자를 아주 옅게 — 완전히 평평하면 판이 밋밋해 보인다 */
          ctx.fillStyle = ((cx + cy) % 2) ? 'rgba(255,255,255,.020)' : 'rgba(255,255,255,.035)';
          ctx.fillRect(x, y, TILE, TILE);
        }
      }
    }

    /* 버튼·문 자리는 소켓만 미리 박아 둔다. 실제 빛(눌림/열림)은 actors 가
       매 프레임 위에 그린다 — 상태가 자주 바뀌는 걸 바닥에 두면 그때마다
       바닥 전체를 다시 그려야 한다. */
    for (var bi = 0; bi < g.buttons.length; bi++) {
      var b = g.buttons[bi];
      fillRR(ctx, b.x + 4, b.y + TILE - 10, TILE - 8, 8, 3, '#241a1a');
    }
    for (var di = 0; di < g.doors.length; di++) {
      var d = g.doors[di];
      ctx.strokeStyle = 'rgba(163,92,255,.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(d.x + 2, d.y + 2, TILE - 4, TILE - 4);
    }

    /* 출입구 — 전원이 여기 모여야 판이 끝난다. 늘 켜져 있는 표식으로
       "여기가 목표다"를 알린다. 실제 도착 판정은 그리지 않는다(player.done
       이 말한다). */
    if (lv.goal) {
      var gx = lv.goal.x, gy = lv.goal.y, gw = lv.goal.w, gh = lv.goal.h;
      ctx.save();
      ctx.shadowColor = '#3ce8d4';
      ctx.shadowBlur = 16;
      fillRR(ctx, gx + 2, gy + 2, gw - 4, gh - 4, 6, 'rgba(60,232,212,.14)');
      ctx.restore();
      ctx.strokeStyle = '#3ce8d4';
      ctx.lineWidth = 2;
      rr(ctx, gx + 2, gy + 2, gw - 4, gh - 4, 6);
      ctx.stroke();

      ctx.fillStyle = '#3ce8d4';
      ctx.font = '700 12px ui-monospace,Consolas,monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('EXIT', gx + gw / 2, gy - 6);
    }
  }

  /* ---------- 가시 ----------
     고정 가시는 늘, 깜빡이 가시는 지금 나와 있을 때만 그린다.
     "나와 있나"는 Sim.blinkOn 이 정한다 — 여기서 다시 재면 호스트와 어긋나
     화면에는 없는 가시에 죽는다. */
  function drawSpikes(ctx, lv, rt) {
    deps();
    var TILE = L.TILE;
    var on = Sim.blinkOn(lv, rt || 0);
    for (var cy = 0; cy < L.ROWS; cy++) {
      for (var cx = 0; cx < L.COLS; cx++) {
        var t = lv.grid[cy * L.COLS + cx];
        if (t !== '^' && t !== '!' && t !== '?') continue;
        var live = (t === '^') || (t === '!' ? on : !on);
        var x = cx * TILE, y = cy * TILE;
        if (!live) {
          /* 들어가 있어도 자리는 보여 준다. 안 그러면 "여기 가시가 있었나"를
             매번 새로 기억해야 해서 운으로 죽는다. */
          ctx.fillStyle = 'rgba(248,63,168,.16)';
          ctx.fillRect(x + 4, y + TILE - 5, TILE - 8, 3);
          continue;
        }
        ctx.save();
        ctx.fillStyle = '#f83fa8';
        ctx.shadowColor = '#f83fa8';
        ctx.shadowBlur = 8;
        for (var k = 0; k < 4; k++) {
          var sx = x + 2 + k * 9;
          ctx.beginPath();
          ctx.moveTo(sx, y + TILE);
          ctx.lineTo(sx + 4.5, y + TILE - 15);
          ctx.lineTo(sx + 9, y + TILE);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  /* ---------- 부서지는 발판 ----------
     cr[칸] 이 양수면 금이 간 채 버티는 중, 음수면 무너져 있는 중이다.
     금이 갔을 때 흔들어 주면 "곧 무너진다"가 말 없이 전해진다. */
  function drawCrumble(ctx, lv, cr, rt) {
    var TILE = L.TILE;
    for (var cy = 0; cy < L.ROWS; cy++) {
      for (var cx = 0; cx < L.COLS; cx++) {
        if (lv.grid[cy * L.COLS + cx] !== 'x') continue;
        var idx = cy * L.COLS + cx;
        var v = (cr && cr[idx]) || 0;
        var x = cx * TILE, y = cy * TILE;
        if (v < 0) {
          ctx.fillStyle = 'rgba(255,255,255,.05)';       // 무너진 자리
          ctx.fillRect(x + 3, y + 3, TILE - 6, 2);
          continue;
        }
        var shake = v > 0 ? Math.sin(rt * 40) * 1.5 : 0;
        fillRR(ctx, x + 1 + shake, y + 1, TILE - 2, TILE - 2, 4,
               v > 0 ? '#5a3a22' : '#3a2c1a');
        ctx.fillStyle = v > 0 ? 'rgba(255,217,61,.55)' : 'rgba(255,217,61,.25)';
        ctx.fillRect(x + 1 + shake, y + 1, TILE - 2, 3);
      }
    }
  }

  /* ---------- 움직이는 발판 ----------
     자리는 라운드 시각(rt)만으로 정해진다. 스냅샷에 실리는 것이 없어서
     모두의 화면이 저절로 같아진다 — grid.js 머리말 참고. */
  function drawMovers(ctx, lv, rt) {
    deps();
    for (var i = 0; i < lv.movers.length; i++) {
      var b = global.Grid.moverAt(lv.movers[i], rt || 0);
      ctx.save();
      ctx.shadowColor = '#3ce8d4';
      ctx.shadowBlur = 10;
      fillRR(ctx, b.x, b.y, b.w, b.h, 4, '#1c6f68');
      ctx.restore();
      ctx.fillStyle = '#3ce8d4';
      ctx.fillRect(b.x, b.y, b.w, 3);
    }
  }

  /* ---------- 버튼·문 (매 프레임, state.door 그대로) ----------
     doorT: 문이 닫히기까지 남은 시간(초). 숫자는 state 에서 그대로 받는다 —
     여기서 다시 재면(마지막으로 버튼이 언제 떨어졌는지 등) 호스트와 어긋난다.
     닫혀 있을 때(문이 애초에 안 열렸을 때)는 0 이라 막대·숫자가 안 나온다. */
  function drawSwitches(ctx, lv, lvIndex, doorOpen, doorT) {
    var g = analyze(lv, lvIndex);
    var TILE = L.TILE;

    for (var bi = 0; bi < g.buttons.length; bi++) {
      var b = g.buttons[bi];
      var color = doorOpen ? '#ffd93d' : '#7a6a2a';        // --yellow, 안 눌리면 어둡다
      ctx.save();
      if (doorOpen) { ctx.shadowColor = '#ffd93d'; ctx.shadowBlur = 12; }
      fillRR(ctx, b.x + 5, b.y + TILE - (doorOpen ? 7 : 9), TILE - 10, doorOpen ? 5 : 3, 2, color);
      ctx.restore();
    }
    for (var di = 0; di < g.doors.length; di++) {
      var d = g.doors[di];
      if (doorOpen) {
        /* 열린 문 — 지나갈 수 있으니 안이 비어 보여야 한다 */
        ctx.fillStyle = 'rgba(60,232,212,.10)';
        ctx.fillRect(d.x + 3, d.y + 3, TILE - 6, TILE - 6);

        /* 남은 시간 — 이제 버튼을 뗀다고 바로 안 닫히니, "곧 닫힌다"는
           긴장을 눈에 보이는 시계로 대신 준다. 막대 길이는 눈금(DOOR_LINGER)
           대비 비율이고, 숫자는 doorT 를 그대로 찍는다. Sim 이 없으면(레이아웃
           테스트 등) 막대 없이 숫자만 보여준다. */
        if (typeof doorT === 'number' && doorT > 0) {
          var full = (Sim && Sim.DOOR_LINGER) || doorT;
          var frac = Math.max(0, Math.min(1, doorT / full));
          var urgent = frac < 0.3;
          var barW = TILE - 8;
          ctx.fillStyle = 'rgba(255,255,255,.18)';
          ctx.fillRect(d.x + 4, d.y - 7, barW, 3);
          ctx.fillStyle = urgent ? '#f83fa8' : '#3ce8d4';
          ctx.fillRect(d.x + 4, d.y - 7, barW * frac, 3);

          ctx.fillStyle = urgent ? '#f83fa8' : '#3ce8d4';
          ctx.font = '700 11px ui-monospace,Consolas,monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(doorT.toFixed(1), d.x + TILE / 2, d.y - 9);
        }
      } else {
        /* 닫힌 문 — 벽처럼 막혀 보여야 한다 */
        fillRR(ctx, d.x + 2, d.y + 2, TILE - 4, TILE - 4, 3, '#3a2050');
        ctx.fillStyle = 'rgba(248,63,168,.35)';            // --pink
        ctx.fillRect(d.x + 2, d.y + 2, TILE - 4, 3);
      }
    }
  }

  /* ---------- 진행 표시 ----------
     전원 도착이 이 게임의 전부다 — 몇 명이 이미 나갔고 몇 명이 남았는지가
     항상 보여야 "저 사람 때문에 다들 기다린다"가 화면만 보고도 읽힌다. */
  function drawProgress(ctx, state, who, pids) {
    var done = 0;
    for (var i = 0; i < pids.length; i++) if (state.players[pids[i]].done) done++;

    var text = '도착 ' + done + ' / ' + pids.length;
    ctx.font = '700 13px ui-monospace,Consolas,monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    var tw = ctx.measureText(text).width;

    var pipR = 6, gap = 4;
    var pipsW = pids.length * (pipR * 2 + gap) - gap;
    var boxW = 16 + tw + 14 + pipsW + 10;
    var boxH = 26, bx = 12, by = 10;

    fillRR(ctx, bx, by, boxW, boxH, 8, 'rgba(10,7,26,.72)');
    ctx.fillStyle = done === pids.length ? '#3ce8d4' : '#eaf6ff';
    ctx.fillText(text, bx + 12, by + boxH / 2);

    var px = bx + 12 + tw + 14;
    var py = by + boxH / 2;
    for (var k = 0; k < pids.length; k++) {
      var p = state.players[pids[k]];
      var w = (who && who[pids[k]]) || null;
      var ci = w ? (w.char | 0) : 0;
      var col = (global.Sprite.CHARS[ci] || global.Sprite.CHARS[0]).color;
      ctx.beginPath();
      ctx.arc(px + pipR, py, pipR, 0, Math.PI * 2);
      if (p.done) { ctx.fillStyle = col; ctx.fill(); }
      else { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); }
      px += pipR * 2 + gap;
    }
  }

  /* ---------- 매 프레임 ----------
     state: Sim.tick 또는 Snap.unpack 이 만든, 이미 보간까지 끝난 세계.
            door, players[].sup, players[].done 을 그대로 읽는다 — 여기서
            다시 판정하면 호스트와 화면이 갈린다.
     who:   닉네임·캐릭터 번호 (rooms/<code>/who 사본)
     me:    내 pid — 내 캐릭터만 발밑에 고리를 둔다 */
  function drawActors(ctx, state, who, me, dt) {
    deps();
    ctx.clearRect(0, 0, L.W, L.H);
    if (!state) return;

    var lv = L.LIST[state.lv];
    /* 그리는 순서가 곧 겹치는 순서다. 발판을 사람보다 먼저 그려야
       "타고 있다"가 보인다. 가시는 발판 위에 그려야 "저기 밟으면 죽는다"가
       보인다. 부서지는 발판은 바닥 성격이라 제일 아래. */
    drawCrumble(ctx, lv, state.cr, state.rt || 0);
    drawMovers(ctx, lv, state.rt || 0);
    drawSpikes(ctx, lv, state.rt || 0);
    drawSwitches(ctx, lv, state.lv, !!state.door, state.doorT);

    var pids = Object.keys(state.players).sort();

    /* 캐릭터 — y 가 큰 사람(더 아래, 화면 앞쪽)이 나중에 그려진다. 안 그러면
       위에 올라선 사람이 받쳐 주는 사람 뒤로 가려 "누구를 밟고 있나"가
       안 보인다. */
    var order = pids.slice().sort(function (a, b) {
      return state.players[a].y - state.players[b].y;
    });

    /* 밟히고 있는 사람의 이름표는 감춘다. 이름표는 항상 자기 머리 바로
       위에 뜨는데, 누가 그 머리를 밟고 서면 밟은 사람의 발이 정확히 그
       자리를 차지해서 이름표와 겹쳐 뭉갠다. sup===2(남을 밟고 있다)인
       사람의 발밑 자리를 찾아 그 밑에 있는 사람 표시만 끈다 — 밟은 쪽
       이름표는 그대로 보이니 "누가 위에 있는지"는 여전히 읽힌다. */
    var buried = {};
    for (var bi2 = 0; bi2 < order.length; bi2++) {
      var rider = state.players[order[bi2]];
      if (rider.sup !== 2) continue;
      for (var bj = 0; bj < order.length; bj++) {
        if (bi2 === bj) continue;
        var base = state.players[order[bj]];
        var overlapX = (rider.x + L.PW > base.x + 4) && (rider.x < base.x + L.PW - 4);
        if (overlapX && Math.abs((rider.y + L.PH) - base.y) < 2) {
          buried[order[bj]] = true;
          break;
        }
      }
    }

    for (var i = 0; i < order.length; i++) {
      var pid = order[i];
      var p = state.players[pid];
      var w = (who && who[pid]) || null;
      var ci = w ? (w.char | 0) : 0;
      var cx = p.x + L.PW / 2, feetY = p.y + L.PH;

      /* 걷는 위상: 화면상 얼마나 움직였는지로 만든다. 도착한 사람은 위상을
         멈춰 둔다 — 출입구 안에서 다리가 계속 흔들리면 "아직 뭘 하고
         있나" 처럼 보인다. */
      var wk = walk[pid];
      if (!wk) wk = walk[pid] = { x: p.x, y: p.y, ph: 0 };
      var dx = p.x - wk.x, dy = p.y - wk.y;
      var moved = Math.sqrt(dx * dx + dy * dy);
      wk.x = p.x; wk.y = p.y;
      if (!p.done) {
        wk.ph += moved * 0.35;
        if (moved < 0.05) wk.ph = 0;
      }

      if (pid === me) {
        /* 내 캐릭터 발밑에만 고리를 둔다. 8명이 쌓인 화면에서 "어느 게
           나지"를 못 찾으면 아무것도 못 한다. */
        ctx.strokeStyle = 'rgba(60,232,212,.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, feetY, 14, 6, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      /* 남의 머리 위에 서 있으면(sup===2) 발밑에 짧은 표시를 준다 —
         "지금 발판이 사람"이라는 걸 알아야 그 발판이 움직이는 순간을
         이해하고 대비한다. 도착 판정과 마찬가지로 sup 값을 그대로 읽는다. */
      if (p.sup === 2) {
        ctx.strokeStyle = 'rgba(255,255,255,.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 9, feetY - 1);
        ctx.lineTo(cx + 9, feetY - 1);
        ctx.stroke();
      }

      global.Sprite.draw(ctx, p.x, p.y, p.face, ci, p.vx, p.vy, wk.ph);

      /* 도착한 사람은 은은한 완료 표시를 얹는다 — 출입구 안에 서 있는
         그림만으로는 배경 색과 헷갈릴 수 있다. */
      if (p.done) {
        ctx.fillStyle = 'rgba(60,232,212,.9)';
        ctx.font = '700 11px ui-monospace,Consolas,monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('✓', cx, p.y - 14);
      }

      /* 이름표 — 밟히고 있으면 안 그린다(바로 위 주석 참고) */
      var nm = (w && w.name) || '';
      if (nm && !buried[pid]) {
        ctx.font = '700 10px ui-monospace,Consolas,monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        var ny = p.y - 2;
        ctx.fillStyle = 'rgba(10,7,26,.75)';
        var tw = ctx.measureText(nm).width + 8;
        fillRR(ctx, cx - tw / 2, ny - 11, tw, 12, 3, 'rgba(10,7,26,.75)');
        ctx.fillStyle = (pid === me) ? '#3ce8d4' : '#eaf6ff';
        ctx.fillText(nm, cx, ny);
      }
    }

    /* 나간 사람의 위상 기록은 버린다 — 안 지우면 긴 판에서 계속 쌓인다 */
    for (var k in walk) {
      if (!Object.prototype.hasOwnProperty.call(walk, k)) continue;
      if (!state.players[k]) delete walk[k];
    }

    drawProgress(ctx, state, who, pids);

    if (dt) { /* dt 는 지금은 안 쓴다. 위상은 이동량으로만 만든다. */ }
  }

  function draw(floorCv, actorsCv, state, who, me, dt) {
    deps();
    if (!state) return;

    /* 판이 바뀌면 리사이즈가 없어도 바닥을 다시 그려야 한다 — 오버워크드는
       판이 하나라 이 문제가 없었지만, 여기는 판이 3개다. */
    if (state.lv !== lastLv) {
      lastLv = state.lv;
      floorDirty = true;
    }

    if (floorDirty) {
      drawFloorLayer(ctxOf(floorCv), L.LIST[state.lv], state.lv);
      floorDirty = false;
    }
    drawActors(ctxOf(actorsCv), state, who, me, dt);
  }

  global.View = {
    layout: layout,
    draw: draw,
    dirty: function () { floorDirty = true; },
    scale: function () { return scale; }
  };
})(window);
