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
### Task 4: Firebase 보안 규칙에 `rooms` 열기

지금 규칙은 `scores`(퇴근의 계단 랭킹)만 열려 있고 나머지 경로는 전부 잠겨 있다.
`rooms` 를 열어야 이 게임이 돌아간다. **`scores` 규칙은 한 글자도 건드리지 않는다.**

이 태스크는 코드가 아니라 Firebase 콘솔 작업이다. 규칙을 바꾼 뒤 curl 로
"허용해야 할 것은 되고, 막아야 할 것은 막히는지"를 확인한다.

**Files:**
- Create: `docs/firebase-rules.json` (콘솔에 붙여 넣은 규칙 사본 — 무엇을 왜 열었는지 남긴다)

**Interfaces:**
- Consumes: 없음
- Produces: `rooms/<코드>/` 아래 읽기·쓰기 가능. Task 3 의 `Net.put`/`Net.watch` 가 이 경로에서 200 을 받는다.

- [ ] **Step 1: 지금 규칙을 먼저 백업한다**

Firebase 콘솔 → Realtime Database → 규칙 탭에서 현재 규칙 전체를 복사해
`docs/firebase-rules-backup-2026-08-26.json` 으로 저장한다.

**이 단계를 건너뛰지 말 것.** 규칙을 잘못 덮어쓰면 사내 랭킹이 통째로 잠기거나
반대로 통째로 열린다. 되돌릴 것이 있어야 한다.

- [ ] **Step 2: 막혀 있음을 먼저 확인한다**

```bash
curl -s -X PUT -d '{"host":"x","phase":"lobby"}' \
  'https://mohag-8a5b8-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/__t/meta.json'
```

Expected: `{"error":"Permission denied"}`

- [ ] **Step 3: 규칙을 바꾼다**

`docs/firebase-rules.json` 을 만들고, 같은 내용을 콘솔 규칙 탭에 붙여 넣은 뒤 게시한다.

```json
{
  "rules": {
    ".read": false,
    ".write": false,

    "scores": {
      ".read": true,
      "$name": {
        ".write": true,
        ".validate": "newData.hasChildren(['name','floor'])",
        "name":  { ".validate": "newData.isString() && newData.val().length <= 12" },
        "floor": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 100000" },
        "date":  { ".validate": "newData.isString() && newData.val().length <= 12" },
        "t":     { ".validate": "newData.isNumber()" },
        "$other": { ".validate": false }
      }
    },

    "rooms": {
      "$code": {
        ".read": "$code.length == 4",
        ".write": "$code.length == 4",

        "meta": {
          ".validate": "newData.hasChildren(['host','phase'])",
          "host":  { ".validate": "newData.isString() && newData.val().length <= 24" },
          "phase": { ".validate": "newData.isString() && (newData.val() == 'lobby' || newData.val() == 'play' || newData.val() == 'result')" },
          "stage": { ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 6" },
          "born":  { ".validate": "newData.isNumber()" },
          "$other": { ".validate": false }
        },

        "who": {
          "$pid": {
            "name": { ".validate": "newData.isString() && newData.val().length <= 12" },
            "char": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 7" },
            "join": { ".validate": "newData.isNumber()" },
            "seen": { ".validate": "newData.isNumber()" },
            "gear": { ".validate": "newData.hasChildren()" }
          }
        },

        "in": {
          "$pid": {
            "x":   { ".validate": "newData.isNumber() && newData.val() >= -1 && newData.val() <= 1" },
            "y":   { ".validate": "newData.isNumber() && newData.val() >= -1 && newData.val() <= 1" },
            "act": { ".validate": "newData.isNumber()" },
            "seq": { ".validate": "newData.isNumber()" },
            "$other": { ".validate": false }
          }
        },

        "st": { ".validate": "newData.hasChild('t')" },

        "$other": { ".validate": false }
      }
    }
  }
}
```

**왜 이렇게 열었는지:**

- `scores` 블록은 **기존 규칙 그대로**다. Step 1 백업과 대조해서 한 글자도 다르지
  않은지 확인한다. 다르면 백업 쪽을 쓴다.
- `rooms` 는 인증을 두지 않는다. 사내 게임이고, 방 코드를 아는 사람만 들어온다.
  인증을 붙이면 팀원들이 로그인을 해야 하는데 그 마찰이 얻는 것보다 크다.
- 대신 **경로를 `rooms` 안에 가두고 모양을 검사한다.** `$other: false` 가 핵심이다 —
  정해둔 키 말고는 아무것도 못 쓴다. 실수나 장난으로 이상한 데이터가 쌓이지 않는다.
- `$code.length == 4` 로 방 코드 길이를 강제한다. 긴 경로를 만들어 저장소를 채우는
  걸 막는다.
- `in/$pid` 의 `x`, `y` 를 -1~1 로 묶었다. 방향 입력은 그 세 값뿐이다.
- `st` 는 통째로 검사하지 않는다. 스냅샷 모양이 2단계에서 바뀔 텐데 그때마다 규칙을
  고치면 배포가 어긋난다. `t`(틱)만 있으면 통과시킨다.

- [ ] **Step 4: 허용해야 할 것이 되는지 확인한다**

```bash
BASE='https://mohag-8a5b8-default-rtdb.asia-southeast1.firebasedatabase.app'
curl -s -X PUT -d '{"host":"p1","phase":"lobby","stage":1,"born":1}' "$BASE/rooms/TEST/meta.json"; echo
curl -s -X PUT -d '{"name":"테스트","char":0,"join":1,"seen":1}'     "$BASE/rooms/TEST/who/p1.json"; echo
curl -s -X PUT -d '{"x":1,"y":0,"act":0,"seq":3}'                   "$BASE/rooms/TEST/in/p1.json"; echo
curl -s -X PUT -d '{"t":42,"p":{}}'                                 "$BASE/rooms/TEST/st.json"; echo
```

Expected: 네 줄 모두 보낸 값이 그대로 돌아온다 (에러 없음)

- [ ] **Step 5: 막아야 할 것이 막히는지 확인한다**

```bash
BASE='https://mohag-8a5b8-default-rtdb.asia-southeast1.firebasedatabase.app'
echo -n '방코드 5자: ';   curl -s -X PUT -d '{"host":"x","phase":"lobby"}' "$BASE/rooms/TOOLONG/meta.json"
echo; echo -n 'phase 이상: '; curl -s -X PUT -d '{"host":"x","phase":"해킹"}'   "$BASE/rooms/TEST/meta.json"
echo; echo -n 'meta 잡키: ';  curl -s -X PUT -d '{"host":"x","phase":"lobby","evil":1}' "$BASE/rooms/TEST/meta.json"
echo; echo -n '입력 범위: ';  curl -s -X PUT -d '{"x":99,"y":0}'              "$BASE/rooms/TEST/in/p1.json"
echo; echo -n '닉 13자: ';    curl -s -X PUT -d '{"name":"열세글자를넘기는이름입니다"}' "$BASE/rooms/TEST/who/p1.json"
echo; echo -n 'rooms 밖: ';   curl -s -X PUT -d '{"x":1}'                     "$BASE/evil.json"
echo; echo -n 'scores 잡키: ';curl -s -X PUT -d '{"name":"x","floor":1,"evil":1}' "$BASE/scores/__t.json"
echo
```

Expected: **일곱 줄 모두** `{"error":"Permission denied"}`

- [ ] **Step 6: 랭킹이 여전히 살아 있는지 확인한다**

규칙을 고친 뒤 퇴근의 계단이 멀쩡한지 반드시 본다. 이게 이 태스크에서 제일 위험한 부분이다.

```bash
BASE='https://mohag-8a5b8-default-rtdb.asia-southeast1.firebasedatabase.app'
echo -n '랭킹 읽기: '; curl -s "$BASE/scores.json" | head -c 120; echo
echo -n '정상 등록: '; curl -s -X PUT -d '{"name":"__t","floor":1,"date":"2026.08.26","t":1}' "$BASE/scores/__t.json"; echo
curl -s -X DELETE "$BASE/scores/__t.json" > /dev/null
```

Expected: 랭킹이 읽히고, 정상 형태 등록이 200 으로 돌아온다

- [ ] **Step 7: 테스트 방을 지운다**

```bash
curl -s -X DELETE 'https://mohag-8a5b8-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/TEST.json'
```

- [ ] **Step 8: Task 3 의 브라우저 왕복 확인을 지금 한다**

Task 3 Step 5 에서 미뤄 둔 실제 왕복 확인을 여기서 한다.

```bash
cd /c/Users/NAU/Desktop/Overworked && python -m http.server 8895 --directory .
```

빈 페이지(`http://localhost:8895/js/`)의 콘솔에서:

```js
await new Promise(r => { const s=document.createElement('script'); s.src='/js/cloud-config.js'; s.onload=r; document.head.append(s); });
await new Promise(r => { const s=document.createElement('script'); s.src='/js/net.js'; s.onload=r; document.head.append(s); });

const seen = [];
const w = Net.watch('rooms/ZZZZ', st => seen.push(st));
await new Promise(r => setTimeout(r, 600));
const t0 = performance.now();
await Net.put('rooms/ZZZZ/meta', { host: 'me', phase: 'lobby', stage: 1, born: 1 });
await Net.put('rooms/ZZZZ/who/p1', { name: '가', char: 0, join: 1, seen: 1 });
await new Promise(r => setTimeout(r, 900));
const out = { 걸린ms: Math.round(performance.now()-t0), 이벤트수: seen.length, 최종: w.state() };
w.close(); await Net.del('rooms/ZZZZ');
out;
```

