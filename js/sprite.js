/* ============================================================
   모코파크 — 캐릭터 그리기 (옆에서 보는 몸)

   오버워크드는 위에서 내려다본 몸이었다. 여기는 옆에서 본다 — 서로 머리
   위에 올라서는 게임이라 "발이 어디 닿았나"가 위가 아니라 옆에서 보여야
   한다. 가져온 것은 얼굴 사진 로딩·픽셀화(26px 로 줄였다 그대로 키우기)
   뿐이고, 이게 이 시리즈의 농담이라 절대 안 건드린다. 몸통은 새로 짰다.

   ── 몸이 Levels.PW x Levels.PH 를 벗어나면 안 되는 이유 ─────
   물리는 28x36 상자로 충돌을 본다. 그림이 상자보다 크면 화면에서는
   붙어 보이는데 실제로는 안 닿아서 "붙었는데 왜 안 눌리지"가 나온다.
   반대로 상자보다 작으면 틈이 떠 보인다. 그림을 상자에 정확히 맞춘다.

   ── (x, y) 가 왼쪽 위인 이유 ─────────────────────────────
   Sim 의 플레이어 좌표가 몸통 왼쪽 위다. 여기서 중심 좌표로 바꿔치기하면
   변환을 두 군데(sim, sprite)에서 따로 관리하게 되어 언젠가 어긋난다.

   ── 왼쪽/오른쪽을 좌우 반전 하나로 처리하는 이유 ────────────
   탑다운은 네 방향이 다 달라야 했지만 옆에서 보는 몸은 오른쪽을 그려서
   뒤집으면 왼쪽이 나온다. 그림을 두 벌 그릴 이유가 없다.
   ============================================================ */
