/* ============================================================
   오버워크드 — 네트워크 계층

   Firebase Realtime Database 를 SDK 없이 쓴다.
   읽기는 EventSource(SSE) 스트리밍, 쓰기는 fetch + REST.

   ── 스트리밍이 보내는 것 ─────────────────────────────────
   event: put    → data: {"path":"/who/p2","data":{...}}   그 경로를 통째로 교체
   event: patch  → data: {"path":"/m","data":{...}}        그 경로의 자식만 병합
   event: keep-alive                                        무시
   data 가 null 이면 그 자리를 지우라는 뜻이다.

   경로 적용은 이 파일에서 유일하게 틀리기 쉬운 부분이라 applyEvent 로
   떼어냈다. 순수 함수라 네트워크 없이 Node 로 검증한다.

   이 파일은 게임을 모른다. 방도, 시뮬레이션도 모른다.
   ============================================================ */
(function (global) {
  'use strict';

  function base() {
    return String(global.CLOUD_URL || '').replace(/\/+$/, '');
  }

  function url(path) {
    var p = String(path || '').replace(/^\/+/, '');
    return base() + '/' + p + '.json';
  }

  /* 얕은 복사 — 원본을 그 자리에서 고치면 "언제 바뀌었지"를 추적할 수 없다 */
  function copy(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.slice();
    var o = {}, k;
    for (k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = v[k];
    return o;
  }

  function segs(path) {
    return String(path == null ? '/' : path).split('/')
      .filter(function (s) { return s.length > 0; });
  }

  function applyEvent(state, type, path, data) {
    var parts = segs(path);

    if (type === 'patch') {
      /* patch 는 "이 경로의 자식들만 갈아 끼워라"다.
         자식 하나하나를 put 으로 돌리면 깊은 경로 처리를 한 곳에만 두게 된다. */
      if (data === null || typeof data !== 'object') return state;
      var out = state;
      for (var k in data) {
        if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
        out = applyEvent(out, 'put', '/' + parts.concat(k).join('/'), data[k]);
      }
      return out;
    }

    if (parts.length === 0) return data;          // put "/" — 통째로 교체

    var root = copy(state);
    if (root === null || typeof root !== 'object') root = {};

    var node = root;
    for (var i = 0; i < parts.length - 1; i++) {
      var key = parts[i];
      var child = node[key];
      child = (child === null || typeof child !== 'object') ? {} : copy(child);
      node[key] = child;
      node = child;
    }

    var last = parts[parts.length - 1];
    if (data === null) delete node[last];
    else node[last] = data;

    return root;
  }

  function send(method, path, value) {
    var opt = { method: method };
    if (value !== undefined) {
      opt.headers = { 'Content-Type': 'application/json' };
      opt.body = JSON.stringify(value);
    }
    return fetch(url(path), opt).then(function (r) {
      return { ok: r.ok, status: r.status };
    }, function () {
      /* 쓰기 실패를 예외로 던지면 게임 루프가 멈춘다.
         네트워크가 끊겨도 화면은 계속 돌아야 하므로 값으로 돌려준다. */
      return { ok: false, status: 0 };
    });
  }

  function put(path, value) { return send('PUT', path, value); }
  function del(path) { return send('DELETE', path); }

  function get(path) {
    return fetch(url(path)).then(function (r) {
      return r.ok ? r.json() : null;
    }).catch(function () { return null; });
  }

  /* 한 경로를 계속 지켜본다. 이벤트가 올 때마다 onData(현재상태) 를 부른다.
     끊기면 EventSource 가 알아서 다시 붙고, 다시 붙을 때 Firebase 가
     put "/" 로 전체를 다시 보내 주므로 우리가 복구할 게 없다. */
  function watch(path, onData, onError) {
    var state = null;
    var es = new global.EventSource(url(path));

    function handle(type) {
      return function (e) {
        var msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (!msg) return;
        state = applyEvent(state, type, msg.path, msg.data);
        if (onData) onData(state);
      };
    }

    es.addEventListener('put', handle('put'));
    es.addEventListener('patch', handle('patch'));
    es.addEventListener('cancel', function () { if (onError) onError('cancel'); });
    es.addEventListener('auth_revoked', function () { if (onError) onError('auth_revoked'); });
    es.onerror = function () { if (onError) onError('error'); };

    return {
      close: function () { try { es.close(); } catch (e) {} },
      state: function () { return state; }
    };
  }

  global.Net = {
    url: url,
    applyEvent: applyEvent,
    put: put,
    del: del,
    get: get,
    watch: watch
  };
})(window);