Expected:
- `이벤트수` ≥ 3
- `최종` = `{meta:{born:1,host:"me",phase:"lobby",stage:1}, who:{p1:{char:0,join:1,name:"가",seen:1}}}`
- `걸린ms` < 400

- [ ] **Step 9: 커밋**

```bash
cd /c/Users/NAU/Desktop/Overworked
git add docs/firebase-rules.json docs/firebase-rules-backup-2026-08-26.json
git commit -m "$(printf '%s\n' '보안 규칙: rooms 경로를 열되 모양을 강제한다' '' 'scores(퇴근의 계단 랭킹) 블록은 한 글자도 건드리지 않았다. 규칙 변경으로' '사내 랭킹이 잠기거나 열리는 게 이 작업의 유일한 진짜 위험이라, 바꾸기 전에' '백업하고 바꾼 뒤 랭킹 읽기/등록을 다시 확인했다.' '' 'rooms 에 인증은 두지 않는다. 사내 게임이고 방 코드를 아는 사람만 들어온다.' '로그인 마찰이 얻는 것보다 크다. 대신 $other:false 로 정해둔 키 말고는' '아무것도 못 쓰게 막았다.' '' 'st 는 t(틱)만 검사한다. 스냅샷 모양은 2단계에서 바뀌는데 그때마다 규칙을' '고치면 배포와 어긋난다.' '' 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---
### Task 5: 맵과 충돌

1스테이지 작업장 하나. 벽과 작업대는 못 지나가고, 플레이어는 원으로 미끄러진다.
**벽에 부딪혔을 때 멈추지 않고 벽을 따라 미끄러져야 한다** — 8명이 좁은 통로에서
엉키는 게임인데 벽에 붙으면 딱 멈추면 조작이 답답해서 못 한다.

**Files:**
- Create: `js/world.js`
- Create: `test/world.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `window.World.W` = `1280`, `window.World.H` = `720`, `window.World.TILE` = `40`
  - `window.World.R` = `14` (플레이어 반지름)
  - `window.World.STAGE1` → `{ cols, rows, grid, spawns, stations }`
    - `grid`: 길이 `cols*rows` 인 문자열 배열. `'.'`=바닥, `'#'`=벽, `'S'`=작업대(막힘)
    - `spawns`: `[{x,y}, ...]` 8개
    - `stations`: `[{id, type, cx, cy}, ...]` — `cx,cy`는 디자인 좌표 중심
  - `window.World.solidAt(map, x, y)` → boolean. 디자인 좌표가 막힌 칸인지.
  - `window.World.move(map, x, y, dx, dy)` → `{x, y}`. 반지름 `R` 원을 `dx,dy` 만큼 밀되 벽을 따라 미끄러진다.
  - `window.World.nearest(map, x, y, maxDist)` → 가장 가까운 station 객체 또는 `null`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/world.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function world() { return load('world').World; }

/* 테스트용 작은 맵: 5x3, 테두리가 벽
   #####
   #...#
   ##### */
function tiny(W) {
  return {
    cols: 5, rows: 3,
    grid: ('#####' + '#...#' + '#####').split(''),
    spawns: [], stations: []
  };
}

test('맵 크기와 상수', () => {
  const W = world();
  assert.strictEqual(W.W, 1280);
  assert.strictEqual(W.H, 720);
  assert.strictEqual(W.TILE, 40);
  assert.ok(W.R > 0 && W.R < W.TILE / 2, '반지름이 타일 절반보다 작아야 통로를 지난다');
});

test('solidAt 은 벽 칸을 막힌 것으로 본다', () => {
  const W = world(), m = tiny(W);
  assert.strictEqual(W.solidAt(m, 20, 20), true);    // (0,0) 벽
  assert.strictEqual(W.solidAt(m, 60, 60), false);   // (1,1) 바닥
  assert.strictEqual(W.solidAt(m, 140, 60), false);  // (3,1) 바닥
  assert.strictEqual(W.solidAt(m, 180, 60), true);   // (4,1) 오른쪽 벽
  assert.strictEqual(W.solidAt(m, 20, 60), true);    // (0,1) 왼쪽 벽
});

test('solidAt 은 맵 밖을 막힌 것으로 본다', () => {
  const W = world(), m = tiny(W);
  assert.strictEqual(W.solidAt(m, -5, 60), true);
  assert.strictEqual(W.solidAt(m, 9999, 60), true);
  assert.strictEqual(W.solidAt(m, 60, -5), true);
  assert.strictEqual(W.solidAt(m, 60, 9999), true);
});

test('빈 곳에서는 그대로 움직인다', () => {
  const W = world(), m = tiny(W);
  const p = W.move(m, 60, 60, 10, 0);
  assert.strictEqual(Math.round(p.x), 70);
  assert.strictEqual(Math.round(p.y), 60);
});

test('벽을 향해 밀면 벽에 닿아 멈춘다', () => {
  const W = world(), m = tiny(W);
  const p = W.move(m, 60, 60, -100, 0);
  assert.ok(p.x >= 40 + W.R - 0.5, '왼쪽 벽(x=40) 안으로 들어가면 안 된다: ' + p.x);
  assert.ok(p.x <= 40 + W.R + 0.5);
});

test('벽에 비스듬히 밀면 벽을 따라 미끄러진다', () => {
  const W = world(), m = tiny(W);
  /* 위쪽 벽(y<40)을 향해 오른쪽 위로 민다. y 는 막히고 x 는 가야 한다. */
  const p = W.move(m, 60, 60, 20, -100);
  assert.ok(p.x > 70, '가로 성분이 살아 있어야 한다: ' + p.x);
  assert.ok(p.y >= 40 + W.R - 0.5, '위쪽 벽을 뚫으면 안 된다: ' + p.y);
});

test('움직이지 않으면 자리가 그대로다', () => {
  const W = world(), m = tiny(W);
  const p = W.move(m, 60, 60, 0, 0);
  assert.strictEqual(p.x, 60);
  assert.strictEqual(p.y, 60);
});

test('1스테이지 맵이 화면에 들어맞는다', () => {
  const W = world(), m = W.STAGE1;
  assert.strictEqual(m.cols * W.TILE, W.W);
  assert.strictEqual(m.rows * W.TILE, W.H);
  assert.strictEqual(m.grid.length, m.cols * m.rows);
});

test('1스테이지에 스폰 8개가 있고 전부 바닥이다', () => {
  const W = world(), m = W.STAGE1;
  assert.strictEqual(m.spawns.length, 8);
  for (const s of m.spawns) {
    assert.strictEqual(W.solidAt(m, s.x, s.y), false, '스폰이 벽 안이다: ' + JSON.stringify(s));
  }
});

test('1스테이지에 필요한 기계가 다 있다', () => {
  const W = world(), m = W.STAGE1;
  const types = m.stations.map(s => s.type).sort();
  for (const need of ['ref', 'model', 'retopo', 'ship', 'bin']) {
    assert.ok(types.includes(need), need + ' 기계가 없다');
  }
  const ids = m.stations.map(s => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'id 가 겹친다');
});

test('모든 기계 앞에 설 자리가 있다', () => {
  const W = world(), m = W.STAGE1;
  for (const st of m.stations) {
    const around = [[0,-W.TILE],[0,W.TILE],[-W.TILE,0],[W.TILE,0]];
    const open = around.filter(d => !W.solidAt(m, st.cx + d[0], st.cy + d[1]));
    assert.ok(open.length > 0, st.id + ' 앞에 설 자리가 없다');
  }
});

test('nearest 는 범위 안의 가장 가까운 기계를 준다', () => {
  const W = world(), m = W.STAGE1;
  const st = m.stations[0];
  assert.strictEqual(W.nearest(m, st.cx, st.cy, 60).id, st.id);
  assert.strictEqual(W.nearest(m, st.cx + 20, st.cy, 60).id, st.id);
});

test('nearest 는 범위 밖이면 null', () => {
  const W = world(), m = W.STAGE1;
  /* 가운데 열린 띠 한복판 — 어느 기계에서도 멀다 */
  assert.strictEqual(W.nearest(m, 16 * W.TILE, 6 * W.TILE, 40), null);
});

