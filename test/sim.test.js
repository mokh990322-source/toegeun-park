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
  /* 예전 버전은 item==='high'(work=6번이면 완성) 이거나 prog<=20 이면 통과했는데,
     둘 다 MAX_ACTS(8)든 100000이든 참이라 클램프를 실제로는 검증하지 못했다.
     클램프의 증거는 "처리한 seq 가 정확히 MAX_ACTS 만큼만 늘었다"는 것뿐이다. */
  st = S.tick(st, { a: { x: 0, y: 0, seq: 100000 } }, 1 / 60);
  /* 리터럴 8 로 못박는다. S.MAX_ACTS 로 비교하면 상수를 바꿔도 기대값이 같이
     따라가서 "클램프가 있다"만 잡고 "얼마인가"는 못 잡는다. */
  assert.strictEqual(st.players.a.seq, 8,
    '한 틱에 8개를 넘겨 처리하면 안 된다 (요청 seq 는 100000)');
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

/* M6: join/leave 도 tick 과 같이 machines 를 복사해야 "원본을 고치지
   않는다"는 계약이 세 함수 모두에서 일관되게 성립한다. */
test('join 은 machines 를 복사한다 — 새 state 의 기계를 고쳐도 원본이 안 바뀐다', () => {
  const w = sim(), S = w.Sim;
  const st = S.create(bench(w), ['a']);
  const st2 = S.join(st, 'b', 1);
  st2.machines.m.item = 'burnt';
  assert.strictEqual(st.machines.m.item, null, 'join 이 machines 를 참조로 넘기면 원본까지 바뀐다');
});

test('leave 는 machines 를 복사한다 — 새 state 의 기계를 고쳐도 원본이 안 바뀐다', () => {
  const w = sim(), S = w.Sim;
  const st = S.create(bench(w), ['a', 'b']);
  const st2 = S.leave(st, 'b');
  st2.machines.m.item = 'burnt';
  assert.strictEqual(st.machines.m.item, null, 'leave 가 machines 를 참조로 넘기면 원본까지 바뀐다');
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

/* ========== C1: 호스트 승계 시 과거 액션이 재생되면 안 된다 ==========
   Snap.pack/unpack 은 seq 를 담지 않는다(전송량 때문에 의도적으로 뺐다).
   그래서 승계한 새 호스트가 그대로 tick 을 돌리면 각 플레이어의 지금까지
   입력 전체를 "새 액션"으로 오인해 재생해 버린다 — 이게 리뷰에서 발견된
   치명적 버그다. world+stations+sim+snap 을 실제로 엮어야만 잡히는
   버그라서, 단위별로는 다 통과하던 지난 리뷰 11번이 놓쳤다. */
test('호스트 승계 후 같은 입력으로 틱해도 과거 액션이 재생되지 않는다 (Sim.adopt, C1)', () => {
  const w = load(['world', 'stations', 'sim', 'snap']);
  const S = w.Sim, P = w.Snap;
  const map = bench(w);
  let st = S.create(map, ['a']);
  st.machines.m.item = 'ref';                 // 모델링 재료를 미리 올려 둔다
  stand(st, 'a', 'm', S);

  const work = w.Stations.TYPES.model.work;   // 6
  let seq = 0;
  const inp = { a: { x: 0, y: 0, seq: 0 } };
  for (let i = 0; i < work - 1; i++) {         // 완성 한 걸음 전까지만 두드린다
    seq += 1;
    inp.a.seq = seq;
    st = S.tick(st, inp, 1 / 60);
  }
  assert.strictEqual(st.machines.m.prog, work - 1, '준비: 완성 직전이어야 한다');
  assert.strictEqual(st.machines.m.item, 'ref', '준비: 아직 완성되면 안 된다');

  /* 스냅샷 왕복 — 새 호스트가 이 상태를 이어받는다 */
  let adopted = P.unpack(P.pack(st), map);
  assert.strictEqual(adopted.players.a.seq, 0, '전제 확인: 스냅샷에는 seq 가 없다');

  adopted = S.adopt(adopted, inp);
  assert.strictEqual(adopted.players.a.seq, seq, 'adopt 는 각 플레이어 seq 를 그 사람 현재 입력값으로 맞춘다');

  /* 같은 입력으로 틱 — adopt 가 없었다면 seq(=work-1)만큼 재생돼 기계가 완성돼 버린다 */
  const after = S.tick(adopted, inp, 1 / 60);
  assert.strictEqual(after.machines.m.prog, work - 1, '재생으로 진행도가 더 올라가면 안 된다');
  assert.strictEqual(after.machines.m.item, 'ref', '재생으로 완성되면 안 된다');
  assert.strictEqual(after.players.a.hold, null, '재생으로 손에 뭔가 들리면 안 된다');
  assert.strictEqual(after.done, 0, '재생으로 점수가 오르면 안 된다');

  /* 진짜 새 액션(seq+1)은 여전히 먹혀야 한다 — adopt 가 입력을 먹통으로 만들면 안 된다 */
  seq += 1;
  const inp2 = { a: { x: 0, y: 0, seq: seq } };
  const after2 = S.tick(after, inp2, 1 / 60);
  assert.strictEqual(after2.machines.m.item, 'high', '새 액션 한 번이면 완성돼야 한다');
  assert.strictEqual(after2.machines.m.prog, 0);
});

test('adopt 는 입력이 없는 플레이어의 seq 를 0 으로 둔다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  st.players.a.seq = 0;
  const adopted = S.adopt(st, {});             // 그 플레이어의 입력이 아직 안 왔다
  assert.strictEqual(adopted.players.a.seq, 0);
});

test('adopt 는 원본 상태와 입력을 고치지 않는다', () => {
  const w = sim(), S = w.Sim;
  const st = S.create(bench(w), ['a']);
  const inp = { a: { x: 0, y: 0, seq: 9 } };
  const inpCopy = JSON.parse(JSON.stringify(inp));
  S.adopt(st, inp);
  assert.strictEqual(st.players.a.seq, 0, '원본 state 는 그대로여야 한다');
  assert.deepStrictEqual(inp, inpCopy, '입력도 그대로여야 한다');
});

test('벽을 통과하지 못한다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a']);
  for (let i = 0; i < 120; i++) st = S.tick(st, { a: { x: -1, y: 0, seq: 0 } }, 1 / 60);
  assert.ok(!w.World.blocked(st.map, st.players.a.x, st.players.a.y), '벽 안에 있으면 안 된다');
});

