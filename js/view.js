/* ============================================================
   오버워크드 — 그리기

   이 파일은 판정을 하지 않는다. "이 사람이 기계에 닿았나", "이걸 놓을 수
   있나"를 여기서 다시 계산하면 호스트와 답이 갈려서, 화면에는 닿았다고
   나오는데 눌러도 아무 일이 안 일어나는 상태가 된다. 필요한 것은 전부
   스냅샷에 들어 있다. 여기서 하는 계산은 걷는 위상(다리 흔들기)처럼
   틀려도 아무도 손해 보지 않는 것뿐이다.

   ── 캔버스가 두 장인 이유 ───────────────────────────────
   #floor(맵·기계 몸통)는 창 크기가 바뀔 때만 다시 그린다. #actors(캐릭터·
   물건·진행 막대)만 매 프레임이다. 맵을 60Hz 로 다시 그리면 타일 576개와
   기계 5개를 초당 60번 칠하게 되는데, 8명이 붙은 방에서 이건 느린 PC 가
   먼저 죽는 이유가 된다.

   ── 좌표 ────────────────────────────────────────────────
   전부 1280x720 디자인 좌표다. 배율은 setTransform 으로 ctx 에 한 번만
   걸고, 그 뒤로는 아무도 곱하지 않는다. 그리는 코드가 배율을 알면 어딘가
   한 군데는 반드시 곱하는 걸 잊는다.
   ============================================================ */