test('nearest 는 둘 중 더 가까운 쪽을 고른다', () => {
  const W = world();
  /* 실제 맵으로 하면 세 번째 기계가 더 가까워서 시험이 흐려진다.
     "둘 중 가까운 쪽"만 보려면 기계가 둘뿐인 맵을 지어서 쓴다. */
  const m = {
    cols: 5, rows: 3, grid: ('#####' + '#...#' + '#####').split(''), spawns: [],
    stations: [
      { id: 'a', type: 'ref', cx: 60, cy: 60 },
      { id: 'b', type: 'ship', cx: 140, cy: 60 }
    ]
  };
  assert.strictEqual(W.nearest(m, 90, 60, 400).id, 'a');
  assert.strictEqual(W.nearest(m, 110, 60, 400).id, 'b');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /c/Users/NAU/Desktop/Overworked && node --test test/world.test.js`
Expected: FAIL — `ENOENT ... js/world.js`

- [ ] **Step 3: 구현**

`js/world.js`:

```js
/* ============================================================
   오버워크드 — 맵과 충돌

   좌표계는 1280x720 디자인 픽셀로 고정한다. 화면이 얼마든 게임 로직은
   항상 이 좌표를 쓰고, 스케일은 그리기 직전에만 건다. 이래야 사람마다
   창 크기가 달라도 같은 판을 본다.

   타일 40px, 플레이어 반지름 14px. 반지름이 타일 절반(20)보다 작아야
   한 칸짜리 통로를 지날 수 있다.

   ── 미끄러짐에 대해 ────────────────────────────────────
   벽에 부딪혔을 때 딱 멈추면 조작이 답답해서 못 한다. 8명이 좁은 통로에서
   엉키는 게임이라 벽을 따라 흘러야 한다. 그래서 x 와 y 를 따로 밀어 보고
   막힌 축만 버린다. 축 분리는 가장 싼 방법이면서 이 게임엔 충분하다.
   ============================================================ */
(function (global) {
  'use strict';

  var W = 1280, H = 720, TILE = 40, R = 14;
  var COLS = W / TILE;          // 32
  var ROWS = H / TILE;          // 18

  function tileAt(map, x, y) {
    var cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
    if (cx < 0 || cy < 0 || cx >= map.cols || cy >= map.rows) return '#';   // 맵 밖은 벽
    return map.grid[cy * map.cols + cx];
  }

  function solidAt(map, x, y) {
    var t = tileAt(map, x, y);
    return t === '#' || t === 'S';
  }

  /* 반지름 R 인 원이 (x,y) 에 있을 때 겹치는 칸이 있는가.
     원의 네 극점만 본다 — 타일이 반지름보다 크므로 이걸로 충분하다. */
  function blocked(map, x, y) {
    return solidAt(map, x - R, y) || solidAt(map, x + R, y) ||
           solidAt(map, x, y - R) || solidAt(map, x, y + R) ||
           solidAt(map, x - R * 0.7, y - R * 0.7) || solidAt(map, x + R * 0.7, y - R * 0.7) ||
           solidAt(map, x - R * 0.7, y + R * 0.7) || solidAt(map, x + R * 0.7, y + R * 0.7);
  }

  /* 한 축을 밀어 본다. 막히면 벽에 딱 붙는 자리까지만 간다.
     이분 탐색을 쓰는 이유: 한 프레임에 여러 칸을 건너뛸 만큼 빠를 때도
     벽을 통과하지 않게 하려면 "얼마나 갈 수 있나"를 찾아야 한다. */
  function slide(map, x, y, dx, dy) {
    var nx = x + dx, ny = y + dy;
    if (!blocked(map, nx, ny)) return { x: nx, y: ny };

    var lo = 0, hi = 1;
    for (var i = 0; i < 12; i++) {
      var mid = (lo + hi) / 2;
      if (blocked(map, x + dx * mid, y + dy * mid)) hi = mid; else lo = mid;
    }
    return { x: x + dx * lo, y: y + dy * lo };
  }

  function move(map, x, y, dx, dy) {
    var p = { x: x, y: y };
    if (dx) p = slide(map, p.x, p.y, dx, 0);
    if (dy) p = slide(map, p.x, p.y, 0, dy);
    return p;
  }

  function nearest(map, x, y, maxDist) {
    var best = null, bd = maxDist * maxDist;
    for (var i = 0; i < map.stations.length; i++) {
      var s = map.stations[i];
      var ddx = s.cx - x, ddy = s.cy - y;
      var d = ddx * ddx + ddy * ddy;
      if (d <= bd) { bd = d; best = s; }
    }
    return best;
  }

  /* ---------- 1스테이지: 인턴의 첫 발주 ----------
     32x18 칸. 가운데 섬이 하나 있어 8명이 한 줄로 몰리지 않고 갈라진다.
     기계는 벽에 붙여 두고 앞칸을 비워, 서는 자리가 통로를 막지 않게 한다.

     . 바닥   # 벽   S 작업대(막힘)                                        */
  var G1 = [
    '################################',
    '#..............................#',
    '#..SS......................SS..#',
    '#..............................#',
    '#..............................#',
    '#........####........####......#',
    '#........#..#........#..#......#',
    '#........####........####......#',
    '#..............................#',
    '#..............................#',
    '#..............................#',
    '#........####........####......#',
    '#........#..#........#..#......#',
    '#........####........####......#',
    '#..............................#',
    '#..SS......................SS..#',
    '#..............................#',
    '################################'
  ];

  function buildStage1() {
    var grid = G1.join('').split('');
    var map = { cols: COLS, rows: ROWS, grid: grid, spawns: [], stations: [] };

    /* 기계 자리는 위에서 'SS' 로 찍어 둔 네 곳이다. 좌표는 그 두 칸의 가운데. */
    map.stations = [
      { id: 'ref1',    type: 'ref',    cx: 4 * TILE + TILE / 2,  cy: 2 * TILE + TILE / 2 },
      { id: 'model1',  type: 'model',  cx: 28 * TILE - TILE / 2, cy: 2 * TILE + TILE / 2 },
      { id: 'retopo1', type: 'retopo', cx: 4 * TILE + TILE / 2,  cy: 15 * TILE + TILE / 2 },
      { id: 'ship1',   type: 'ship',   cx: 28 * TILE - TILE / 2, cy: 15 * TILE + TILE / 2 }
    ];

    /* 폐기통은 가운데 섬 옆 바닥에 둔다. 벽이 아니라 바닥 위 물건이라
       지나갈 수 있다 — 통로 한가운데 막힌 걸 두면 8명이 엉킨다. */
    map.stations.push({ id: 'bin1', type: 'bin', cx: 16 * TILE, cy: 9 * TILE + TILE / 2 });

    /* 스폰 8개 — 가운데 열린 띠(9~10행)에 좌우로 흩는다 */
    for (var i = 0; i < 8; i++) {
      map.spawns.push({
        x: (5 + i * 3) * TILE + TILE / 2,
        y: (i % 2 === 0 ? 9 : 10) * TILE + TILE / 2
      });
    }
    return map;
  }

  global.World = {
    W: W, H: H, TILE: TILE, R: R, COLS: COLS, ROWS: ROWS,
    solidAt: solidAt,
    blocked: blocked,
    move: move,
    nearest: nearest,
    STAGE1: buildStage1()
  };
})(window);
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd /c/Users/NAU/Desktop/Overworked && node --test test/world.test.js`
Expected: PASS — `15 pass, 0 fail`

맵 글자를 하나라도 잘못 세면 `1스테이지 맵이 화면에 들어맞는다` 또는
`스폰 8개가 전부 바닥이다` 가 깨진다. 깨지면 `G1` 의 각 줄이 정확히 32글자인지,
줄이 18개인지부터 센다:

```bash
cd /c/Users/NAU/Desktop/Overworked && node -e "
const {load}=require('./testlib/load'); const W=load('world').World;
const m=W.STAGE1;
console.log('칸', m.cols+'x'+m.rows, '= '+(m.cols*m.rows), '실제', m.grid.length);
for(let r=0;r<m.rows;r++) console.log(String(r).padStart(2), m.grid.slice(r*m.cols,(r+1)*m.cols).join(''));
"
```

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/NAU/Desktop/Overworked
git add js/world.js test/world.test.js
git commit -m "$(printf '%s\n' '맵과 충돌: 벽을 따라 미끄러진다' '' '벽에 부딪혔을 때 딱 멈추면 조작이 답답해서 못 한다. 8명이 좁은 통로에서' '엉키는 게임이라 벽을 따라 흘러야 한다. x 와 y 를 따로 밀어 보고 막힌 축만' '버리는 축 분리 방식으로, 가장 싸면서 이 게임엔 충분하다.' '' '한 프레임에 여러 칸을 건너뛸 만큼 빠를 때도 벽을 통과하지 않게 이분 탐색으로' '"얼마나 갈 수 있나"를 찾는다.' '' '폐기통은 벽이 아니라 바닥 위에 둔다. 통로 한가운데 막힌 걸 두면 8명이 엉킨다.' '' 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---
### Task 6: 공정 상태 기계

물건이 어떤 기계에서 어떤 상태로 바뀌는지를 정하는 표와, 그 표를 읽는 함수들.
**여기가 게임 규칙의 전부다.** 시뮬레이션도 그리기도 이 표를 읽기만 한다.

1단계에서는 `ref → model → retopo → ship` 만 쓴다. 나머지 공정은 표에 미리
넣어 두되 1스테이지 맵에 기계를 두지 않는다 — 2단계에서 맵만 늘리면 된다.

**Files:**
- Create: `js/stations.js`
- Create: `test/stations.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `window.Stations.TYPES` → `{ ref, model, retopo, uv, bake, rig, farm, ship, bin }`. 각 값은 `{ name, mode, accepts, gives, work, burn }`
    - `mode`: `'source'`(집으면 나옴) / `'tap'`(연타) / `'wait'`(놓고 대기) / `'sink'`(넣으면 사라짐)
    - `accepts`: 받아 주는 물건 상태 배열. `null` 이면 아무거나
    - `gives`: 나오는 물건 상태. `null` 이면 없음
    - `work`: `'tap'` 이면 필요한 누름 횟수, `'wait'` 이면 걸리는 초
    - `burn`: `'wait'` 기계에서 다 익은 뒤 타기까지의 초. `0` 이면 안 탄다
  - `window.Stations.get(type)` → 정의 객체 또는 `null`
  - `window.Stations.canAccept(type, itemState)` → boolean
  - `window.Stations.STAGE1_GOAL` → `{ need: 'low', count: 6 }` — 1스테이지는 로우폴리 6개 납품
  - `window.Stations.step(machine, dt)` → 새 machine. `'wait'` 기계의 진행·완성·탐을 굴린다. **입력을 그 자리에서 고치지 않는다.**
    - machine 모양: `{ id, type, item, prog }` (`item`은 물건 상태 문자열 또는 `null`)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/stations.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function S() { return load('stations').Stations; }

test('1단계에 필요한 기계가 정의돼 있다', () => {
  const T = S().TYPES;
  for (const k of ['ref', 'model', 'retopo', 'ship', 'bin']) {
    assert.ok(T[k], k + ' 정의가 없다');
    assert.ok(typeof T[k].name === 'string' && T[k].name.length > 0, k + ' 이름이 없다');
  }
});

test('2단계용 기계도 미리 들어 있다', () => {
  const T = S().TYPES;
  for (const k of ['uv', 'bake', 'rig', 'farm']) assert.ok(T[k], k + ' 정의가 없다');
});

test('mode 는 정해진 넷 중 하나다', () => {
  const T = S().TYPES;
  for (const k in T) {
    assert.ok(['source', 'tap', 'wait', 'sink'].indexOf(T[k].mode) >= 0, k + ' 의 mode 가 이상하다');
  }
});

test('공정이 ref 에서 done 까지 한 줄로 이어진다', () => {
  const T = S().TYPES;
  assert.strictEqual(T.ref.gives, 'ref');
  assert.deepStrictEqual(T.model.accepts, ['ref']);
  assert.strictEqual(T.model.gives, 'high');
  assert.deepStrictEqual(T.retopo.accepts, ['high']);
  assert.strictEqual(T.retopo.gives, 'low');
  assert.deepStrictEqual(T.uv.accepts, ['low']);
  assert.strictEqual(T.uv.gives, 'uv');
  assert.deepStrictEqual(T.bake.accepts, ['uv']);
  assert.strictEqual(T.bake.gives, 'tex');
  assert.deepStrictEqual(T.rig.accepts, ['tex']);
  assert.strictEqual(T.rig.gives, 'rig');
  assert.deepStrictEqual(T.farm.accepts, ['rig']);
  assert.strictEqual(T.farm.gives, 'done');
});

test('폐기통은 아무거나 받고 아무것도 안 준다', () => {
  const T = S().TYPES;
  assert.strictEqual(T.bin.accepts, null);
  assert.strictEqual(T.bin.gives, null);
  assert.strictEqual(T.bin.mode, 'sink');
});

test('canAccept 는 받을 수 있는 것만 통과시킨다', () => {
  const St = S();
  assert.strictEqual(St.canAccept('model', 'ref'), true);
  assert.strictEqual(St.canAccept('model', 'high'), false);
  assert.strictEqual(St.canAccept('retopo', 'high'), true);
  assert.strictEqual(St.canAccept('retopo', 'ref'), false);
  assert.strictEqual(St.canAccept('bin', 'burnt'), true, '폐기통은 탄 것도 받는다');
  assert.strictEqual(St.canAccept('bin', 'ref'), true);
  assert.strictEqual(St.canAccept('없는기계', 'ref'), false);
});

test('ref 는 source 라 아무것도 안 받는다', () => {
  const St = S();
  assert.strictEqual(St.TYPES.ref.mode, 'source');
  assert.strictEqual(St.canAccept('ref', 'ref'), false);
  assert.strictEqual(St.canAccept('ref', 'low'), false);
});

test('1스테이지 목표는 로우폴리 6개', () => {
  const G = S().STAGE1_GOAL;
  assert.strictEqual(G.need, 'low');
  assert.ok(G.count >= 4 && G.count <= 10, '목표가 4~10 사이여야 판이 지루하지도 길지도 않다');
});

test('ship 은 mode 가 sink 다', () => {
  assert.strictEqual(S().TYPES.ship.mode, 'sink');
});

test('tap 기계는 누름 횟수가 있고 wait 기계는 초가 있다', () => {
  const T = S().TYPES;
  assert.ok(T.model.work >= 1, '연타 횟수가 1 이상이어야 한다');
  assert.ok(T.retopo.work >= 1);
  assert.ok(T.uv.work > 0, '대기 초가 0 보다 커야 한다');
  assert.ok(T.bake.work > 0);
});

/* ---------- step ---------- */

test('step 은 빈 기계를 그대로 둔다', () => {
  const St = S();
  const m = { id: 'uv1', type: 'uv', item: null, prog: 0 };
  assert.deepStrictEqual(St.step(m, 1), m);
});

test('step 은 tap 기계를 시간으로 굴리지 않는다', () => {
  const St = S();
  const m = { id: 'model1', type: 'model', item: 'ref', prog: 0 };
  assert.strictEqual(St.step(m, 5).prog, 0);
});

test('step 은 wait 기계의 진행을 올린다', () => {
  const St = S();
  const T = St.TYPES.uv;
  const m = { id: 'uv1', type: 'uv', item: 'low', prog: 0 };
  const out = St.step(m, T.work / 2);
  assert.ok(out.prog > 0.4 && out.prog < 0.6, '절반쯤 와야 한다: ' + out.prog);
  assert.strictEqual(out.item, 'low', '아직 안 끝났으면 상태 그대로');
});

test('step 은 다 되면 결과물로 바꾸고 진행을 1 로 둔다', () => {
  const St = S();
  const m = { id: 'uv1', type: 'uv', item: 'low', prog: 0 };
  const out = St.step(m, St.TYPES.uv.work + 0.1);
  assert.strictEqual(out.item, 'uv');
  assert.strictEqual(out.prog, 1);
});

test('step 은 원본을 고치지 않는다', () => {
  const St = S();
  const m = { id: 'uv1', type: 'uv', item: 'low', prog: 0 };
  St.step(m, 99);
  assert.strictEqual(m.item, 'low');
  assert.strictEqual(m.prog, 0);
});

test('베이커는 다 익은 뒤 방치하면 탄다', () => {
  const St = S();
  const T = St.TYPES.bake;
  assert.ok(T.burn > 0, '베이커는 타야 한다');
  let m = { id: 'bake1', type: 'bake', item: 'uv', prog: 0 };
  m = St.step(m, T.work + 0.1);
  assert.strictEqual(m.item, 'tex', '먼저 다 익는다');
  m = St.step(m, T.burn + 0.1);
  assert.strictEqual(m.item, 'burnt', '방치하면 탄다');
});

test('타지 않는 기계는 두어도 안 탄다', () => {
  const St = S();
  assert.strictEqual(St.TYPES.uv.burn, 0);
  let m = { id: 'uv1', type: 'uv', item: 'low', prog: 0 };
  m = St.step(m, 999);
  m = St.step(m, 999);
  assert.strictEqual(m.item, 'uv', 'UV 는 타지 않는다');
});

test('탄 것은 더 타지 않는다', () => {
  const St = S();
  let m = { id: 'bake1', type: 'bake', item: 'burnt', prog: 1 };
  assert.strictEqual(St.step(m, 999).item, 'burnt');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /c/Users/NAU/Desktop/Overworked && node --test test/stations.test.js`
Expected: FAIL — `ENOENT ... js/stations.js`

- [ ] **Step 3: 구현**

`js/stations.js`:

```js
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
     시뮬레이션 상태를 그 자리에서 바꾸면 "언제 바뀌었지"를 못 쫓는다. */
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
      return { id: machine.id, type: machine.type, item: d.gives, prog: 1 };
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
```

> **`prog` 가 두 가지 뜻을 겸한다.** 익는 동안은 0~1(진행률), 다 익은 뒤에는
> 1~2(타기까지의 진행률)다. 값 하나로 두 단계를 표현하면 스냅샷에 숫자를 하나만
> 실어도 되고, 그리는 쪽은 `prog > 1` 인지만 보면 "타는 중"을 알 수 있다.
> 이 규칙을 모르고 `prog` 를 건드리면 다 익은 물건이 갑자기 덜 익은 상태가 된다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd /c/Users/NAU/Desktop/Overworked && node --test test/stations.test.js`
Expected: PASS — `18 pass, 0 fail`

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/NAU/Desktop/Overworked
git add js/stations.js test/stations.test.js
git commit -m "$(printf '%s\n' '공정 상태 기계: 게임 규칙을 표 하나에 모은다' '' '시뮬레이션도 그리기도 이 표를 읽기만 한다. 규칙을 바꾸려면 이 파일만 고친다.' '' '연타(tap)와 대기(wait)를 나눈 이유가 있다. 연타 기계 앞에는 사람이 붙어' '있어야 하고 대기 기계는 놓고 딴 일을 하러 가야 한다. 이 둘이 섞여야 "지금' '누가 어디 있어야 하는가"를 계속 다시 판단하게 된다. 전부 연타면 각자 한 대씩' '잡고 끝이고, 전부 대기면 할 일이 없다.' '' 'prog 는 익는 동안 0~1, 다 익은 뒤 1~2(타기까지)로 두 뜻을 겸한다. 값 하나면' '스냅샷에 숫자를 하나만 실어도 되고, 그리는 쪽은 prog > 1 만 보면 된다.' '' '2단계용 기계(uv/bake/rig/farm)도 표에 미리 넣었다. 맵에 두지만 않으면' '1스테이지에는 안 나온다.' '' 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---
### Task 7: 시뮬레이션 — 유일한 권위

호스트만 이걸 돌린다. 입력을 받아 60Hz로 세계를 굴린다.
**이 파일은 네트워크도, 캔버스도, DOM도 모른다.** 순수 함수 덩어리라서
브라우저 없이 Node 로 전부 검증한다 — 8명이 붙은 뒤에 규칙 버그를 찾으면
누구 화면이 맞는지부터 다퉈야 한다.

**Files:**
- Create: `js/sim.js`
- Create: `test/sim.test.js`

**Interfaces:**
- Consumes: `window.World` (Task 5), `window.Stations` (Task 6)
- Produces:
  - `window.Sim.SPEED` = `210` (초당 디자인 픽셀)
  - `window.Sim.REACH` = `46` (기계에 손이 닿는 거리)
  - `window.Sim.create(map, pids)` → 새 상태
    - `{ t, map, players:{<pid>:{x,y,dir,hold,tap}}, machines:{<id>:{id,type,item,prog}}, done, goal }`
    - `hold`: 들고 있는 물건 상태 문자열 또는 `null`
    - `dir`: `0`=아래 `1`=왼쪽 `2`=오른쪽 `3`=위 (그리기용)
    - `done`: 납품 개수
  - `window.Sim.tick(state, inputs, dt)` → 새 상태. `inputs`는 `{<pid>:{x,y,seq}}`
    - `seq`는 액션(집기/놓기/작업) 누른 횟수. 늘어난 만큼 액션을 처리한다.
  - `window.Sim.join(state, pid, spawnIndex)` → 새 상태 (플레이어 추가)
  - `window.Sim.leave(state, pid)` → 새 상태 (플레이어 제거, 들고 있던 건 사라진다)

**액션 하나가 하는 일 (순서대로 검사, 첫 번째로 맞는 것만 실행):**

1. 손이 비었고 가까운 기계가 `source` → 새 물건을 든다
2. 손이 비었고 `tap` 기계에 **아직 처리할 수 있는** 물건이 있음 → 한 번 두드린다
3. 손이 비었고 기계에 물건이 있음 → 그 물건을 집는다
4. 손에 물건이 있고 가까운 기계가 `sink` → 넣는다 (납품대면 목표와 맞을 때만 점수)
5. 손에 물건이 있고 기계가 비었고 받아 줌 → 놓는다
6. 아무것도 아님

> **두드리기가 집기보다 앞서야 하는 이유:** 집기가 먼저면 모델링대에 레퍼런스를
> 놓고 두드리려 할 때마다 도로 집어 들게 되어 작업이 영원히 안 된다. 두드리기를
> 앞에 두되 **그 기계가 아직 처리할 수 있는 물건일 때만** 걸리게 하면, 다 된
> 하이폴리는 `canAccept` 가 false 라 자연히 집기로 넘어간다. 규칙 하나로
> "작업 중에는 두드리고, 다 되면 집는다"가 된다.

> **손이 비어야만 두드릴 수 있는 이유:** 물건을 든 채로 두드릴 수 있으면 한 사람이
> 레퍼런스를 들고 모델링대 앞에 서서 혼자 다 끝낸다. 손을 비워야만 두드릴 수
> 있어야 "놓고 → 두드리고 → 집어서 → 옮긴다"가 되고, 그래야 여럿이 나눠 맡을
> 이유가 생긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/sim.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function sim() { return load(['world', 'stations', 'sim']); }

/* 기계 넷만 있는 시험용 맵. 실제 맵은 넓어서 좌표 계산이 번거롭다. */
function bench(w) {
  const W = w.World, T = W.TILE;
  return {
    cols: 10, rows: 5,
    grid: ('##########' +
           '#SS....SS#' +
           '#........#' +
           '#SS....SS#' +
           '##########').split(''),
    spawns: [{ x: 5 * T, y: 2 * T + T / 2 }, { x: 4 * T, y: 2 * T + T / 2 }],
    stations: [
      { id: 'r', type: 'ref',    cx: 1 * T + T / 2, cy: 1 * T + T / 2 },
      { id: 'm', type: 'model',  cx: 7 * T + T / 2, cy: 1 * T + T / 2 },
      { id: 'q', type: 'retopo', cx: 1 * T + T / 2, cy: 3 * T + T / 2 },
      { id: 's', type: 'ship',   cx: 7 * T + T / 2, cy: 3 * T + T / 2 }
    ]
  };
}

/* 플레이어를 기계 바로 옆에 세운다 (닿는 거리 안) */
function stand(st, pid, stationId, S) {
  const m = st.map.stations.find(x => x.id === stationId);
  const p = st.players[pid];
  p.x = m.cx; p.y = m.cy + 30;
  return st;
}

function act(w, st, pid, inputs) {
  const seq = (inputs && inputs[pid] ? inputs[pid].seq : 0);
  const inp = {}; inp[pid] = { x: 0, y: 0, seq: seq + 1 };
  return { st: w.Sim.tick(st, inp, 1 / 60), inputs: inp };
}

test('create 는 플레이어와 기계를 세운다', () => {
  const w = sim(), S = w.Sim;
  const st = S.create(bench(w), ['a', 'b']);
  assert.strictEqual(Object.keys(st.players).length, 2);
  assert.strictEqual(Object.keys(st.machines).length, 4);
  assert.strictEqual(st.players.a.hold, null);
  assert.strictEqual(st.machines.m.item, null);
  assert.strictEqual(st.done, 0);
  assert.strictEqual(st.t, 0);
});

test('tick 은 t 를 올린다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  st = S.tick(st, {}, 0.5);
  assert.ok(Math.abs(st.t - 0.5) < 1e-9);
});

test('방향 입력으로 움직인다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  const x0 = st.players.a.x;
  st = S.tick(st, { a: { x: 1, y: 0, seq: 0 } }, 0.5);
  assert.ok(st.players.a.x > x0, '오른쪽으로 가야 한다');
  assert.strictEqual(st.players.a.dir, 2, '오른쪽을 봐야 한다');
});

test('대각선으로 가도 속도가 빨라지지 않는다', () => {
  const w = sim(), S = w.Sim;
  const start = S.create(bench(w), ['a']);
  const a = S.tick(start, { a: { x: 1, y: 0, seq: 0 } }, 0.2);
  const b = S.tick(start, { a: { x: 1, y: 1, seq: 0 } }, 0.2);
  const da = Math.hypot(a.players.a.x - start.players.a.x, a.players.a.y - start.players.a.y);
  const db = Math.hypot(b.players.a.x - start.players.a.x, b.players.a.y - start.players.a.y);
  assert.ok(Math.abs(da - db) < 1.5, '대각선이 더 빠르면 안 된다: ' + da + ' vs ' + db);
});

test('tick 은 원본 상태를 고치지 않는다', () => {
  const w = sim(), S = w.Sim;
  const st = S.create(bench(w), ['a']);
  const x0 = st.players.a.x;
  S.tick(st, { a: { x: 1, y: 0, seq: 0 } }, 0.5);
  assert.strictEqual(st.players.a.x, x0);
});

test('seq 가 그대로면 액션이 안 일어난다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  stand(st, 'a', 'r', S);
  st = S.tick(st, { a: { x: 0, y: 0, seq: 0 } }, 1 / 60);
  st = S.tick(st, { a: { x: 0, y: 0, seq: 0 } }, 1 / 60);
  assert.strictEqual(st.players.a.hold, null);
});

test('선반 옆에서 액션하면 레퍼런스를 든다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  stand(st, 'a', 'r', S);
  st = S.tick(st, { a: { x: 0, y: 0, seq: 1 } }, 1 / 60);
  assert.strictEqual(st.players.a.hold, 'ref');
});

