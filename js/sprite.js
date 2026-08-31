/* ============================================================
   오버워크드 — 캐릭터와 물건 그리기 (탑다운)

   퇴근의 계단은 옆에서 본 캐릭터였다. 여기는 위에서 내려다보므로 몸이 다르다.
   가져온 것은 얼굴 사진 로딩·픽셀화(26px 로 줄였다 키우기)와
   [가운데x, 아래y, 너비, 높이, 색] 파츠 좌표계뿐이고, 몸통은 새로 썼다.

   ── 크기를 32x40 으로 잡은 이유 ─────────────────────────
   World.R(14) 의 두 배쯤이다. 이보다 크면 8명이 기계 하나에 몰렸을 때 서로를
   완전히 덮어 누가 누군지 안 보이고, 이보다 작으면 얼굴 사진이 뭉개져서
   "저건 누구지"가 안 된다.

   ── 뒤를 볼 때 얼굴을 안 그리는 이유 ────────────────────
   탑다운에서 방향이 안 보이면 "내가 지금 어디를 보고 있나"를 모른다. 위를
   볼 때 뒤통수를 그리는 것이 방향을 알려주는 가장 싼 방법이다 — 화살표를
   달면 8개가 화면에 떠다녀서 정신이 없다.

   ── 든 물건을 머리 위에 얹는 이유 ───────────────────────
   오버쿡드가 그렇게 한다. 멀리서 누가 뭘 들었는지 보여야 "그거 이리 줘"가
   나오고, 그게 이 게임에서 사람들이 말을 하게 되는 유일한 이유다.

   좌표계: (x, y) 는 시뮬레이션의 몸 중심이다. 스프라이트는 그 위아래로
   머리 y-28 ~ 발 y+12 를 차지한다.

   ctx 는 이미 스케일이 걸린 상태로 들어온다(view.js 가 setTransform 한다).
   그래서 여기서는 전부 디자인 좌표로만 그린다. scale 인자는 얼굴 사진을
   몇 픽셀로 뭉갤지 정하는 데만 쓴다.
   ============================================================ */