/* ========== 플레이어끼리 겹침 해소 ==========
   벽이 없는 널찍한 방을 쓴다 — 벽 쪽 밀림은 따로(아래) 시험하고, 여기서는
   순수하게 "겹치면 떨어진다"만 본다. */
function openRoom(w, cols, rows) {
  const T = w.World.TILE;
  const rows2 = [];
  rows2.push('#'.repeat(cols));
  for (let r = 1; r < rows - 1; r++) rows2.push('#' + '.'.repeat(cols - 2) + '#');
  rows2.push('#'.repeat(cols));
  return {
    cols, rows, grid: rows2.join('').split(''),
    spawns: [{ x: T * 2, y: T * 2 }],
    stations: []
  };
}

/* players 를 다른 삽입 순서로 다시 만든다 — 내용은 같되 for-in/키 순서만 다르다. */
function reorderPlayers(players, order) {
  const o = {};
  for (const pid of order) o[pid] = Object.assign({}, players[pid]);
  return o;
}

/* 키 순서에 안 좌우되는 비교용 직렬화 — pid 를 정렬해서 문자열로 만든다.
   copyPlayers 는 입력 순서를 그대로 물려주므로, players 오브젝트 자체의
   키 순서까지 같으라고 요구하면 "충돌 해소가 결정적이다"와 무관한 것까지
   시험하게 된다. 알맹이(각 필드 값)가 재현 가능한지만 본다. */
function canon(state) {
  const players = {};
  for (const pid of Object.keys(state.players).sort()) players[pid] = state.players[pid];
  const machines = {};
  for (const id of Object.keys(state.machines).sort()) machines[id] = state.machines[id];
  return JSON.stringify({ t: state.t, players, machines, done: state.done });
}