test('멀리 있으면 아무 일도 안 일어난다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  st.players.a.x = 5 * w.World.TILE;
  st.players.a.y = 2 * w.World.TILE + w.World.TILE / 2;
  st = S.tick(st, { a: { x: 0, y: 0, seq: 1 } }, 1 / 60);
  assert.strictEqual(st.players.a.hold, null);
});

test('받아 주는 기계에만 놓을 수 있다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  st.players.a.hold = 'ref';
  stand(st, 'a', 'q', S);                       // 리토폴은 high 만 받는다
  st = S.tick(st, { a: { x: 0, y: 0, seq: 1 } }, 1 / 60);
  assert.strictEqual(st.players.a.hold, 'ref', '아직 손에 있어야 한다');
  assert.strictEqual(st.machines.q.item, null);
});

test('모델링대에 레퍼런스를 놓고 연타하면 하이폴리가 된다', () => {
  const w = sim(), S = w.Sim;
  const need = w.Stations.TYPES.model.work;
  let st = S.create(bench(w), ['a']);
  st.players.a.hold = 'ref';
  stand(st, 'a', 'm', S);

  let seq = 0;
  st = S.tick(st, { a: { x: 0, y: 0, seq: ++seq } }, 1 / 60);   // 놓기
  assert.strictEqual(st.machines.m.item, 'ref');
  assert.strictEqual(st.players.a.hold, null);

  for (let i = 0; i < need - 1; i++) {
    st = S.tick(st, { a: { x: 0, y: 0, seq: ++seq } }, 1 / 60);
    assert.strictEqual(st.machines.m.item, 'ref', i + '번째에 벌써 끝나면 안 된다');
  }
  st = S.tick(st, { a: { x: 0, y: 0, seq: ++seq } }, 1 / 60);
  assert.strictEqual(st.machines.m.item, 'high', need + '번이면 끝나야 한다');
  assert.strictEqual(st.machines.m.prog, 0, '끝나면 누름 수가 초기화된다');
});