(function (global) {
  'use strict';

  var CHARS = [
    { name: '숭한 라이언',     top: '#4a5e7d', arm: '#3c4d68', hair: '#2a2018', skin: '#f0c49a', shoe: '#1a1c24' },
    { name: '박팀장님',        top: '#3e4450', arm: '#333844', hair: '#241c16', skin: '#f2c9a2', shoe: '#191b22' },
    { name: '송마라톤',        top: '#d9d2c0', arm: '#bdb6a4', hair: '#33251a', skin: '#eec096', shoe: '#2a2620' },
    { name: '내가 진짜 주희',  top: '#9aa0ac', arm: '#7c8290', hair: '#26201a', skin: '#f3cba6', shoe: '#1c1e26' },
    { name: '서론 머스크',     top: '#4d5566', arm: '#3f4657', hair: '#262019', skin: '#efc298', shoe: '#191b22' },
    { name: '모탄소년단',      top: '#333e58', arm: '#2a3349', hair: '#1f1812', skin: '#f0c49a', shoe: '#171922' },
    { name: '치이카와',        top: '#cfd4cf', arm: '#b2b8b2', hair: '#2b2118', skin: '#f1c69e', shoe: '#232830' },
    { name: '누렁이',          top: '#e2d9c8', arm: '#c6bdac', hair: '#1d1712', skin: '#f4cda8', shoe: '#2a2522' }
  ];

  var OUT = '#14161f';          // 외곽선. 어두운 바닥 위에서도 실루엣이 산다.

  /* ---------- 물건 ----------
     색만으로 구분돼야 한다. 이름표를 붙이면 8명이 뛰어다닐 때 못 읽는다. */
  var ITEMS = {
    ref:   { color: '#9b8fd0', label: '레퍼런스' },
    high:  { color: '#f83fa8', label: '하이폴리' },
    low:   { color: '#3ce8d4', label: '로우폴리' },
    uv:    { color: '#ffd93d', label: 'UV' },
    tex:   { color: '#ff7a3a', label: '텍스처' },
    rig:   { color: '#a35cff', label: '리그' },
    done:  { color: '#ffffff', label: '완료' },
    burnt: { color: '#3a3340', label: '탄 것' }
  };

  /* ---------- 실사 얼굴 ----------
     img/face/<번호>.jpg. 앞자리 숫자가 캐릭터 번호다 — 퇴근의 계단과 같은 규칙.
     없거나 못 읽으면 faces[i] 가 비어 있고, 그러면 그린 얼굴로 떨어진다.
     사진이 하나 빠졌다고 게임이 죽으면 안 된다. */
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

  /* 26px 로 줄여 둔 얼굴을 만들어 캐시한다. 매 프레임 원본을 축소하면
     8명 × 60Hz 로 큰 JPEG 를 리샘플하게 되어 느린 PC 가 먼저 죽는다. */
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
    fillRR(ctx, x - 1.5, y - 1.5, w + 3, h + 3, r + 1, OUT);
    fillRR(ctx, x, y, w, h, r, color);
  }

  /* ---------- 얼굴 ---------- */

  function drawDrawnFace(ctx, cx, cy, g, dir) {
    /* 사진이 없을 때. 눈 두 개면 방향은 충분히 읽힌다. */
    ctx.fillStyle = g.skin;
    rr(ctx, cx - 9, cy - 9, 18, 18, 5); ctx.fill();
    if (dir === 3) return;
    var ox = dir === 1 ? -2 : (dir === 2 ? 2 : 0);
    ctx.fillStyle = '#22202c';
    if (dir === 1) {
      ctx.fillRect(cx - 7 + ox, cy - 1, 3, 3);
    } else if (dir === 2) {
      ctx.fillRect(cx + 4 + ox, cy - 1, 3, 3);
    } else {
      ctx.fillRect(cx - 5, cy - 1, 3, 3);
      ctx.fillRect(cx + 2, cy - 1, 3, 3);
    }
  }

  function drawHead(ctx, cx, cy, g, ci, dir, scale) {
    var f = faces[ci];
    plate(ctx, cx - 10, cy - 10, 20, 20, 6, g.hair);   // 머리(=머리카락)가 바탕

    if (dir === 3) {
      /* 뒤통수. 목덜미 한 줄만 넣어 위아래를 알아보게 한다. */
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(cx - 5, cy + 4, 10, 4);
      return;
    }

    ctx.save();
    rr(ctx, cx - 8, cy - 7, 16, 16, 5);
    ctx.clip();
    if (f) {
      /* 픽셀화 — 26px 짜리를 부드럽게 안 늘리고 그대로 키운다. 몸통이
         납작한 색면이라 사진만 매끈하면 붙여 놓은 스티커처럼 보인다. */
      var sm = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      var ox = dir === 1 ? -2.5 : (dir === 2 ? 2.5 : 0);
      ctx.drawImage(faceCanvas(f), cx - 9 + ox, cy - 8, 18, 18);
      ctx.imageSmoothingEnabled = sm;
    } else {
      drawDrawnFace(ctx, cx, cy, g, dir);
    }
    ctx.restore();
    if (scale) { /* scale 은 지금은 참고용이다 — 픽셀화 자체는 26px 로 고정 */ }
  }

  /* ---------- 몸통 ---------- */

  /* dir: 0 아래 · 1 왼 · 2 오른 · 3 위
     phase: 걷는 위상(라디안). 없으면 서 있는 자세. 시뮬레이션 상태가 아니라
            보여주기용이라 view.js 가 화면 위 이동량으로 스스로 만든다. */
  function draw(ctx, x, y, dir, charIndex, gear, holdItem, scale, phase) {
    var g = chr(charIndex);
    var top = (gear && gear.top) || g.top;
    var arm = (gear && gear.arm) || g.arm;
    var ph = phase || 0;
    var swing = Math.sin(ph) * 3;
    var bob = Math.abs(Math.sin(ph)) * 1.2;

    ctx.save();

    /* 그림자 — 바닥에 붙어 있어야 캐릭터가 떠 보이지 않는다 */
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 12, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    var by = y - bob;

    /* 다리 */
    ctx.fillStyle = g.shoe;
    if (dir === 1 || dir === 2) {
      ctx.fillRect(x - 4, by + 5 - swing * 0.5, 8, 8);
    } else {
      ctx.fillRect(x - 8, by + 5 + swing, 6, 8);
      ctx.fillRect(x + 2, by + 5 - swing, 6, 8);
    }

    /* 몸통 — 위에서 보므로 어깨가 넓고 세로로 짧다 */
    plate(ctx, x - 12, by - 4, 24, 14, 5, top);

    /* 팔. 물건을 들면 머리 위로 올린다 — 그래야 물건이 몸에 얹혀만 있지 않고
       "들고 있다"로 읽힌다. */
    if (holdItem) {
      plate(ctx, x - 14, by - 14, 6, 12, 3, arm);
      plate(ctx, x + 8, by - 14, 6, 12, 3, arm);
    } else if (dir === 1 || dir === 2) {
      plate(ctx, x + (dir === 1 ? -15 : 9), by - 3 + swing, 6, 11, 3, arm);
    } else {
      plate(ctx, x - 15, by - 3 - swing, 6, 11, 3, arm);
      plate(ctx, x + 9, by - 3 + swing, 6, 11, 3, arm);
    }

    /* 머리 */
    drawHead(ctx, x, by - 12, g, charIndex | 0, dir, scale);

    /* 모자 같은 장비는 머리 위에 얹는다 — [가운데x, 아래y, 너비, 높이, 색] */
    if (gear && gear.hat) {
      plate(ctx, x - 11, by - 26, 22, 6, 2, gear.hat);
    }

    /* 든 물건 */
    if (holdItem) drawItem(ctx, x, by - 30, holdItem, scale);

    ctx.restore();
  }

  /* ---------- 물건 그리기 ----------
     (x, y) 는 아이콘 중심. 한 변 18 안에 들어오게 그린다. */
  function drawItem(ctx, x, y, itemState, scale) {
    var d = ITEMS[itemState];
    if (!d) return;
    var c = d.color;

    ctx.save();
    ctx.translate(x, y);

    /* 어느 아이콘이든 뒤에 어두운 판을 한 겹 깔아 바닥과 갈라놓는다 */
    ctx.fillStyle = 'rgba(10,7,26,.55)';
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = c;
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 1.5;

    if (itemState === 'ref') {
      /* 종이 뭉치 */
      for (var i = 2; i >= 0; i--) {
        var ox = (i - 1) * 2;
        fillRR(ctx, -7 + ox, -8 + i * 1.5, 13, 15, 2, i === 0 ? c : 'rgba(255,255,255,.55)');
      }
      ctx.fillStyle = 'rgba(20,22,31,.6)';
      ctx.fillRect(-4, -3, 8, 1.5);
      ctx.fillRect(-4, 0, 8, 1.5);
      ctx.fillRect(-4, 3, 5, 1.5);

    } else if (itemState === 'high') {
      /* 울퉁불퉁한 덩어리 — 정점 수가 많다는 뜻 */
      ctx.beginPath();
      var pts = [[0, -9], [5, -7], [8, -2], [6, 3], [8, 7], [1, 9], [-5, 7], [-8, 2], [-6, -3], [-4, -7]];
      for (var k = 0; k < pts.length; k++) {
        if (k === 0) ctx.moveTo(pts[k][0], pts[k][1]); else ctx.lineTo(pts[k][0], pts[k][1]);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.4)';
      ctx.beginPath(); ctx.moveTo(-4, -2); ctx.lineTo(3, 1); ctx.lineTo(-1, 6); ctx.stroke();

    } else if (itemState === 'low') {
      /* 각진 다면체 — 면이 몇 개 안 된다는 뜻 */
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(8, -3); ctx.lineTo(6, 7);
      ctx.lineTo(-6, 7); ctx.lineTo(-8, -3);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(20,22,31,.55)';
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(0, 7);
      ctx.moveTo(-8, -3); ctx.lineTo(6, 7);
      ctx.stroke();

    } else if (itemState === 'uv') {
      /* 펼친 격자 */
      fillRR(ctx, -8, -8, 16, 16, 2, c);
      ctx.strokeStyle = 'rgba(20,22,31,.7)';
      for (var u = 1; u < 3; u++) {
        ctx.beginPath();
        ctx.moveTo(-8 + u * 16 / 3, -8); ctx.lineTo(-8 + u * 16 / 3, 8);
        ctx.moveTo(-8, -8 + u * 16 / 3); ctx.lineTo(8, -8 + u * 16 / 3);
        ctx.stroke();
      }
      rr(ctx, -8, -8, 16, 16, 2); ctx.strokeStyle = OUT; ctx.stroke();

    } else if (itemState === 'tex') {
      /* 체크무늬 */
      fillRR(ctx, -8, -8, 16, 16, 2, c);
      ctx.fillStyle = 'rgba(20,22,31,.55)';
      for (var ty = 0; ty < 4; ty++) {
        for (var tx = 0; tx < 4; tx++) {
          if ((tx + ty) % 2) ctx.fillRect(-8 + tx * 4, -8 + ty * 4, 4, 4);
        }
      }
      rr(ctx, -8, -8, 16, 16, 2); ctx.strokeStyle = OUT; ctx.stroke();

    } else if (itemState === 'rig') {
      /* 뼈대 */
      ctx.strokeStyle = c; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(0, 2);
      ctx.moveTo(-6, -3); ctx.lineTo(6, -3);
      ctx.moveTo(0, 2); ctx.lineTo(-5, 8);
      ctx.moveTo(0, 2); ctx.lineTo(5, 8);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      var joints = [[0, -8], [-6, -3], [6, -3], [0, 2], [-5, 8], [5, 8]];
      for (var j = 0; j < joints.length; j++) {
        ctx.beginPath(); ctx.arc(joints[j][0], joints[j][1], 1.6, 0, Math.PI * 2); ctx.fill();
      }

    } else if (itemState === 'done') {
      /* 반짝이는 정육면체 */
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(8, -4.5); ctx.lineTo(8, 4.5);
      ctx.lineTo(0, 9); ctx.lineTo(-8, 4.5); ctx.lineTo(-8, -4.5);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(20,22,31,.5)';
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(0, 0); ctx.lineTo(8, -4.5);
      ctx.moveTo(0, 0); ctx.lineTo(-8, -4.5);
      ctx.moveTo(0, 0); ctx.lineTo(0, 9);
      ctx.stroke();
      ctx.fillStyle = '#ffd93d';
      ctx.beginPath(); ctx.arc(7, -8, 1.8, 0, Math.PI * 2); ctx.fill();

    } else if (itemState === 'burnt') {
      /* 연기 */
      ctx.beginPath();
      ctx.arc(0, 3, 7, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(160,150,170,.75)';
      ctx.beginPath(); ctx.arc(-3, -6, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(3, -8, 2.2, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
    if (scale) { /* 아이콘은 고정 크기다 — 배율은 ctx 가 이미 갖고 있다 */ }
  }

  /* ---------- 대기실 미리보기 ----------
     (0,0)~(w,h) 상자 안에 아래를 보고 선 캐릭터를 꽉 차게 그린다.
     ctx 배율이 걸리지 않은 상태로 들어온다 — 여기서 직접 잡는다. */
  function preview(ctx, w, h, charIndex, gear) {
    var s = Math.min(w / 40, h / 52);
    ctx.save();
    ctx.translate(w / 2, h / 2 + 12 * s);
    ctx.scale(s, s);
    draw(ctx, 0, 0, 0, charIndex, gear, null, s, 0);
    ctx.restore();
  }

  global.Sprite = {
    CHARS: CHARS,
    ITEMS: ITEMS,
    FACE_PX: FACE_PX,
    draw: draw,
    drawItem: drawItem,
    preview: preview,
    hasFace: function (i) { return !!faces[i]; },
    /* 사진은 늦게 온다. 대기실이 이미 떠 있으면 다시 그려야 그 자리에서 바뀐다. */
    onFaceLoad: function (fn) { onFaceLoad = fn; }
  };
})(window);
