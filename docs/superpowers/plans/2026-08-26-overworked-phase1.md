# 오버워크드 1단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀원 2~8명이 각자 자리 PC에서 방 코드로 모여, 한 작업장 안을 돌아다니며 레퍼런스를 집어 모델링 → 리토폴 두 공정을 거쳐 납품하는 1스테이지를 끝까지 굴린다.

**Architecture:** 호스트 권위 방식. 먼저 들어온 사람의 브라우저가 60Hz로 시뮬레이션을 돌리고 10Hz로 전체 스냅샷을 Firebase에 PUT한다. 나머지 클라이언트는 자기 입력만 올리고 스냅샷을 EventSource로 받아 그린다. 내 캐릭터만 로컬 예측하고, 남의 캐릭터와 물건·기계는 호스트를 그대로 따른다. 호스트가 3초간 조용하면 입장 순번이 가장 빠른 생존자가 승계한다.

**Tech Stack:** 순수 Canvas2D + 클래식 `<script>` 태그. 외부 라이브러리 0개. Firebase Realtime Database REST(쓰기) + EventSource(읽기). 배포는 GitHub Pages. 테스트는 Node 24 내장 러너 (`node --test`, 인자 없이 자동 탐색). Node 24.19.0 에서 확인.

## Global Constraints

- **외부 라이브러리 0개.** npm 의존성 없음. `<script src>`는 전부 같은 저장소의 `js/*.js`만.
- **ES 모듈 금지.** `file://`에서 막힌다. 모든 파일은 `(function (global) { 'use strict'; ... })(window);` IIFE 패턴.
- **디자인 좌표계 고정 1280×720.** 실제 캔버스 크기와 무관하게 게임 로직은 항상 이 좌표를 쓴다. 화면 스케일은 그리기 직전에만 적용한다.
- **`sim.js`는 네트워크를 모른다.** `net.js`는 게임을 모른다. `view.js`는 판정을 모른다. 이 셋을 섞지 말 것.
- **스냅샷은 항상 전체.** 델타 전송 금지 — 푸시가 12회 중 1회 누락되므로 델타는 복구가 안 된다.
- **Firebase 경로는 `rooms/` 안으로만.** `scores/`(퇴근의 계단 랭킹)는 절대 건드리지 않는다.
- **좌표는 정수로 반올림해서 전송한다.** 소수점은 전송량만 먹고 눈에 안 보인다.
- **주석은 한국어.** 퇴근의 계단과 같은 톤 — "무엇을"이 아니라 "왜"를 적는다.
- **커밋 메시지는 한국어**, 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Firebase 주소: `https://mohag-8a5b8-default-rtdb.asia-southeast1.firebasedatabase.app`

## 테스트 방법

브라우저 게임이라 테스트 방식이 두 갈래다. 태스크마다 어느 쪽인지 명시한다.

**(A) Node 단위 테스트** — 순수 로직(좌표, 충돌, 상태 기계, 방 코드, 스냅샷 직렬화). `test/` 아래 `*.test.js`. 실행:

```bash
node --test
```

헬퍼는 `testlib/load.js` 에 둔다. `test/` 안에 두면 Node 가 그것까지 테스트 파일로
잡아서 출력이 지저분해진다. 각 테스트는 이 헬퍼로 가짜 window 를 만든 뒤 대상 파일을
읽어 실행한다:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/** js/<name>.js 를 가짜 window 위에 올려서 돌려준다.
 *  IIFE 라 require 가 안 되므로 직접 평가한다. */