test('손에 물건이 있으면 두드릴 수 없다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a', 'b']);
  st.machines.m = { id: 'm', type: 'model', item: 'ref', prog: 0 };
  st.players.a.hold = 'ref';
  stand(st, 'a', 'm', S);
  st = S.tick(st, { a: { x: 0, y: 0, seq: 1 } }, 1 / 60);
  assert.strictEqual(st.machines.m.prog, 0, '두드려지면 안 된다');
  assert.strictEqual(st.players.a.hold, 'ref', '기계가 차 있으니 놓지도 못한다');
});

test('기계 위의 물건을 집을 수 있다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  st.machines.m = { id: 'm', type: 'model', item: 'high', prog: 0 };
  stand(st, 'a', 'm', S);
  st = S.tick(st, { a: { x: 0, y: 0, seq: 1 } }, 1 / 60);
  assert.strictEqual(st.players.a.hold, 'high');
  assert.strictEqual(st.machines.m.item, null);
});

test('납품대에 목표 물건을 넣으면 점수가 오른다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  st.players.a.hold = st.goal.need;
  stand(st, 'a', 's', S);
  st = S.tick(st, { a: { x: 0, y: 0, seq: 1 } }, 1 / 60);
  assert.strictEqual(st.done, 1);
  assert.strictEqual(st.players.a.hold, null);
});