(function (global) {
  'use strict';

  var W = null, St = null;
  function deps() {
    if (!W) W = global.World;
    if (!St) St = global.Stations;
  }

  var TILE = 40;
  var scale = 1, dpr = 1;
  var floorDirty = true;
  var sized = false;            // "이미 캔버스를 배치했다" — width 로 추측하지 않는다.
                                 // 빈 <canvas> 의 기본값(300)이 우연히 배율 1과
                                 // 맞아떨어지는 창(1280 이상 너비)에서 첫 호출이
                                 // 조기반환해 캔버스가 300x150 으로 굳는 사고가 났다.

  /* 기계 색 — 물건 색과 같은 계열로 맞춘다. 모델링대(마젠타)에서 나온 것이
     마젠타 덩어리라는 게 색으로 바로 읽혀야 한다. */
  var MACH = {
    ref:    { top: '#6b5fb0', glow: '#9b8fd0' },
    model:  { top: '#b02a72', glow: '#f83fa8' },
    retopo: { top: '#1a7d74', glow: '#3ce8d4' },
    uv:     { top: '#b09220', glow: '#ffd93d' },
    bake:   { top: '#a04a20', glow: '#ff7a3a' },
    rig:    { top: '#6a35a8', glow: '#a35cff' },
    farm:   { top: '#4a5570', glow: '#9fb4ff' },
    ship:   { top: '#8a6a12', glow: '#ffd93d' },
    bin:    { top: '#3a3547', glow: '#6b6480' }
  };

  /* 걷는 위상은 화면에서만 쓰는 값이라 여기서 갖는다. 시뮬레이션에 넣으면
     스냅샷에 실려 전송량만 늘고, 어차피 남의 tap/seq 는 오지도 않는다. */
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

    var s = Math.min(global.innerWidth / W.W, global.innerHeight / W.H);
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

    var cssW = Math.round(W.W * s), cssH = Math.round(W.H * s);
    [floorCv, actorsCv].forEach(function (cv) {
      cv.width = Math.round(W.W * s * d);
      cv.height = Math.round(W.H * s * d);
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

  /* ---------- 바닥 (바뀔 때만) ---------- */
  function drawFloorLayer(ctx, map) {
    deps();
    ctx.clearRect(0, 0, W.W, W.H);

    /* 바닥 */
    ctx.fillStyle = '#150e2e';
    ctx.fillRect(0, 0, W.W, W.H);

    for (var cy = 0; cy < map.rows; cy++) {
      for (var cx = 0; cx < map.cols; cx++) {
        var t = map.grid[cy * map.cols + cx];
        var x = cx * TILE, y = cy * TILE;
        if (t === '#') {
          fillRR(ctx, x + 1, y + 1, TILE - 2, TILE - 2, 4, '#241a52');
          ctx.fillStyle = 'rgba(163,92,255,.28)';
          ctx.fillRect(x + 1, y + 1, TILE - 2, 3);
        } else if (t === 'S') {
          fillRR(ctx, x + 1, y + 1, TILE - 2, TILE - 2, 4, '#1d1441');
        } else {
          /* 격자를 아주 옅게 — 바닥이 완전히 평평하면 속도감이 안 난다 */
          ctx.fillStyle = ((cx + cy) % 2) ? 'rgba(255,255,255,.020)' : 'rgba(255,255,255,.035)';
          ctx.fillRect(x, y, TILE, TILE);
        }
      }
    }

    /* 기계 몸통과 이름. 이름은 여기(바닥)에 그린다 — 매 프레임 한글 다섯 자를
       다섯 번 쓰면 텍스트 레이아웃이 프레임 예산을 갉아먹는다. */
    for (var i = 0; i < map.stations.length; i++) {
      var s = map.stations[i];
      var d = MACH[s.type] || MACH.bin;
      var def = St.get(s.type);
      var isBin = s.type === 'bin';
      var w = isBin ? 40 : 72, h = isBin ? 40 : 40;
      var bx = s.cx - w / 2, by = s.cy - h / 2;

      /* 벽에 붙은 기계는 두 칸(SS)을 차지한다. cx 는 안쪽 칸의 가운데라
         바깥쪽으로 반 칸 밀어야 두 칸을 정확히 덮는다. */
      if (!isBin) bx = (s.cx < W.W / 2) ? s.cx - 56 : s.cx - 16;

      ctx.save();
      ctx.shadowColor = d.glow;
      ctx.shadowBlur = 14;
      fillRR(ctx, bx, by, w, h, 7, '#0e0a24');
      ctx.restore();

      fillRR(ctx, bx + 2, by + 2, w - 4, h - 4, 6, d.top);
      fillRR(ctx, bx + 5, by + 5, w - 10, h - 16, 4, 'rgba(10,7,26,.55)');

      ctx.fillStyle = d.glow;
      ctx.font = '700 11px ui-monospace,Consolas,monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var ly = (s.cy < W.H / 2) ? by + h + 11 : by - 11;
      ctx.fillText(def ? def.name : s.type, s.cx, ly);
    }
  }

  /* ---------- 진행 막대 ----------
     tap 기계는 "몇 번 두드렸나"(0..work), wait 기계는 익음(0..1)과
     탐(1..2)이다. 익은 뒤 타는 구간은 색을 바꿔서 "지금 가야 한다"를 알린다. */
  function drawProgress(ctx, m, def, cx, cy) {
    if (!def || !m.item) return;
    var frac = 0, color = '#3ce8d4';

    if (def.mode === 'tap') {
      if (!St.canAccept(m.type, m.item)) return;    // 다 된 물건은 막대가 없다
      frac = def.work ? (m.prog || 0) / def.work : 0;
      color = '#ffd93d';
    } else if (def.mode === 'wait') {
      var p = m.prog || 0;
      if (p <= 1) { frac = p; }
      else { frac = p - 1; color = '#f83fa8'; }     // 타는 중
    } else {
      return;
    }
    if (frac <= 0) return;
    if (frac > 1) frac = 1;

    var w = 44, x = cx - w / 2, y = cy + 14;
    fillRR(ctx, x - 1, y - 1, w + 2, 7, 3, 'rgba(10,7,26,.8)');
    fillRR(ctx, x, y, w * frac, 5, 2, color);
  }

  /* ---------- 매 프레임 ----------
     state: 이미 보간까지 끝난 "지금 그리는 세계". 여기서 더 손대지 않는다.
     who:   닉네임·캐릭터 번호 (rooms/<code>/who 사본)
     me:    내 pid — 내 캐릭터만 발밑에 표시를 둔다 */
  function drawActors(ctx, state, who, me, dt) {
    deps();
    ctx.clearRect(0, 0, W.W, W.H);
    if (!state) return;

    var i, pid;

    /* 기계 위의 물건과 진행 막대 */
    for (i = 0; i < state.map.stations.length; i++) {
      var s = state.map.stations[i];
      var m = state.machines[s.id];
      if (!m) continue;
      var def = St.get(m.type);
      if (m.item) global.Sprite.drawItem(ctx, s.cx, s.cy - 2, m.item, scale);
      drawProgress(ctx, m, def, s.cx, s.cy);
    }

    /* 캐릭터 — y 가 큰 사람이 앞이다. 안 그러면 위쪽 사람이 아래쪽 사람 위에
       겹쳐 그려져서 누가 앞에 선 건지 안 보인다. */
    var pids = Object.keys(state.players).sort(function (a, b) {
      return state.players[a].y - state.players[b].y;
    });

    for (i = 0; i < pids.length; i++) {
      pid = pids[i];
      var p = state.players[pid];
      var w = (who && who[pid]) || null;
      var ci = w ? (w.char | 0) : 0;
      var gear = (w && w.gear) || null;

      /* 걷는 위상: 화면상 얼마나 움직였는지로 만든다. 남의 tap/seq 는
         스냅샷에 없어서(전송량 때문에 뺐다) 애니메이션의 근거로 못 쓴다. */
      var wk = walk[pid];
      if (!wk) { wk = walk[pid] = { x: p.x, y: p.y, ph: 0 }; }
      var dx = p.x - wk.x, dy = p.y - wk.y;
      var moved = Math.sqrt(dx * dx + dy * dy);
      wk.x = p.x; wk.y = p.y;
      wk.ph += moved * 0.30;
      if (moved < 0.05) wk.ph = 0;                 // 서면 다리를 모은다

      if (pid === me) {
        /* 내 캐릭터 발밑에만 고리를 둔다. 8명이 비슷하게 생긴 화면에서
           "어느 게 나지"를 못 찾으면 아무것도 못 한다. */
        ctx.strokeStyle = 'rgba(60,232,212,.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + 12, 14, 6, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      global.Sprite.draw(ctx, p.x, p.y, p.dir, ci, gear, p.hold, scale, wk.ph);

      /* 이름표 */
      var nm = (w && w.name) || '';
      if (nm) {
        ctx.font = '700 10px ui-monospace,Consolas,monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        var ny = p.y - (p.hold ? 42 : 30);
        ctx.fillStyle = 'rgba(10,7,26,.75)';
        var tw = ctx.measureText(nm).width + 8;
        fillRR(ctx, p.x - tw / 2, ny - 11, tw, 12, 3, 'rgba(10,7,26,.75)');
        ctx.fillStyle = (pid === me) ? '#3ce8d4' : '#eaf6ff';
        ctx.fillText(nm, p.x, ny);
      }
    }

    /* 나간 사람의 위상 기록은 버린다 — 안 지우면 긴 판에서 계속 쌓인다 */
    for (pid in walk) {
      if (!Object.prototype.hasOwnProperty.call(walk, pid)) continue;
      if (!state.players[pid]) delete walk[pid];
    }

    if (dt) { /* dt 는 지금은 안 쓴다. 위상은 이동량으로만 만든다. */ }
  }

  function draw(floorCv, actorsCv, state, who, me, dt) {
    if (!state) return;
    if (floorDirty) {
      drawFloorLayer(ctxOf(floorCv), state.map);
      floorDirty = false;
    }
    drawActors(ctxOf(actorsCv), state, who, me, dt);
  }

  global.View = {
    layout: layout,
    draw: draw,
    dirty: function () { floorDirty = true; },
    scale: function () { return scale; },
    MACH: MACH
  };
})(window);