test('겹쳐 있던 둘은 한 틱 뒤 2R 이상 떨어지고 둘 다 바닥 위에 있다', () => {
  const w = sim(), S = w.Sim, R = w.World.R;
  let st = S.create(openRoom(w, 20, 12), ['a', 'b']);
  st.players.a.x = st.players.b.x = 300;
  st.players.a.y = st.players.b.y = 300;

  st = S.tick(st, {}, 1 / 60);

  const dx = st.players.a.x - st.players.b.x, dy = st.players.a.y - st.players.b.y;
  const dist = Math.hypot(dx, dy);
  assert.ok(dist >= 2 * R - 1e-9, '겹쳐 있던 둘은 최소 2R 만큼 떨어져야 한다: ' + dist);
  assert.ok(!w.World.blocked(st.map, st.players.a.x, st.players.a.y), 'a 는 바닥 위여야 한다');
  assert.ok(!w.World.blocked(st.map, st.players.b.x, st.players.b.y), 'b 는 바닥 위여야 한다');
});

test('마주 걸어오면 통과하지 않고 겹치지도 않는다', () => {
  const w = sim(), S = w.Sim, R = w.World.R;
  let st = S.create(openRoom(w, 20, 12), ['a', 'b']);
  st.players.a.x = 200; st.players.a.y = 300;
  st.players.b.x = 400; st.players.b.y = 300;

  const inp = { a: { x: 1, y: 0, seq: 0 }, b: { x: -1, y: 0, seq: 0 } };
  for (let i = 0; i < 90; i++) {
    st = S.tick(st, inp, 1 / 60);
    const dist = Math.hypot(st.players.a.x - st.players.b.x, st.players.a.y - st.players.b.y);
    assert.ok(dist >= 2 * R - 1e-6, '어느 틱에서도 겹치면 안 된다 (t=' + st.t.toFixed(3) + '): ' + dist);
    assert.ok(st.players.a.x < st.players.b.x, 'a 가 b 를 뚫고 지나가면 안 된다');
  }
});

test('벽과 다른 플레이어 사이에 낀 사람은 벽 속으로 밀리지 않는다', () => {
  const w = sim(), S = w.Sim, R = w.World.R, T = w.World.TILE;
  let st = S.create(openRoom(w, 20, 12), ['a', 'b']);
  /* a 는 왼쪽 벽에 거의 붙어 선다 — blocked() 가 x-R 를 보므로 이보다 왼쪽이면
     벌써 벽 안이다. */
  st.players.a.x = T + R; st.players.a.y = 300;
  st.players.b.x = st.players.a.x + 2 * R; st.players.b.y = 300;

  /* b 가 a 를 벽 쪽으로 계속 떠민다. a 가 갈 곳이 없으니 매 틱 겹침이 남을
     수 있지만, 그렇다고 벽 안으로 들어가서는 안 된다. */
  const inp = { b: { x: -1, y: 0, seq: 0 } };
  for (let i = 0; i < 60; i++) {
    st = S.tick(st, inp, 1 / 60);
    assert.ok(!w.World.blocked(st.map, st.players.a.x, st.players.a.y),
      'a 가 벽 속으로 밀리면 안 된다 (t=' + st.t.toFixed(3) + ')');
    assert.ok(!w.World.blocked(st.map, st.players.b.x, st.players.b.y),
      'b 도 벽 속에 있으면 안 된다 (t=' + st.t.toFixed(3) + ')');
  }
});