test('납품대에 엉뚱한 걸 넣으면 사라지되 점수는 안 오른다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  st.players.a.hold = 'ref';
  stand(st, 'a', 's', S);
  st = S.tick(st, { a: { x: 0, y: 0, seq: 1 } }, 1 / 60);
  assert.strictEqual(st.done, 0);
  assert.strictEqual(st.players.a.hold, null, '넣긴 넣어진다');
});

test('연타 한 번에 seq 가 여러 칸 뛰면 그만큼 처리한다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  st.machines.m = { id: 'm', type: 'model', item: 'ref', prog: 0 };
  stand(st, 'a', 'm', S);
  /* 네트워크가 밀려 seq 가 한꺼번에 3 늘어난 상황. 연타가 씹히면 안 된다. */
  st = S.tick(st, { a: { x: 0, y: 0, seq: 3 } }, 1 / 60);
  assert.strictEqual(st.machines.m.prog, 3);
});

test('한 번에 너무 많이 밀려도 상한이 있다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  st.machines.m = { id: 'm', type: 'model', item: 'ref', prog: 0 };
  stand(st, 'a', 'm', S);
  st = S.tick(st, { a: { x: 0, y: 0, seq: 100000 } }, 1 / 60);
  assert.ok(st.machines.m.item === 'high' || st.machines.m.prog <= 20,
    '한 틱에 무한히 처리하면 안 된다');
});

test('join 이 플레이어를 넣고 leave 가 뺀다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  st = S.join(st, 'b', 1);
  assert.ok(st.players.b, 'b 가 들어와야 한다');
  st.players.b.hold = 'high';
  st = S.leave(st, 'b');
  assert.strictEqual(st.players.b, undefined);
});

test('join 은 이미 있는 사람을 덮어쓰지 않는다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  st.players.a.hold = 'low';
  st = S.join(st, 'a', 0);
  assert.strictEqual(st.players.a.hold, 'low', '들고 있던 게 사라지면 안 된다');
});

test('wait 기계는 시간이 지나면 저절로 익는다', () => {
  const w = sim(), S = w.Sim;
  const map = bench(w);
  map.stations.push({ id: 'u', type: 'uv', cx: 4 * w.World.TILE, cy: 1 * w.World.TILE });
  let st = S.create(map, ['a']);
  st.machines.u = { id: 'u', type: 'uv', item: 'low', prog: 0 };
  st = S.tick(st, {}, w.Stations.TYPES.uv.work + 0.1);
  assert.strictEqual(st.machines.u.item, 'uv');
});