(function (global) {
  'use strict';

  var Lv = null;
  function deps() { if (!Lv) Lv = global.Levels; }

  /* 캐릭터마다 고유색을 강하게 준다. 이 게임의 전부가 "서로 머리 위에
     쌓기"라, 8명이 탑을 이뤘을 때 색만 보고 누구인지 갈라야 한다.
     무지개 순서로 최대한 떨어뜨려 놓았다 — 이름 옆 색이 아니라 "그 사람의
     색"이 되려면 서로 헷갈리면 안 된다. */
  var CHARS = [
    { name: '숭한 라이언',     color: '#ff5252', hair: '#2a2018', skin: '#f0c49a' },
    { name: '박팀장님',        color: '#ffa726', hair: '#241c16', skin: '#f2c9a2' },
    { name: '송마라톤',        color: '#ffee58', hair: '#33251a', skin: '#eec096' },
    { name: '내가 진짜 주희',  color: '#66bb6a', hair: '#26201a', skin: '#f3cba6' },
    { name: '서론 머스크',     color: '#26c6da', hair: '#262019', skin: '#efc298' },
    { name: '모탄소년단',      color: '#5c6bc0', hair: '#1f1812', skin: '#f0c49a' },
    { name: '치이카와',        color: '#ab47bc', hair: '#2b2118', skin: '#f1c69e' },
    { name: '누렁이',          color: '#ec407a', hair: '#1d1712', skin: '#f4cda8' }
  ];

  var OUT = '#14161f';          // 외곽선. 어두운 바닥 위에서도 실루엣이 산다.

  /* ---------- 실사 얼굴 ----------
     img/face/<번호>.jpg. 앞자리 숫자가 캐릭터 번호다 — 퇴근의 계단·
     오버워크드와 같은 규칙. 없거나 못 읽으면 faces[i] 가 비어 있고, 그러면
     그린 얼굴로 떨어진다. 사진 하나가 빠졌다고 게임이 죽으면 안 된다. */
  var FACE_PX = 26;
  var faces = [];
  var onFaceLoad = null;        // 대기실 미리보기를 다시 그리라는 신호

  (function loadFaces() {
    for (var i = 0; i < CHARS.length; i++) {
      (function (idx) {
        var im = new global.Image();
        im.onload = function () {
          if (!im.naturalWidth) return;
          faces[idx] = { img: im, small: null };
          if (onFaceLoad) onFaceLoad(idx);
        };
        im.onerror = function () { /* 그린 얼굴로 간다 */ };
        im.src = 'img/face/' + (idx + 1) + '.jpg';
      })(i);
    }
  })();

  /* 26px 로 줄여 둔 얼굴을 캐시한다. 매 프레임 원본을 축소하면 8명 x 60Hz 로
     큰 JPEG 를 리샘플하게 되어 느린 PC 가 먼저 죽는다. */
  function faceCanvas(f) {
    if (f.small) return f.small;
    var cv = global.document.createElement('canvas');
    cv.width = FACE_PX; cv.height = FACE_PX;
    var c = cv.getContext('2d');
    var iw = f.img.naturalWidth, ih = f.img.naturalHeight;
    /* 인물 사진은 얼굴이 위쪽 1/3 에 온다. 정사각형을 그냥 자르면 어깨까지
       들어와 머리통이 몸통보다 커 보인다. 얼굴 중심을 높이의 38% 로 보고 자른다. */
    var sq = Math.min(iw, ih) * 0.78;
    var sx = (iw - sq) / 2;
    var sy = ih * 0.38 - sq / 2;
    if (sy < 0) sy = 0;
    if (sy + sq > ih) sy = ih - sq;
    c.drawImage(f.img, sx, sy, sq, sq, 0, 0, FACE_PX, FACE_PX);
    f.small = cv;
    return cv;
  }

  function chr(i) {
    var n = (i | 0);
    if (n < 0 || n >= CHARS.length) n = 0;
    return CHARS[n];
  }

  /* 진한 그림자색 — 신발·팔 음영을 색마다 따로 안 두려고 곱셈으로 만든다 */
  function darken(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.round(((n >> 16) & 255) * f);
    var g = Math.round(((n >> 8) & 255) * f);
    var b = Math.round((n & 255) * f);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

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
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /* 외곽선을 도형 뒤에 한 겹 부풀려 깔아 만든다. stroke 를 쓰면 스케일이
     작을 때 선이 반 픽셀로 갈려 지저분해진다. */
  function plate(ctx, x, y, w, h, r, color) {
    fillRR(ctx, x - 1.2, y - 1.2, w + 2.4, h + 2.4, r + 1, OUT);
    fillRR(ctx, x, y, w, h, r, color);
  }

  /* ---------- 얼굴 ----------
     사진이 없을 때 쓰는 그린 얼굴. 옆모습이라 눈 하나만 있으면 충분하고,
     그 위치가 "오른쪽을 본다"는 걸 알려준다(그리는 좌표계는 항상 오른쪽
     기준이고, 왼쪽은 draw() 가 통째로 좌우 반전해서 만든다). */
  function drawDrawnFace(ctx, cx, cy, g) {
    ctx.fillStyle = g.skin;
    rr(ctx, cx - 8, cy - 8, 16, 17, 6); ctx.fill();
    ctx.fillStyle = '#22202c';
    ctx.fillRect(cx + 3, cy - 2, 3, 3);
  }

  /* head 는 항상 "오른쪽을 보는" 로컬 좌표계로 그린다. draw() 가 face 가
     -1 이면 캔버스를 통째로 뒤집으므로 여기서 방향을 따로 안 챙긴다. */
  function drawHead(ctx, cx, cy, g, ci) {
    var f = faces[ci];
    plate(ctx, cx - 9, cy - 9, 18, 18, 6, g.hair);   // 머리(=머리카락)가 바탕

    ctx.save();
    rr(ctx, cx - 7, cy - 6, 14, 15, 5);
    ctx.clip();
    if (f) {
      /* 픽셀화 — 26px 짜리를 부드럽게 안 늘리고 그대로 키운다. 몸통이
         납작한 색면이라 사진만 매끈하면 붙여 놓은 스티커처럼 보인다. */
      var sm = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(faceCanvas(f), cx - 8, cy - 7, 16, 16);
      ctx.imageSmoothingEnabled = sm;
    } else {
      drawDrawnFace(ctx, cx, cy, g);
    }
    ctx.restore();
  }

  /* ---------- 몸통 ----------
     로컬 상자는 (0,0)-(PW,PH), 오른쪽을 보는 자세로 고정해서 그린다.
     draw() 가 face 에 따라 이 상자를 통째로 뒤집는다.

     motion: 'stand' | 'walk' | 'rise' | 'fall'
       stand — 다리 모음, 가만히
       walk  — phase 로 다리를 앞뒤로 흔든다 (걷기)
       rise  — vy<0. 뛰어오르는 중이라 다리를 몸 쪽으로 접는다
       fall  — vy>0. 떨어지는 중이라 다리를 벌려 착지에 대비한다
     이 넷이면 "지금 뭘 하고 있는지"가 멈춘 그림 없이도 읽힌다. */
  function bodyLocal(ctx, g, ci, motion, phase) {
    var PW = Lv.PW, PH = Lv.PH;
    var legTop = PH - 12;
    var swing = motion === 'walk' ? Math.sin(phase) * 5 : 0;
    var shade = darken(g.color, 0.55);

    /* 뒷다리 먼저(더 어둡게) — 입체감. 앞다리가 그 위를 덮는다. */
    if (motion === 'rise') {
      /* 접어 올린 다리 — 상자 안에서 짧게 */
      fillRR(ctx, PW / 2 - 6, legTop - 4, 5, 10, 2, shade);
      fillRR(ctx, PW / 2 + 1, legTop - 4, 5, 10, 2, g.hair);
    } else if (motion === 'fall') {
      /* 착지 대비 — 벌린 다리 */
      fillRR(ctx, PW / 2 - 10, legTop, 6, 12, 2, shade);
      fillRR(ctx, PW / 2 + 4, legTop, 6, 12, 2, g.hair);
    } else {
      /* stand / walk — 걸을 때만 앞뒤로 어긋난다 */
      fillRR(ctx, PW / 2 - 6 - swing * 0.4, legTop + Math.abs(swing) * 0.15, 6, 12, 2, shade);
      fillRR(ctx, PW / 2 + swing * 0.4, legTop - Math.abs(swing) * 0.15, 6, 12, 2, g.hair);
    }

    /* 몸통 */
    var bob = motion === 'walk' ? Math.abs(Math.sin(phase)) * 1 : (motion === 'rise' ? -2 : (motion === 'fall' ? 1 : 0));
    var tx = 4, ty = 10 + bob, tw = PW - 8, th = 16;
    plate(ctx, tx, ty, tw, th, 6, g.color);

    /* 팔 — 뛸 때는 위로, 떨어질 때는 벌려서 균형을 잡는 실루엣 */
    if (motion === 'rise') {
      plate(ctx, PW - 8, ty - 6, 6, 10, 3, shade);
    } else if (motion === 'fall') {
      plate(ctx, PW - 9, ty + 2, 7, 11, 3, shade);
    } else {
      var aswing = motion === 'walk' ? Math.sin(phase + Math.PI) * 3 : 0;
      plate(ctx, PW - 8, ty + 3 + aswing, 6, 10, 3, shade);
    }

    /* 머리 — 몸통 위. 뛸 때 살짝 위로 따라간다 */
    drawHead(ctx, PW / 2, ty - 8 + (bob < 0 ? bob : 0), g, ci);
  }

  /* ---------- 매 프레임 ----------
     x, y: 몸통 왼쪽 위(Sim 좌표 그대로). face: 1|-1.
     vx, vy: 지금 속도 — 여기서 상태만 고른다(오르는지/내려가는지/걷는지),
     실제 위치 판정은 여기서 다시 안 한다(호스트 값을 그대로 믿는다).
     phase: 걷기 위상(라디안). 서 있거나 공중이면 이 값은 안 쓴다. */
  function draw(ctx, x, y, face, charIndex, vx, vy, phase) {
    deps();
    var g = chr(charIndex);

    var motion = 'stand';
    if (vy < -1) motion = 'rise';
    else if (vy > 1) motion = 'fall';
    else if (vx) motion = 'walk';

    ctx.save();
    ctx.translate(x, y);

    /* 그림자 — 발밑에 고정. 몸이 접히거나 흔들려도 그림자는 안 흔들려야
       "떠 있다"는 착각이 안 생긴다. */
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath();
    ctx.ellipse(Lv.PW / 2, Lv.PH - 1, Lv.PW / 2 - 3, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    if (face < 0) {
      /* 왼쪽을 보면 상자를 통째로 뒤집는다 — 그림을 두 벌 그릴 이유가 없다 */
      ctx.translate(Lv.PW, 0);
      ctx.scale(-1, 1);
    }
    bodyLocal(ctx, g, charIndex | 0, motion, phase || 0);

    ctx.restore();
  }

  /* ---------- 대기실 미리보기 ----------
     (0,0)~(w,h) 상자 안에 오른쪽을 보고 선 캐릭터를 꽉 차게 그린다.
     gear 는 이 게임에 없다(밀기·들기 같은 장비 상호작용을 안 넣는다) —
     매개변수는 hud.js 의 호출 계약을 지키려고 남겨 두지만 쓰지 않는다. */
  function preview(ctx, w, h, charIndex, gear) {
    deps();
    if (gear) { /* 이 게임엔 장비가 없다 — 계약 유지용 매개변수 */ }
    var s = Math.min(w / (Lv.PW + 16), h / (Lv.PH + 10));
    ctx.save();
    ctx.translate((w - Lv.PW * s) / 2, (h - Lv.PH * s) / 2);
    ctx.scale(s, s);
    draw(ctx, 0, 0, 1, charIndex, 0, 0, 0);
    ctx.restore();
  }

  global.Sprite = {
    CHARS: CHARS,
    FACE_PX: FACE_PX,
    draw: draw,
    preview: preview,
    hasFace: function (i) { return !!faces[i]; },
    /* 사진은 늦게 온다. 대기실이 이미 떠 있으면 다시 그려야 그 자리에서 바뀐다. */
    onFaceLoad: function (fn) { onFaceLoad = fn; }
  };
})(window);