function load(names, win) {
  const w = win || {};
  for (const n of [].concat(names)) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', n + '.js'), 'utf8');
    new Function('window', 'globalThis', src + '\n//# sourceURL=' + n + '.js')(w, w);
  }
  return w;
}
module.exports = { load };
```

**(B) 브라우저 확인** — DOM·캔버스·실제 네트워크가 필요한 것. 로컬 서버를 띄우고 페이지 안에서 스크립트를 돌려 결과를 값으로 확인한다. 눈으로 보는 게 아니라 **수치로 확인**한다. 태스크마다 확인할 값과 기대치를 적어 둔다.

```bash
python -m http.server 8895 --directory .
```

---

## 파일 구조

| 파일 | 책임 | 아는 것 | 모르는 것 |
|---|---|---|---|
| `js/cloud-config.js` | Firebase 주소 한 줄 | — | 전부 |
| `js/net.js` | 스트리밍 구독·쓰기·재연결 | HTTP, EventSource | 게임, 방 |
| `js/room.js` | 방 코드·입장·참가자·호스트 승계 | net | 시뮬레이션, 그리기 |
| `js/world.js` | 맵 데이터·충돌·좌표 | 기하 | 네트워크, 그리기 |
| `js/stations.js` | 공정 기계 정의와 전이 규칙 | 물건 상태 | 네트워크, 그리기 |
| `js/sim.js` | 60Hz 시뮬레이션 (호스트 전용, 유일한 권위) | world, stations | 네트워크, 그리기 |
| `js/snap.js` | 스냅샷 직렬화·역직렬화 | sim 상태 모양 | 전송 방법 |
| `js/sprite.js` | 캐릭터 그리기 (탑다운 4방향) | 캔버스 | 게임 규칙 |
| `js/view.js` | 화면 그리기 + 보간 + 예측 | 캔버스, 스냅샷 | 판정 |
| `js/hud.js` | DOM UI (시작화면·대기실·상단바) | DOM | 캔버스 |
| `js/game.js` | 루프와 조립 | 전부 | — |

1단계에서는 `shop.js` / `orders.js`를 만들지 않는다. 2단계 몫이다.

---

### Task 1: 저장소 뼈대와 테스트 실행 환경

**Files:**
- Create: `testlib/load.js`
- Create: `test/smoke.test.js`
- Create: `js/cloud-config.js`
- Create: `.gitignore`
- Create: `README.md`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `require('../testlib/load').load(names, win)` → 가짜 window 객체. `names`는 문자열 또는 문자열 배열(`js/` 아래 확장자 뺀 이름). 이후 모든 테스트가 이걸 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`testlib/load.js`:

```js
'use strict';
const fs = require('fs');
const path = require('path');

/* js/<name>.js 는 IIFE 라 require 가 안 된다. 가짜 window 위에 직접 평가한다. */
function load(names, win) {
  const w = win || {};
  for (const n of [].concat(names)) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', n + '.js'), 'utf8');
    new Function('window', 'globalThis', src + '\n//# sourceURL=' + n + '.js')(w, w);
  }
  return w;
}

module.exports = { load };
```

`test/smoke.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