test('벽을 통과하지 못한다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  for (let i = 0; i < 120; i++) st = S.tick(st, { a: { x: -1, y: 0, seq: 0 } }, 1 / 60);
  assert.ok(!w.World.blocked(st.map, st.players.a.x, st.players.a.y), '벽 안에 있으면 안 된다');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /c/Users/NAU/Desktop/Overworked && node --test test/sim.test.js`
Expected: FAIL — `ENOENT ... js/sim.js`

- [ ] **Step 3: 구현**

`js/sim.js`:

```js
/* ============================================================
   오버워크드 — 시뮬레이션 (호스트 전용, 유일한 권위)

   호스트 브라우저만 이걸 돌린다. 나머지는 결과를 받아 그리기만 한다.
   "이 물건을 누가 들었나"에 답이 하나뿐이어야 오버쿡드류가 성립한다.

   이 파일은 네트워크도 캔버스도 DOM 도 모른다. 순수 함수 덩어리라
   브라우저 없이 Node 로 전부 검증한다 — 8명 붙은 뒤에 규칙 버그를 찾으면
   누구 화면이 맞는지부터 다퉈야 한다.

   ── 액션이 하나뿐인 이유 ────────────────────────────────
   집기·놓기·작업을 키 하나로 몰았다. 키가 셋이면 처음 하는 사람이 뭘 눌러야
   할지 매번 생각해야 하는데, 이 게임에서 생각할 것은 "지금 뭘 해야 하나"지
   "무슨 키를 눌러야 하나"가 아니다. 상황이 곧 동작을 정한다.

   ── 손이 비어야만 두드릴 수 있는 이유 ───────────────────
   물건을 든 채로 두드릴 수 있으면 한 사람이 레퍼런스를 들고 모델링대 앞에
   서서 혼자 다 끝낸다. 손을 비워야만 두드릴 수 있어야 "놓고 → 두드리고 →
   집어서 → 옮긴다"가 되고, 그래야 여럿이 나눠 맡을 이유가 생긴다.
   ============================================================ */
(function (global) {
  'use strict';

  var SPEED = 210;        // 초당 디자인 픽셀. 1280 폭을 6초에 가로지른다.
  var REACH = 46;         // 기계에 손이 닿는 거리. 타일(40)보다 조금 커야 답답하지 않다.
  var MAX_ACTS = 8;       // 한 틱에 처리할 액션 상한 (네트워크가 밀렸을 때 폭주 방지)

  var W = null, St = null;
  function deps() {
    if (!W) W = global.World;
    if (!St) St = global.Stations;
  }

  function copyPlayers(src) {
    var o = {}, k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) {
      var p = src[k];
      o[k] = { x: p.x, y: p.y, dir: p.dir, hold: p.hold, tap: p.tap, seq: p.seq };
    }
    return o;
  }

  function copyMachines(src) {
    var o = {}, k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) {
      var m = src[k];
      o[k] = { id: m.id, type: m.type, item: m.item, prog: m.prog };
    }
    return o;
  }

  function create(map, pids) {
    deps();
    var st = {
      t: 0,
      map: map,
      players: {},
      machines: {},
      done: 0,
      goal: St.STAGE1_GOAL
    };
    for (var i = 0; i < map.stations.length; i++) {
      var s = map.stations[i];
      st.machines[s.id] = { id: s.id, type: s.type, item: null, prog: 0 };
    }
    for (var j = 0; j < (pids || []).length; j++) {
      st = join(st, pids[j], j);
    }
    return st;
  }

  function join(state, pid, spawnIndex) {
    deps();
    if (state.players[pid]) return state;          // 이미 있으면 들고 있던 걸 지키지 않는다
    var players = copyPlayers(state.players);
    var sp = state.map.spawns[spawnIndex % state.map.spawns.length] || { x: 100, y: 100 };
    players[pid] = { x: sp.x, y: sp.y, dir: 0, hold: null, tap: 0, seq: 0 };
    return {
      t: state.t, map: state.map, players: players,
      machines: state.machines, done: state.done, goal: state.goal
    };
  }

  function leave(state, pid) {
    var players = copyPlayers(state.players);
    /* 들고 있던 물건은 같이 사라진다. 바닥에 떨구게 하면 "바닥에 놓인 물건"이라는
       개념을 하나 더 만들어야 하는데, 나간 사람 때문에 규칙이 늘 이유가 없다. */
    delete players[pid];
    return {
      t: state.t, map: state.map, players: players,
      machines: state.machines, done: state.done, goal: state.goal
    };
  }

  /* 액션 한 번. state 를 그 자리에서 고친다 — tick 안에서 이미 복사한 뒤라 안전하다. */
  function doAction(state, pid) {
    deps();
    var p = state.players[pid];
    if (!p) return;

    var s = W.nearest(state.map, p.x, p.y, REACH);
    if (!s) return;
    var m = state.machines[s.id];
    if (!m) return;
    var d = St.get(m.type);
    if (!d) return;

    /* 1) 선반에서 새로 든다 */
    if (p.hold === null && d.mode === 'source') { p.hold = d.gives; return; }

    /* 2) 두드린다 — 집기보다 반드시 앞에 와야 한다.
       집기가 먼저면 모델링대에 레퍼런스를 놓고 두드리려 할 때마다 도로 집어
       들게 되어 작업이 영원히 안 된다. canAccept 로 "아직 처리할 수 있는
       물건"일 때만 걸리게 하면, 다 된 하이폴리는 자연히 아래 집기로 넘어간다. */
    if (p.hold === null && d.mode === 'tap' &&
        m.item !== null && St.canAccept(m.type, m.item)) {
      m.prog += 1;
      if (m.prog >= d.work) { m.item = d.gives; m.prog = 0; }
      return;
    }

    /* 3) 기계 위의 물건을 집는다 */
    if (p.hold === null && m.item !== null) {
      p.hold = m.item;
      m.item = null;
      m.prog = 0;
      return;
    }

    /* 4) 납품대·폐기통에 넣는다 */
    if (p.hold !== null && d.mode === 'sink') {
      if (m.type === 'ship' && p.hold === state.goal.need) state.done += 1;
      p.hold = null;
      return;
    }

    /* 5) 빈 기계에 놓는다 */
    if (p.hold !== null && m.item === null && St.canAccept(m.type, p.hold)) {
      m.item = p.hold;
      m.prog = 0;
      p.hold = null;
      return;
    }
  }

  function tick(state, inputs, dt) {
    deps();
    var players = copyPlayers(state.players);
    var machines = copyMachines(state.machines);
    var next = {
      t: state.t + dt, map: state.map, players: players,
      machines: machines, done: state.done, goal: state.goal
    };

    var pid;

    /* 이동 */
    for (pid in players) {
      if (!Object.prototype.hasOwnProperty.call(players, pid)) continue;
      var p = players[pid];
      var inp = (inputs && inputs[pid]) || null;
      var ix = inp ? (inp.x || 0) : 0;
      var iy = inp ? (inp.y || 0) : 0;

      if (ix || iy) {
        /* 대각선이 더 빠르면 다들 대각선으로만 다닌다. 길이를 1 로 맞춘다. */
        var len = Math.sqrt(ix * ix + iy * iy);
        var vx = (ix / len) * SPEED * dt;
        var vy = (iy / len) * SPEED * dt;
        var np = W.move(state.map, p.x, p.y, vx, vy);
        p.x = np.x; p.y = np.y;
        /* 보는 쪽은 더 크게 움직인 축으로 정한다 */
        if (Math.abs(ix) > Math.abs(iy)) p.dir = ix > 0 ? 2 : 1;
        else p.dir = iy > 0 ? 0 : 3;
      }
    }

    /* 액션 — seq 가 늘어난 만큼 처리한다.
       한 번만 처리하면 네트워크가 밀렸을 때 연타가 씹힌다. */
    for (pid in players) {
      if (!Object.prototype.hasOwnProperty.call(players, pid)) continue;
      var inp2 = (inputs && inputs[pid]) || null;
      if (!inp2) continue;
      var want = inp2.seq || 0;
      var have = players[pid].seq || 0;
      var n = want - have;
      if (n <= 0) { players[pid].seq = want; continue; }   // 되감기(재입장 등)도 맞춰 준다
      if (n > MAX_ACTS) n = MAX_ACTS;
      for (var k = 0; k < n; k++) doAction(next, pid);
      players[pid].seq = have + n;
      players[pid].tap = next.t;                            // 그리는 쪽이 "방금 두드렸다"를 안다
    }

    /* 대기형 기계 굴리기 */
    for (var id in machines) {
      if (!Object.prototype.hasOwnProperty.call(machines, id)) continue;
      machines[id] = St.step(machines[id], dt);
    }

    return next;
  }

  global.Sim = {
    SPEED: SPEED,
    REACH: REACH,
    MAX_ACTS: MAX_ACTS,
    create: create,
    join: join,
    leave: leave,
    tick: tick
  };
})(window);
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd /c/Users/NAU/Desktop/Overworked && node --test test/sim.test.js`
Expected: PASS — `20 pass, 0 fail`

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/NAU/Desktop/Overworked
git add js/sim.js test/sim.test.js
git commit -m "$(printf '%s\n' '시뮬레이션: 호스트만 돌리는 유일한 권위' '' '네트워크도 캔버스도 DOM 도 모르는 순수 함수 덩어리라, 브라우저 없이 Node 로' '전부 검증한다. 8명 붙은 뒤에 규칙 버그를 찾으면 누구 화면이 맞는지부터' '다퉈야 한다.' '' '집기/놓기/작업을 키 하나로 몰았다. 이 게임에서 생각할 것은 "지금 뭘 해야' '하나"지 "무슨 키를 눌러야 하나"가 아니다. 상황이 곧 동작을 정한다.' '' '손이 비어야만 두드릴 수 있게 했다. 물건을 든 채로 두드리면 한 사람이' '레퍼런스를 들고 모델링대 앞에서 혼자 다 끝낸다. 그러면 협동 게임이 아니다.' '' 'seq 가 늘어난 만큼 액션을 처리한다 — 한 번만 처리하면 네트워크가 밀렸을 때' '연타가 씹힌다. 대신 한 틱 상한을 둬서 폭주는 막는다.' '' 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---
### Task 8: 스냅샷 직렬화

호스트가 10Hz로 올리는 상태 꾸러미. **전송량이 이 파일에서 결정된다.**

키를 한 글자로 줄이고 좌표를 정수로 반올림하는 게 인색해 보이지만, 이건
8명이 4분간 주고받는 양에 그대로 곱해진다. 소수점 좌표는 눈에 안 보이면서
글자 수만 두 배로 만든다.

**Files:**
- Create: `js/snap.js`
- Create: `test/snap.test.js`

**Interfaces:**
- Consumes: `window.Sim` (Task 7), `window.Stations` (Task 6)
- Produces:
  - `window.Snap.pack(state)` → `{ t, d, p, m }`
    - `t`: 틱 번호 (정수). 호스트가 살아 있는지 판단하는 근거이기도 하다
    - `d`: 납품 개수
    - `p`: `{<pid>: [x, y, dir, holdIdx]}` — 좌표는 정수, `holdIdx`는 아래 `ITEMS` 색인 (`-1`=빈손)
    - `m`: `{<id>: [itemIdx, prog]}` — `prog`는 소수 둘째 자리까지
  - `window.Snap.unpack(packed, map)` → Sim 이 쓰는 모양의 상태 (`map`, `goal` 은 인자로 받아 채운다)
  - `window.Snap.ITEMS` → `['ref','high','low','uv','tex','rig','done','burnt']`
  - `window.Snap.bytes(packed)` → JSON 으로 만들었을 때 길이 (예산 실측용)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/snap.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function all() { return load(['world', 'stations', 'sim', 'snap']); }

function bench(w) {
  const T = w.World.TILE;
  return {
    cols: 10, rows: 5,
    grid: ('##########' + '#SS....SS#' + '#........#' + '#SS....SS#' + '##########').split(''),
    spawns: [{ x: 5 * T, y: 2 * T }, { x: 4 * T, y: 2 * T }],
    stations: [
      { id: 'r', type: 'ref',    cx: 1 * T + T / 2, cy: 1 * T + T / 2 },
      { id: 'm', type: 'model',  cx: 7 * T + T / 2, cy: 1 * T + T / 2 },
      { id: 's', type: 'ship',   cx: 7 * T + T / 2, cy: 3 * T + T / 2 }
    ]
  };
}

test('ITEMS 에 모든 물건 상태가 있다', () => {
  const I = all().Snap.ITEMS;
  for (const s of ['ref', 'high', 'low', 'uv', 'tex', 'rig', 'done', 'burnt']) {
    assert.ok(I.indexOf(s) >= 0, s + ' 가 빠졌다');
  }
  assert.strictEqual(new Set(I).size, I.length, '중복이 있다');
});

test('pack 은 좌표를 정수로 만든다', () => {
  const w = all(), S = w.Sim, P = w.Snap;
  let st = S.create(bench(w), ['a']);
  st.players.a.x = 123.456;
  st.players.a.y = 78.912;
  const k = P.pack(st);
  assert.strictEqual(k.p.a[0], 123);
  assert.strictEqual(k.p.a[1], 79);
});

test('pack 은 빈손을 -1 로 적는다', () => {
  const w = all(), P = w.Snap;
  let st = w.Sim.create(bench(w), ['a']);
  assert.strictEqual(P.pack(st).p.a[3], -1);
});

test('pack 은 들고 있는 물건을 색인으로 적는다', () => {
  const w = all(), P = w.Snap;
  let st = w.Sim.create(bench(w), ['a']);
  st.players.a.hold = 'high';
  assert.strictEqual(P.pack(st).p.a[3], P.ITEMS.indexOf('high'));
});

test('pack 은 t 를 정수 틱으로 적는다', () => {
  const w = all(), P = w.Snap;
  let st = w.Sim.create(bench(w), ['a']);
  st.t = 12.7;
  const k = P.pack(st);
  assert.strictEqual(typeof k.t, 'number');
  assert.strictEqual(k.t, Math.round(k.t), 't 는 정수여야 한다');
});

test('pack → unpack 이 뜻을 지킨다', () => {
  const w = all(), S = w.Sim, P = w.Snap;
  const map = bench(w);
  let st = S.create(map, ['a', 'b']);
  st.players.a.x = 200; st.players.a.y = 100; st.players.a.dir = 2; st.players.a.hold = 'ref';
  st.players.b.x = 300; st.players.b.y = 150; st.players.b.dir = 1;
  st.machines.m = { id: 'm', type: 'model', item: 'ref', prog: 3 };
  st.done = 2;

  const back = P.unpack(P.pack(st), map);
  assert.strictEqual(back.players.a.x, 200);
  assert.strictEqual(back.players.a.dir, 2);
  assert.strictEqual(back.players.a.hold, 'ref');
  assert.strictEqual(back.players.b.hold, null);
  assert.strictEqual(back.machines.m.item, 'ref');
  assert.strictEqual(back.machines.m.prog, 3);
  assert.strictEqual(back.done, 2);
  assert.strictEqual(back.map, map);
});

test('unpack 은 빈 기계를 null 로 되돌린다', () => {
  const w = all(), P = w.Snap;
  const map = bench(w);
  const st = w.Sim.create(map, ['a']);
  const back = P.unpack(P.pack(st), map);
  assert.strictEqual(back.machines.m.item, null);
});

test('unpack 은 맵에 없는 기계를 무시한다', () => {
  const w = all(), P = w.Snap;
  const map = bench(w);
  const k = P.pack(w.Sim.create(map, ['a']));
  k.m.유령 = [0, 0];
  const back = P.unpack(k, map);
  assert.strictEqual(back.machines.유령, undefined, '맵에 없는 기계가 생기면 안 된다');
});

test('unpack 은 망가진 꾸러미에도 안 죽는다', () => {
  const w = all(), P = w.Snap;
  const map = bench(w);
  for (const bad of [null, undefined, {}, { t: 1 }, { p: null, m: null }, 'x', 5]) {
    const back = P.unpack(bad, map);
    assert.ok(back && back.players && back.machines, '꾸러미: ' + JSON.stringify(bad));
  }
});

test('prog 는 소수 둘째 자리까지만 실린다', () => {
  const w = all(), P = w.Snap;
  const map = bench(w);
  let st = w.Sim.create(map, ['a']);
  st.machines.m = { id: 'm', type: 'model', item: 'ref', prog: 0.123456789 };
  const k = P.pack(st);
  assert.strictEqual(k.m.m[1], 0.12);
});

test('8명 스냅샷이 예산 안에 든다', () => {
  const w = all(), S = w.Sim, P = w.Snap;
  const map = w.World.STAGE1;
  const pids = ['p1','p2','p3','p4','p5','p6','p7','p8'];
  let st = S.create(map, pids);
  for (const id of pids) {
    st.players[id].x = 1234.5678;
    st.players[id].y = 678.1234;
    st.players[id].hold = 'high';
  }
  for (const id in st.machines) st.machines[id] = { id, type: st.machines[id].type, item: 'ref', prog: 0.55 };

  const n = P.bytes(P.pack(st));
  console.log('   8명 스냅샷 크기:', n, 'bytes');
  assert.ok(n < 900, '스냅샷이 900바이트를 넘으면 예산(13MB/판)을 넘긴다: ' + n);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /c/Users/NAU/Desktop/Overworked && node --test test/snap.test.js`
