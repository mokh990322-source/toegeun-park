/* ============================================================
   오버워크드 — DOM UI (시작 · 대기실 · 상단바)

   캔버스 안에 버튼을 그리지 않는다. 닉네임 입력과 코드 붙여넣기는 브라우저가
   이미 잘 하는 일이고, 그걸 캔버스로 다시 만들면 한글 입력기에서 깨진다.

   이 파일도 판정을 하지 않는다. 값을 받아 화면에 박고, 사람이 누른 것을
   game.js 로 넘기기만 한다. 콜백은 game.js 가 Hud.on 에 꽂는다.
   ============================================================ */
(function (global) {
  'use strict';

  var doc = global.document;
  function $(id) { return doc.getElementById(id); }

  var on = {};                 // create, join, start, pick, pickChar
  var els = {};
  var pickIdx = 0;
  var pickCanvases = [];
  var lobbyCanvases = [];       // 대기실 캐릭터 카드 — 시작 화면 것과 별개다

  function cache() {
    ['nick', 'charPick', 'btnCreate', 'roomInput', 'btnJoin',
     'screenStart', 'screenLobby', 'screenGame',
     'roomCode', 'playerCount', 'btnCopyLink', 'whoList', 'charPickLobby', 'btnStart',
     'goalNow', 'goalNeed', 'floor', 'actors', 'netWarn',
     'stat', 'hint'].forEach(function (id) { els[id] = $(id); });
  }

  /* ---------- 캐릭터 고르기 (시작 화면) ----------
     방에 들어가기 전이라 아무도 뭘 골랐는지 모른다 — 여기서는 겹침을
     따질 수 없으니 순수하게 "내가 뭘 좋아하나"만 고른다. 실제 겹침 방지는
     대기실 쪽(아래)에서 한다. */
  function paintCharPick() {
    for (var i = 0; i < pickCanvases.length; i++) {
      var cv = pickCanvases[i];
      var c = cv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, cv.width, cv.height);
      global.Sprite.preview(c, cv.width, cv.height, i, null);
    }
  }

  function buildCharPick() {
    var box = els.charPick;
    if (!box) return;
    box.innerHTML = '';
    pickCanvases = [];
    for (var i = 0; i < global.Sprite.CHARS.length; i++) {
      (function (i) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'char btnx' + (i === pickIdx ? ' on' : '');
        b.setAttribute('data-i', String(i));
        var cv = doc.createElement('canvas');
        cv.width = 84; cv.height = 104;
        b.appendChild(cv);
        var nm = doc.createElement('span');
        nm.className = 'cname';
        nm.textContent = global.Sprite.CHARS[i].name;
        b.appendChild(nm);
        b.onclick = function () { setPick(i); if (on.pick) on.pick(i); };
        box.appendChild(b);
        pickCanvases.push(cv);
      })(i);
    }
    paintCharPick();
  }

  function setPick(i) {
    pickIdx = i;
    var bs = els.charPick.querySelectorAll('.char');
    for (var k = 0; k < bs.length; k++) {
      bs[k].className = 'char btnx' + (k === i ? ' on' : '');
    }
  }

  /* ---------- 캐릭터 고르기 (대기실) ----------
     여기서는 겹침을 안다 — game.js 가 usedMap(다른 사람이 쓰는 캐릭터 →
     {pid,name})과 내 캐릭터 번호를 넘겨준다. 잠긴 칸은 disabled 를 걸어
     클릭 자체가 안 먹게 하고, 누가 썼는지 카드 안에 이름으로 보여준다 —
     그래야 "고장났다"가 아니라 "박팀장님이 이미 골랐다"로 읽힌다. */
  function paintLobbyCharPick() {
    for (var i = 0; i < lobbyCanvases.length; i++) {
      var cv = lobbyCanvases[i];
      var c = cv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, cv.width, cv.height);
      global.Sprite.preview(c, cv.width, cv.height, i, null);
    }
  }

  function buildLobbyCharPick() {
    var box = els.charPickLobby;
    if (!box) return;
    box.innerHTML = '';
    lobbyCanvases = [];
    for (var i = 0; i < global.Sprite.CHARS.length; i++) {
      (function (i) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'char btnx';
        b.setAttribute('data-i', String(i));
        var cv = doc.createElement('canvas');
        cv.width = 84; cv.height = 104;
        b.appendChild(cv);
        var nm = doc.createElement('span');
        nm.className = 'cname';
        nm.textContent = global.Sprite.CHARS[i].name;
        b.appendChild(nm);
        var cl = doc.createElement('span');
        cl.className = 'claim';
        b.appendChild(cl);
        b.onclick = function () {
          if (b.disabled) return;
          if (on.pickChar) on.pickChar(i);
        };
        box.appendChild(b);
        lobbyCanvases.push(cv);
      })(i);
    }
    paintLobbyCharPick();
  }

  /* usedMap: {캐릭터번호: {pid, name}} — 나를 뺀 나머지가 쓰는 것만.
     myChar: 지금 서버에 적혀 있는 내 캐릭터 번호. */
  function setLobbyCharPick(usedMap, myChar) {
    var box = els.charPickLobby;
    if (!box) return;
    var bs = box.querySelectorAll('.char');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      var mine = (i === myChar);
      var claim = usedMap && usedMap[i];
      var locked = !!claim && !mine;
      b.disabled = locked;
      b.className = 'char btnx' + (mine ? ' on' : '') + (locked ? ' locked' : '');
      var cl = b.querySelector('.claim');
      if (cl) cl.textContent = locked ? (claim.name + ' 사용 중') : '';
    }
  }

  /* ---------- 화면 전환 ---------- */
  function show(which) {
    ['screenStart', 'screenLobby', 'screenGame'].forEach(function (id) {
      var e = els[id];
      if (!e) return;
      if (id === 'screen' + which) e.classList.remove('hidden');
      else e.classList.add('hidden');
    });
  }

  /* ---------- 대기실 ---------- */
  function setCode(code) {
    if (els.roomCode) els.roomCode.textContent = code || '----';
  }

  function setCount(n, max) {
    if (els.playerCount) els.playerCount.textContent = n + ' / ' + max;
  }

  /* who: {pid:{name,char,join,seen}}, order: 살아 있는 pid 를 입장 순으로.
     순서를 여기서 다시 정하지 않는다 — Room.alive 가 정한 순서가 곧
     승계 순서라, 화면이 다른 순서를 보여주면 "왜 쟤가 호스트가 됐지"가 된다.

     로스터가 대기실에서 제일 커야 한다 — 얼굴을 34px 로는 못 알아본다.
     캐릭터 이름도 같이 보여준다. "누가 뭘로 하는지"가 초대 링크 복사보다
     중요한 정보라서다. */
  function setWho(who, order, hostPid, mePid, iAmHost) {
    var ul = els.whoList;
    if (!ul) return;
    ul.innerHTML = '';
    for (var i = 0; i < order.length; i++) {
      var pid = order[i];
      var w = (who && who[pid]) || {};
      var ci = w.char | 0;
      var li = doc.createElement('li');
      li.className = 'wrow' + (pid === mePid ? ' me' : '');

      var cv = doc.createElement('canvas');
      cv.width = 48; cv.height = 60;
      cv.className = 'wface';
      global.Sprite.preview(cv.getContext('2d'), 48, 60, ci, w.gear || null);
      li.appendChild(cv);

      var box = doc.createElement('span');
      box.className = 'wtext';

      var nm = doc.createElement('span');
      nm.className = 'wname';
      nm.textContent = (w.name || '???') + (pid === mePid ? ' (나)' : '');
      box.appendChild(nm);

      var ch = doc.createElement('span');
      ch.className = 'wchar';
      ch.textContent = (global.Sprite.CHARS[ci] && global.Sprite.CHARS[ci].name) || '';
      box.appendChild(ch);

      li.appendChild(box);

      if (pid === hostPid) {
        var cr = doc.createElement('span');
        cr.className = 'crown';
        cr.textContent = '👑';
        cr.title = '호스트';
        li.appendChild(cr);
      }
      ul.appendChild(li);
    }
    if (els.btnStart) {
      /* 호스트만 시작할 수 있다. 아무나 시작하면 두 사람이 동시에 눌러
         시뮬레이션이 두 번 생성된다. */
      els.btnStart.disabled = !iAmHost;
      els.btnStart.textContent = iAmHost ? '시작' : '호스트가 시작하기를 기다리는 중…';
    }
  }

  /* ---------- 게임 상단바 ---------- */
  function setGoal(now, need) {
    if (els.goalNow) els.goalNow.textContent = String(now);
    if (els.goalNeed) els.goalNeed.textContent = String(need);
  }

  function setStat(text) {
    if (els.stat) els.stat.textContent = text;
  }

  /* 아무 안내 없이 캐릭터가 멈추면 다들 자기 PC 를 탓한다 */
  function netWarn(show, text) {
    var e = els.netWarn;
    if (!e) return;
    if (show) {
      e.textContent = text || '연결이 끊겼습니다. 다시 붙는 중…';
      e.classList.remove('hidden');
    } else {
      e.classList.add('hidden');
    }
  }

  function toast(text) {
    netWarn(true, text);
    global.setTimeout(function () { netWarn(false); }, 1600);
  }

  function init(handlers) {
    cache();
    on = handlers || {};
    buildCharPick();
    buildLobbyCharPick();
    global.Sprite.onFaceLoad(function () { paintCharPick(); paintLobbyCharPick(); });

    if (els.btnCreate) els.btnCreate.onclick = function () { if (on.create) on.create(); };
    if (els.btnJoin) els.btnJoin.onclick = function () { if (on.join) on.join(); };
    if (els.btnStart) els.btnStart.onclick = function () { if (on.start) on.start(); };

    if (els.roomInput) {
      els.roomInput.oninput = function () {
        this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      };
      els.roomInput.onkeydown = function (e) {
        if (e.key === 'Enter' && on.join) on.join();
      };
    }
    if (els.nick) {
      els.nick.onkeydown = function (e) {
        if (e.key === 'Enter' && on.create) on.create();
      };
    }

    if (els.btnCopyLink) {
      els.btnCopyLink.onclick = function () {
        /* URL 째로 복사한다. 코드만 주면 상대가 주소창에 뭘 쳐야 하는지부터
           물어본다. 메신저에 그대로 붙여 넣으면 눌러서 들어오게 만든다. */
        var link = global.location.origin + global.location.pathname +
                   '#' + (els.roomCode ? els.roomCode.textContent : '');
        var okMsg = '초대 링크를 복사했습니다';
        if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
          global.navigator.clipboard.writeText(link).then(
            function () { toast(okMsg); },
            function () { global.prompt('이 주소를 복사해서 보내세요', link); }
          );
        } else {
          global.prompt('이 주소를 복사해서 보내세요', link);
        }
      };
    }
  }

  global.Hud = {
    init: init,
    els: function () { return els; },
    show: show,
    pick: function () { return pickIdx; },
    setPick: setPick,
    paintCharPick: paintCharPick,
    setLobbyCharPick: setLobbyCharPick,
    setCode: setCode,
    setCount: setCount,
    setWho: setWho,
    setGoal: setGoal,
    setStat: setStat,
    netWarn: netWarn,
    toast: toast
  };
})(window);