test('cloud-config 가 Firebase 주소를 window 에 올린다', () => {
  const w = load('cloud-config');
  assert.match(w.CLOUD_URL, /^https:\/\/.+firebasedatabase\.app$/);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /c/Users/NAU/Desktop/Overworked && node --test`
Expected: FAIL — `ENOENT ... js/cloud-config.js`

- [ ] **Step 3: 최소 구현**

`js/cloud-config.js`:

```js
/* ============================================================
   오버워크드 — Firebase 주소

   퇴근의 계단과 같은 프로젝트를 쓴다. 경로만 다르다:
   퇴근의 계단은 scores/, 오버워크드는 rooms/ 아래만 쓴다.
   scores/ 를 건드리면 사내 랭킹이 깨지므로 절대 손대지 말 것.
   ============================================================ */
(function (global) {
  'use strict';
  global.CLOUD_URL = 'https://mohag-8a5b8-default-rtdb.asia-southeast1.firebasedatabase.app';
})(window);
```

`.gitignore`:

```
dist/
node_modules/
*.log
```

`README.md`:

```markdown
# 오버워크드 (OVERWORKED)

NAU 모델링팀 8인 온라인 협동 게임. 오버쿡드 방식으로 3D 에셋을 만들어 납품한다.

- 설계: `docs/superpowers/specs/2026-08-26-overworked-design.md`
- 1단계 계획: `docs/superpowers/plans/2026-08-26-overworked-phase1.md`

## 테스트

    node --test

## 로컬 실행

    python -m http.server 8895 --directory .

브라우저에서 http://localhost:8895 를 연다.
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd /c/Users/NAU/Desktop/Overworked && node --test`
Expected: PASS — `1 pass, 0 fail`

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/NAU/Desktop/Overworked
git add test/ testlib/ js/cloud-config.js .gitignore README.md
git commit -m "$(cat <<'MSG'
뼈대: 테스트 실행 환경과 Firebase 주소

js/*.js 는 IIFE 라 require 가 안 된다. test/helper.js 가 가짜 window 를
만들어 직접 평가한다 — 이래야 브라우저 코드를 그대로 두고 Node 로 돌린다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: 방 코드 생성과 정리

**Files:**
- Create: `js/room.js`
- Create: `test/room-code.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `window.Room.CODE_CHARS` → `'ABCDEFGHJKMNPQRSTUVWXYZ23456789'` (31자)
  - `window.Room.makeCode(rand)` → 4자 문자열. `rand`는 0 이상 1 미만 난수 함수, 생략하면 `Math.random`. 테스트가 난수를 고정하려고 주입한다.
  - `window.Room.cleanCode(s)` → 대문자 4자 코드, 쓸 수 없으면 `''`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/room-code.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function room() { return load('room').Room; }

test('코드 문자는 31자이고 헷갈리는 글자가 없다', () => {
  const C = room().CODE_CHARS;
  assert.strictEqual(C.length, 31);
  assert.strictEqual(new Set(C).size, 31, '중복 글자가 있다');
  for (const ch of 'ILO01') {
    assert.ok(C.indexOf(ch) < 0, ch + ' 는 코드에 들어가면 안 된다');
  }
});

test('makeCode 는 코드 문자만으로 4자를 만든다', () => {
  const R = room();
  for (let i = 0; i < 500; i++) {
    const code = R.makeCode();
    assert.strictEqual(code.length, 4, code);
    for (const ch of code) assert.ok(R.CODE_CHARS.indexOf(ch) >= 0, code);
  }
});

test('makeCode 는 주입한 난수를 쓴다', () => {
  const R = room();
  assert.strictEqual(R.makeCode(() => 0), 'AAAA');
  assert.strictEqual(R.makeCode(() => 0.999999), '9999');
});

test('makeCode 는 rand 가 1 을 줘도 범위를 넘지 않는다', () => {
  const R = room();
  assert.strictEqual(R.makeCode(() => 1), '9999');
});

test('cleanCode 는 대문자로 올리고 공백을 지운다', () => {
  const R = room();
  assert.strictEqual(R.cleanCode('abcd'), 'ABCD');
  assert.strictEqual(R.cleanCode(' a b c d '), 'ABCD');
  assert.strictEqual(R.cleanCode('Ab2X'), 'AB2X');
});

test('cleanCode 는 코드에 없는 글자가 섞이면 거부한다', () => {
  const R = room();
  assert.strictEqual(R.cleanCode('ABC0'), '');
  assert.strictEqual(R.cleanCode('ABCI'), '');
  assert.strictEqual(R.cleanCode('AB-D'), '');
  assert.strictEqual(R.cleanCode('가나다라'), '');
});

test('cleanCode 는 길이가 안 맞으면 빈 문자열', () => {
  const R = room();
  assert.strictEqual(R.cleanCode('AB'), '');
  assert.strictEqual(R.cleanCode('ABCDE'), '');
  assert.strictEqual(R.cleanCode(''), '');
  assert.strictEqual(R.cleanCode(null), '');
  assert.strictEqual(R.cleanCode(undefined), '');
  assert.strictEqual(R.cleanCode(1234), '');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /c/Users/NAU/Desktop/Overworked && node --test test/room-code.test.js`
Expected: FAIL — `ENOENT ... js/room.js`

- [ ] **Step 3: 구현**

`js/room.js`:

```js
/* ============================================================
   오버워크드 — 방 코드

   코드는 말이나 메신저로 불러 주는 것이다. "오인가 영인가"를 되묻게
   되는 순간 코드로서 실패다. 그래서 I, L, O, 0, 1 을 빼고 31자만 쓴다.
   31의 4제곱 = 92만 가지. 사내에서 동시에 열리는 방은 많아야 두어 개라
   겹칠 일이 사실상 없다.

   코드에 없는 글자가 들어오면 고쳐 주지 않고 거부한다. 0 을 친 사람이
   O 를 뜻했는지 다른 글자를 잘못 본 건지 알 방법이 없기 때문이다.
   엉뚱한 방에 넣는 것보다 "그런 코드 없다"고 하는 쪽이 낫다.
   ============================================================ */
(function (global) {
  'use strict';

  /* A~Z 에서 I, L, O 를 뺀 23자 + 2~9 여덟 자 = 31자 */
  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  function makeCode(rand) {
    var r = rand || Math.random;
    var s = '';
    for (var i = 0; i < 4; i++) {
      var k = Math.floor(r() * CODE_CHARS.length);
      /* rand() 가 정확히 1 을 돌려주는 구현도 있다. 그때 범위를 넘지 않게 막는다. */
      if (k >= CODE_CHARS.length) k = CODE_CHARS.length - 1;
      if (k < 0) k = 0;
      s += CODE_CHARS.charAt(k);
    }
    return s;
  }

  function cleanCode(s) {
    if (typeof s !== 'string') return '';
    var up = s.toUpperCase().replace(/\s+/g, '');
    if (up.length !== 4) return '';
    for (var i = 0; i < 4; i++) {
      if (CODE_CHARS.indexOf(up.charAt(i)) < 0) return '';
    }
    return up;
  }

  global.Room = {
    CODE_CHARS: CODE_CHARS,
    makeCode: makeCode,
    cleanCode: cleanCode
  };
})(window);
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd /c/Users/NAU/Desktop/Overworked && node --test test/room-code.test.js`
Expected: PASS — `7 pass, 0 fail`

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/NAU/Desktop/Overworked
git add js/room.js test/room-code.test.js
git commit -m "$(cat <<'MSG'
방 코드: 헷갈리는 글자를 뺀 31자

코드는 말로 불러 주는 것이다. "오인가 영인가"를 되묻게 되면 코드로서
실패라서 I/L/O/0/1 을 뺐다.

코드에 없는 글자는 고쳐 주지 않고 거부한다. 0 을 친 사람이 O 를
뜻했는지 알 방법이 없어서, 엉뚱한 방에 넣는 것보다 없는 코드라고
하는 쪽이 낫다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---
### Task 3: 네트워크 계층 — 스트리밍 이벤트 적용

Firebase 스트리밍은 `put`(그 경로를 통째로 교체)과 `patch`(그 경로의 자식만 병합)
두 종류를 보낸다. 경로는 구독한 노드 기준 상대 경로다. 이걸 로컬 사본에 적용하는
로직이 네트워크 계층에서 유일하게 틀리기 쉬운 부분이라, **순수 함수로 떼어내서**
네트워크 없이 검증한다.

**Files:**
- Create: `js/net.js`
- Create: `test/net-apply.test.js`

**Interfaces:**
- Consumes: `window.CLOUD_URL` (Task 1)
- Produces:
  - `window.Net.applyEvent(state, type, path, data)` → 새 state. `type`은 `'put'`/`'patch'`, `path`는 `'/'` 또는 `'/a/b'`, `data`는 값 또는 `null`. **state 를 그 자리에서 고치지 않고 새 값을 돌려준다.**
  - `window.Net.url(path)` → `CLOUD_URL + '/' + path + '.json'`
  - `window.Net.put(path, value)` → `Promise<{ok:boolean, status:number}>`
  - `window.Net.del(path)` → `Promise<{ok:boolean, status:number}>`
  - `window.Net.get(path)` → `Promise<any>` (실패하면 `null`)
  - `window.Net.watch(path, onData, onError)` → `{ close: fn, state: fn }`. 이벤트가 올 때마다 `onData(현재상태)` 를 부른다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/net-apply.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function net() {
  return load(['cloud-config', 'net'], { EventSource: function () {} }).Net;
}

test('put / 는 뿌리를 통째로 바꾼다', () => {
  const N = net();
  assert.deepStrictEqual(N.applyEvent({ a: 1 }, 'put', '/', { b: 2 }), { b: 2 });
});

test('put / 에 null 이 오면 전체가 없어진다', () => {
  const N = net();
  assert.strictEqual(N.applyEvent({ a: 1 }, 'put', '/', null), null);
});

test('put 은 깊은 경로에 값을 넣는다', () => {
  const N = net();
  const out = N.applyEvent({ who: { p1: { name: '가' } } }, 'put', '/who/p2', { name: '나' });
  assert.deepStrictEqual(out, { who: { p1: { name: '가' }, p2: { name: '나' } } });
});

test('put 은 중간 경로가 없으면 만들어 낸다', () => {
  const N = net();
  assert.deepStrictEqual(N.applyEvent({}, 'put', '/a/b/c', 7), { a: { b: { c: 7 } } });
});

test('put 에 null 이 오면 그 자리를 지운다', () => {
  const N = net();
  const out = N.applyEvent({ who: { p1: 1, p2: 2 } }, 'put', '/who/p1', null);
  assert.deepStrictEqual(out, { who: { p2: 2 } });
});

test('put 은 원본을 고치지 않는다', () => {
  const N = net();
  const before = { who: { p1: { name: '가' } } };
  N.applyEvent(before, 'put', '/who/p1/name', '나');
  assert.deepStrictEqual(before, { who: { p1: { name: '가' } } });
});

test('patch 는 그 경로의 자식만 병합한다', () => {
  const N = net();
  const out = N.applyEvent({ m: { host: 'a', phase: 'lobby', stage: 1 } },
                           'patch', '/m', { phase: 'play' });
  assert.deepStrictEqual(out, { m: { host: 'a', phase: 'play', stage: 1 } });
});

test('patch 안의 null 은 그 자식을 지운다', () => {
  const N = net();
  const out = N.applyEvent({ who: { p1: 1, p2: 2 } }, 'patch', '/who', { p1: null });
  assert.deepStrictEqual(out, { who: { p2: 2 } });
});

test('patch 를 뿌리에 걸 수 있다', () => {
  const N = net();
  const out = N.applyEvent({ a: 1, b: 2 }, 'patch', '/', { b: 3, c: 4 });
  assert.deepStrictEqual(out, { a: 1, b: 3, c: 4 });
});

test('url 은 .json 을 붙이고 슬래시를 겹치지 않는다', () => {
  const N = net();
  assert.ok(N.url('rooms/ABCD/st').endsWith('/rooms/ABCD/st.json'));
  assert.ok(N.url('/rooms/ABCD').endsWith('/rooms/ABCD.json'));
  assert.ok(N.url('/rooms/ABCD').indexOf('//rooms') < 0);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /c/Users/NAU/Desktop/Overworked && node --test test/net-apply.test.js`
Expected: FAIL — `ENOENT ... js/net.js`

- [ ] **Step 3: 구현**

`js/net.js`:

```js
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
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd /c/Users/NAU/Desktop/Overworked && node --test test/net-apply.test.js`
Expected: PASS — `10 pass, 0 fail`

- [ ] **Step 5: 커밋 (실제 Firebase 확인은 Task 4 뒤에 한다)**

`rooms/` 경로는 아직 보안 규칙에서 막혀 있다. 실제 왕복 확인은 규칙을 여는
Task 4 의 마지막 단계에서 한다. 여기서는 순수 로직만 확정하고 넘어간다.

```bash
cd /c/Users/NAU/Desktop/Overworked
git add js/net.js test/net-apply.test.js
git commit -m "$(printf '%s\n' '네트워크 계층: SDK 없이 SSE 스트리밍과 REST 쓰기' '' 'Firebase 스트리밍의 put/patch 를 로컬 사본에 적용하는 부분이 이 파일에서' '유일하게 틀리기 쉬운 곳이라 applyEvent 순수 함수로 떼어냈다. 네트워크 없이' 'Node 로 검증한다.' '' '쓰기 실패를 예외로 던지지 않고 값으로 돌려준다. 예외를 던지면 게임 루프가' '멈춘다 — 네트워크가 끊겨도 화면은 계속 돌아가야 한다.' '' 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---