test('8명이 한곳에 뭉쳐도 몇 틱 안에 다 떨어지고 아무도 벽 속에 없다', () => {
  const w = sim(), S = w.Sim, R = w.World.R;
  const pids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  let st = S.create(openRoom(w, 24, 16), pids);
  for (const pid of pids) { st.players[pid].x = 400; st.players[pid].y = 400; }

  /* 8명 전원이 정확히 같은 점에 뭉친 최악의 경우다. 쌍마다 절반씩 미는
     방식은 여러 쌍이 동시에 얽혀 있으면 기하급수적으로만 수렴한다 —
     한 쌍을 떼면 다른 쌍이 살짝 다시 겹치기 때문이다(스펙이 "수렴할
     때까지 돌지 않는다"고 명시한 이유). 그래서 20틱을 돌리고, 남는
     잔여 겹침은 서브픽셀(허용치 0.05px)로만 확인한다 — "눈에 보이게
     떨어졌는가"를 보는 시험이지 "수학적으로 정확히 2R인가"를 보는
     시험이 아니다. */
  for (let i = 0; i < 20; i++) st = S.tick(st, {}, 1 / 60);

  for (const pid of pids) {
    assert.ok(!w.World.blocked(st.map, st.players[pid].x, st.players[pid].y),
      pid + ' 가 벽 속에 있으면 안 된다');
  }
  for (let i = 0; i < pids.length; i++) {
    for (let j = i + 1; j < pids.length; j++) {
      const a = st.players[pids[i]], b = st.players[pids[j]];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(dist >= 2 * R - 0.05,
        pids[i] + '-' + pids[j] + ' 가 아직 겹쳐 있다: ' + dist);
    }
  }
});

test('멀리 떨어진 둘은 충돌 해소가 없던 것처럼 정확히 같은 자리로 움직인다', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(openRoom(w, 20, 12), ['a', 'b']);
  st.players.a.x = 200; st.players.a.y = 300;
  st.players.b.x = 900; st.players.b.y = 300;   // 2R 보다 한참 멀다 — 절대 안 겹친다

  st = S.tick(st, { a: { x: 1, y: 0, seq: 0 } }, 0.5);

  /* 벽도 없고 상대도 멀어서 순수 이동 공식(SPEED*dt)과 정확히 같아야 한다. */
  assert.strictEqual(st.players.a.x, 200 + w.Sim.SPEED * 0.5);
  assert.strictEqual(st.players.a.y, 300);
  assert.strictEqual(st.players.b.x, 900, '입력 없는 b 는 충돌 때문에도 움직이면 안 된다');
  assert.strictEqual(st.players.b.y, 300);
});

test('결정적이다 — 같은 시작 상태면 players 오브젝트의 키 삽입 순서가 달라도 결과가 같다', () => {
  const w = sim(), S = w.Sim;
  const pids = ['a', 'b', 'c', 'd'];
  let base = S.create(openRoom(w, 20, 12), pids);
  /* 뭉쳐 두어야 충돌 해소 로직이 실제로 순서에 관여할 기회가 생긴다 */
  for (const pid of pids) { base.players[pid].x = 300; base.players[pid].y = 300; }

  const inp = { a: { x: 1, y: 0.3, seq: 1 }, c: { x: -1, y: 0, seq: 1 } };

  let st1 = base;
  let st2 = Object.assign({}, base, { players: reorderPlayers(base.players, ['d', 'b', 'a', 'c']) });

  for (let i = 0; i < 5; i++) {
    st1 = S.tick(st1, inp, 1 / 60);
    st2 = S.tick(st2, inp, 1 / 60);
    assert.strictEqual(canon(st1), canon(st2), '틱 ' + i + ' 에서 결과가 갈렸다');
  }
});

test('옆에 다른 사람이 있어도 기계 작업은 그대로 된다 (충돌 해소가 REACH 밖으로 밀어내지 않는다)', () => {
  const w = sim(), S = w.Sim;
  let st = S.create(bench(w), ['a', 'b']);
  stand(st, 'a', 'r', S);                        // a: 선반 옆, source 모드라 바로 든다
  /* b 를 a 와 겹치도록 바짝 붙여 세운다 — 충돌 해소가 매 틱 개입할 수밖에 없다 */
  st.players.b.x = st.players.a.x + 5;
  st.players.b.y = st.players.a.y;

  st = S.tick(st, { a: { x: 0, y: 0, seq: 1 } }, 1 / 60);

  assert.strictEqual(st.players.a.hold, 'ref', '옆에 b 가 있어도 a 는 선반에서 집을 수 있어야 한다');
});