Expected: FAIL — `ENOENT ... js/snap.js`

- [ ] **Step 3: 구현**

`js/snap.js`:

```js
/* ============================================================
   오버워크드 — 스냅샷 직렬화

   호스트가 10Hz 로 올리는 상태 꾸러미. 전송량이 이 파일에서 결정된다.

   키를 한 글자로 줄이고 좌표를 반올림하는 게 인색해 보이지만, 이 크기는
   8명 × 10Hz × 240초에 그대로 곱해진다. 소수점 좌표는 눈에 보이지도 않으면서
   글자 수만 두 배로 만든다. 물건 이름도 색인으로 바꾼다 — 'burnt' 다섯 글자를
   기계마다 매초 열 번씩 보낼 이유가 없다.

   ── 왜 항상 전체를 보내는가 ────────────────────────────
   푸시가 12번에 한 번쯤 누락된다. 델타를 보내면 그 한 번을 놓치는 순간
   영원히 어긋난 채로 남는다. 전체를 보내면 다음 프레임이 알아서 고쳐 준다.

   ── t 가 두 가지 일을 한다 ──────────────────────────────
   화면 보간의 기준이면서, 호스트가 살아 있는지 판단하는 근거이기도 하다.
   이 값이 3초간 안 늘면 호스트가 죽은 것으로 본다(Task 9).
   ============================================================ */
(function (global) {
  'use strict';

  /* 색인 순서를 바꾸면 예전 꾸러미를 잘못 읽는다. 뒤에만 붙일 것. */
  var ITEMS = ['ref', 'high', 'low', 'uv', 'tex', 'rig', 'done', 'burnt'];

  function itemIdx(s) {
    if (s === null || s === undefined) return -1;
    var i = ITEMS.indexOf(s);
    return i;                                     // 모르는 값도 -1 로 떨어진다
  }

  function itemOf(i) {
    return (i >= 0 && i < ITEMS.length) ? ITEMS[i] : null;
  }

  function round2(v) {
    return Math.round((v || 0) * 100) / 100;
  }

  function pack(state) {
    var p = {}, m = {}, k;

    for (k in state.players) {
      if (!Object.prototype.hasOwnProperty.call(state.players, k)) continue;
      var pl = state.players[k];
      p[k] = [Math.round(pl.x), Math.round(pl.y), pl.dir | 0, itemIdx(pl.hold)];
    }

    for (k in state.machines) {
      if (!Object.prototype.hasOwnProperty.call(state.machines, k)) continue;
      var mc = state.machines[k];
      m[k] = [itemIdx(mc.item), round2(mc.prog)];
    }

    return {
      t: Math.round(state.t * 10),                // 0.1초 단위 틱. 정수라 짧다.
      d: state.done | 0,
      p: p,
      m: m
    };
  }

  function unpack(packed, map) {
    var out = {
      t: 0, map: map, players: {}, machines: {}, done: 0,
      goal: (global.Stations && global.Stations.STAGE1_GOAL) || { need: 'low', count: 6 }
    };
    if (!packed || typeof packed !== 'object') return out;

    out.t = (packed.t || 0) / 10;
    out.done = packed.d | 0;

    var p = packed.p, k;
    if (p && typeof p === 'object') {
      for (k in p) {
        if (!Object.prototype.hasOwnProperty.call(p, k)) continue;
        var a = p[k];
        if (!a || a.length < 4) continue;
        out.players[k] = {
          x: a[0], y: a[1], dir: a[2] | 0, hold: itemOf(a[3]), tap: 0, seq: 0
        };
      }
    }

    /* 기계는 맵을 기준으로 세운다. 꾸러미에 없는 기계는 빈 채로 두고,
       맵에 없는 기계는 버린다 — 스테이지가 바뀌는 순간의 엇갈림을 여기서 흡수한다. */
    var st = (map && map.stations) || [];
    for (var i = 0; i < st.length; i++) {
      var s = st[i];
      var row = (packed.m && packed.m[s.id]) || null;
      out.machines[s.id] = {
        id: s.id, type: s.type,
        item: row ? itemOf(row[0]) : null,
        prog: row ? (row[1] || 0) : 0
      };
    }

    return out;
  }

  function bytes(packed) {
    return JSON.stringify(packed).length;
  }

  global.Snap = {
    ITEMS: ITEMS,
    pack: pack,
    unpack: unpack,
    bytes: bytes
  };
})(window);
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd /c/Users/NAU/Desktop/Overworked && node --test test/snap.test.js`
Expected: PASS — `11 pass, 0 fail`. 출력에 실제 스냅샷 크기가 찍힌다.

- [ ] **Step 5: 실제 전송량을 계산해서 기록한다**

```bash
cd /c/Users/NAU/Desktop/Overworked && node -e "
const {load}=require('./testlib/load');
const w=load(['world','stations','sim','snap']);
const pids=[1,2,3,4,5,6,7,8].map(i=>'p'+i);
let st=w.Sim.create(w.World.STAGE1,pids);
for(const id of pids){ st.players[id].x=1234.5; st.players[id].y=678.9; st.players[id].hold='high'; }
for(const id in st.machines) st.machines[id]={id,type:st.machines[id].type,item:'ref',prog:0.55};
const n=w.Snap.bytes(w.Snap.pack(st));
const HZ=10, SEC=240, N=8;
console.log('스냅샷', n, 'bytes');
console.log('호스트 업로드', (n*HZ/1024).toFixed(1), 'KB/s');
console.log('한 판(4분) 전체 다운로드', (n*HZ*SEC*N/1024/1024).toFixed(1), 'MB');
console.log('월 10GB 로 가능한 판 수', Math.floor(10*1024*1024*1024/(n*HZ*SEC*N)));
"
```

이 숫자를 스펙 3.5 절의 계산값과 대조해서, 차이가 크면 스펙을 실측값으로 고친다.
판당 20MB 를 넘으면 스냅샷 주기를 10Hz → 7Hz 로 낮춘다.

- [ ] **Step 6: 커밋**

```bash
cd /c/Users/NAU/Desktop/Overworked
git add js/snap.js test/snap.test.js
git commit -m "$(printf '%s\n' '스냅샷: 전송량이 여기서 결정된다' '' '키를 한 글자로 줄이고 좌표를 정수로 반올림했다. 인색해 보이지만 이 크기는' '8명 x 10Hz x 240초에 그대로 곱해진다. 소수점 좌표는 눈에 보이지도 않으면서' '글자 수만 두 배로 만든다.' '' '항상 전체를 보낸다. 푸시가 12번에 한 번쯤 누락되는데, 델타면 그 한 번을' '놓치는 순간 영원히 어긋난 채로 남는다. 전체면 다음 프레임이 고쳐 준다.' '' 'unpack 은 맵을 기준으로 기계를 세운다. 꾸러미에 없으면 빈 채로, 맵에 없으면' '버린다 — 스테이지가 바뀌는 순간의 엇갈림을 여기서 흡수한다.' '' 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---
