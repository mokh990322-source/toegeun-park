'use strict';
/* 판이 정말 깨지는지 검사한다.

   판을 눈으로 읽어서는 못 판단한다. 실제로 스폰이 발판 밖에 있거나,
   컨베이어를 발밑이 아니라 몸통 자리에 놓았거나, 출입구가 점프 한 번보다
   높은 자리에 있는 사고가 났었다. 셋 다 격자만 보면 멀쩡해 보인다.

   ── 무엇을 하는가 ───────────────────────────────────────
   "설 수 있는 자리"를 점으로 보고, 걷기와 진짜 점프 포물선으로 이어 붙여
   출입구까지 닿는지 본다. 판정은 전부 Grid 의 실제 충돌 코드를 쓴다 —
   여기서 타일 규칙을 다시 구현하면 게임과 다른 판을 검사하게 된다.

   ── 어디까지 정확한가 ───────────────────────────────────
   증명이 아니라 그물이다. 시간에 얽힌 것은 느슨하게 본다:
     깜빡이는 가시  기다리면 지나갈 수 있으니 위험으로 안 센다
     부서지는 발판  건널 수 있다고 보고 딱딱하게 센다
     움직이는 발판  왕복 구간 전체를 "설 수 있는 자리"로 본다
   고정 가시와 벽은 그대로 막는다. 그래서 "통과했으니 반드시 깬다"는 아니고,
   "막혔으니 반드시 못 깬다"는 맞다. 그물로는 그게 맞는 방향이다.

   ── 문은 두 걸음으로 본다 ───────────────────────────────
   먼저 문이 닫힌 채로 어디까지 가는지 본다. 그 안에 버튼이 needs 개만큼
   있으면, 문을 연 채로 다시 넓힌다. 버튼에 못 닿으면 문 너머는 영영 못 간다.
*/

const { load } = require('./load');

function W() { return load(['tiles', 'grid', 'levels', 'sim']); }

const STEP = 8;         // 서 있는 자리를 이만큼 간격으로 본다

function hardHazard(w, lv, x, y) {
  const G = w.Grid, T = w.Tiles;
  const m = 6, e = 0.001;
  const x0 = Math.floor((x + m) / G.TILE), x1 = Math.floor((x + G.PW - m - e) / G.TILE);
  const y0 = Math.floor((y + m) / G.TILE), y1 = Math.floor((y + G.PH - m - e) / G.TILE);
  for (let cy = y0; cy <= y1; cy++) {
    if (cy < 0 || cy >= G.ROWS) continue;
    for (let cx = x0; cx <= x1; cx++) {
      if (cx < 0 || cx >= G.COLS) continue;
      if (lv.grid[cy * G.COLS + cx] === T.SPIKE) return true;
    }
  }
  return false;
}

function canStand(w, lv, x, y, env) {
  const G = w.Grid;
  if (G.hits(lv, x, y, env)) return false;
  if (hardHazard(w, lv, x, y)) return false;
  return G.moveY(lv, x, y, 2, env).hit;
}

/* 발밑에 닿을 때까지 떨어뜨린다. 못 서면 null */
function settle(w, lv, x, y, env) {
  const G = w.Grid;
  if (G.hits(lv, x, y, env)) return null;
  let cur = y;
  for (let i = 0; i < 240; i++) {
    const r = G.moveY(lv, x, cur, 8, env);
    if (r.hit) { cur = r.y; break; }
    cur = r.y;
    if (cur > G.H + 40) return null;
  }
  return canStand(w, lv, x, cur, env) ? cur : null;
}

function key(x, y) { return Math.round(x / STEP) + ',' + Math.round(y / STEP); }

/* 진짜 점프 포물선을 그려 착지할 수 있는 자리를 모은다.
   조작은 왼쪽/제자리/오른쪽 셋으로 본다 — 공중에서 방향을 바꾸는 것까지
   세면 경우가 폭발하는데, 그렇게까지 해야 닿는 자리는 판으로서 나쁘다. */
function jumpLandings(w, lv, x, y, env, out, v0) {
  const G = w.Grid, S = w.Sim;
  const DT = 1 / 60;
  const up = v0 || S.JUMP_V;
  /* 방향을 언제 트느냐까지 본다. 발판 바로 옆에서는 그대로 밀면 옆구리를
     들이받아서, 다 올라간 다음에 트는 것이 유일한 길이다 — 봇도 그렇게 뛴다.
     이걸 안 보면 목마 같은 판이 "고장났다"로 잘못 보고된다. */
  const plans = [[0, 0]];
  for (const dir of [-1, 1]) for (const delay of [0, 14, 24]) plans.push([dir, delay]);

  for (const [dir, delay] of plans) {
    let px = x, py = y, vy = -up;
    for (let f = 0; f < 100; f++) {
      vy += S.GRAVITY * DT;
      if (vy > S.MAX_FALL) vy = S.MAX_FALL;
      const step = (f < delay) ? 0 : dir;
      px = G.moveX(lv, px, py, step * S.SPEED * DT, env).x;
      const ry = G.moveY(lv, px, py, vy * DT, env);
      const landed = ry.hit && vy > 0;
      py = ry.y;
      if (ry.hit) {
        if (landed) {
          if (!hardHazard(w, lv, px, py)) out.push([px, py]);
          break;
        }
        vy = 0;                      // 천장에 머리를 박았다
      }
      if (py > G.H + 40) break;
    }
  }
}

function walkNeighbours(w, lv, x, y, env, out) {
  const G = w.Grid;
  for (const dir of [-1, 1]) {
    let px = x, py = y;
    for (let s = 0; s < 60; s++) {
      const r = G.moveX(lv, px, py, dir * STEP, env);
      if (Math.abs(r.x - px) < 0.5) break;      // 벽
      px = r.x;
      const ny = settle(w, lv, px, py, env);
      if (ny === null) break;                    // 낭떠러지
      if (ny - py > G.TILE * 5) break;           // 너무 깊이 떨어진다
      py = ny;
      if (hardHazard(w, lv, px, py)) break;
      out.push([px, py]);
    }
  }
}

/* 움직이는 발판 위에 설 수 있는 자리들. 발판이 사람 쪽으로 와 주므로
   왕복 구간을 통째로 "설 수 있는 자리"로 본다. */
function moverStands(w, lv, out) {
  const G = w.Grid;
  for (const m of lv.movers) {
    for (let s = 0; s <= 10; s++) {
      const box = G.moverAt(m, (m.period * s) / 20);
      for (let ox = 0; ox <= box.w - G.PW; ox += STEP * 2) {
        out.push([box.x + ox, box.y - G.PH]);
      }
    }
  }
}

function flood(w, lv, seeds, env, extra) {
  const seen = new Map();
  const queue = [];
  const push = (x, y) => {
    const k = key(x, y);
    if (seen.has(k)) return;
    seen.set(k, [x, y]);
    queue.push([x, y]);
  };

  for (const [sx, sy] of seeds) {
    const y = settle(w, lv, sx, sy, env);
    if (y !== null) push(sx, y);
  }
  /* 목마 자리는 떨어뜨리면 안 된다 — 발밑이 동료라 격자에는 아무것도 없다.
     settle 을 태우면 바닥까지 도로 내려가 목마가 없던 일이 된다. */
  for (const [ex, ey] of (extra || [])) if (!w.Grid.hits(lv, ex, ey, env)) push(ex, ey);
  const mv = [];
  moverStands(w, lv, mv);
  for (const [mx, my] of mv) if (!w.Grid.hits(lv, mx, my, env)) push(mx, my);

  let guard = 0;
  while (queue.length && guard++ < 80000) {
    const [x, y] = queue.shift();
    const next = [];
    walkNeighbours(w, lv, x, y, env, next);
    jumpLandings(w, lv, x, y, env, next);
    /* 동료가 던져 주는 판이면 그 힘으로도 뛰어 본다. 사람은 머리 위로
       들려서 날아가므로 한 몸 높이 위에서 출발한다. */
    if (lv.toss) jumpLandings(w, lv, x, y - w.Grid.PH, env, next, w.Sim.TOSS_VY);
    /* 대포 칸 위를 지나면 쏘아 올려진다. 사람은 대포를 딛고 서는 게 아니라
       걸어 들어가므로, 지나가는 자리에서 발사되는 것으로 본다. */
    const G2 = w.Grid;
    const ccx = Math.floor((x + G2.PW / 2) / G2.TILE);
    const ccy = Math.floor((y + G2.PH / 2) / G2.TILE);
    if (G2.at(lv, ccx, ccy) === w.Tiles.CANNON) {
      const shotX = ccx * G2.TILE + (G2.TILE - G2.PW) / 2;
      jumpLandings(w, lv, shotX, y, env, next, w.Sim.CANNON_V);
    }
    for (const [nx, ny] of next) push(nx, ny);
  }
  return seen;
}

function anyIn(set, test) {
  for (const [, [x, y]] of set) if (test(x, y)) return true;
  return false;
}

/* 판 하나를 검사한다. players 는 그 방의 인원수. */
function check(w, lvIndex, players) {
  const G = w.Grid, T = w.Tiles;
  const lv = w.Levels.LIST[lvIndex];
  const problems = [];
  const empty = { door: false, cr: {} };

  const n = Math.max(1, Math.min(players, 8));
  const seeds = [];
  for (let i = 0; i < n; i++) {
    const s = lv.spawns[i];
    if (G.hits(lv, s.x, s.y, empty)) {
      problems.push(i + '번 시작 자리가 벽 속이다 (' + Math.round(s.x) + ',' + Math.round(s.y) + ')');
    } else if (hardHazard(w, lv, s.x, s.y)) {
      problems.push(i + '번 시작 자리가 가시 위다');
    } else if (settle(w, lv, s.x, s.y, empty) === null) {
      problems.push(i + '번 시작 자리 밑에 바닥이 없다 (' + Math.round(s.x) + ')');
    } else {
      /* 되살아나는 자리는 언제나 안전해야 한다. 떨어진 사람이 여기로 돌아오는데
         가시 위면 돌아오자마자 또 죽고, 그게 라운드 재시작이면 영원히 반복된다.
         깜빡이는 가시는 지금 들어가 있어도 곧 나오므로 두 위상 다 본다. */
      var sy = settle(w, lv, s.x, s.y, empty);
      if (G.inHazard(lv, s.x, sy, true) || G.inHazard(lv, s.x, sy, false)) {
        problems.push(i + '번 시작 자리가 가시에 닿는다 — 되살아나자마자 또 죽는다');
      }
    }
    seeds.push([s.x, s.y]);
  }

  /* 목마가 필요한 판은 한 사람으로만 보면 절대 못 깬다 — 그게 그 판의
     뜻이라 검사기가 틀린 게 아니다. 그런 판은 "동료 머리 위(한 몸 높이)에서
     뛴다"는 출발점을 하나 더 준다. */
  /* 목마가 필요한 판은 한 사람으로만 보면 절대 못 깬다 — 그게 그 판의 뜻이라
     검사기가 틀린 게 아니다. 그런 판은 "동료 머리 위(한 몸 높이)에서 뛴다"는
     출발점을 따로 넣어 준다. 바닥으로 떨어뜨리지 않고 그대로 쓴다. */
  const boosts = [];
  if (lv.boost) {
    for (const [sx, sy] of seeds) {
      const g = settle(w, lv, sx, sy, empty);
      if (g !== null) boosts.push([sx, g - G.PH]);
    }
  }

  const closed = flood(w, lv, seeds, empty, boosts);

  let buttons = 0;
  const seenBtn = new Set();
  for (const [, [x, y]] of closed) {
    for (const f of G.footTiles(lv, x, y)) {
      if (f.t === T.BUTTON && !seenBtn.has(f.idx)) { seenBtn.add(f.idx); buttons++; }
    }
  }
  const hasDoor = lv.grid.indexOf(T.DOOR) >= 0;
  const needs = lv.needs || 1;

  /* 열쇠가 있는 판은 버튼 대신 열쇠가 문을 연다. 여기서는 "열쇠가 놓인
     자리에 사람이 닿을 수 있나"까지만 본다 — 그 뒤로 열쇠를 어디까지
     들고 갈 수 있는지는 던지고 받는 경우의 수가 너무 많아 그물로 못 뜬다.
     대신 열쇠에 아예 못 닿는 판(= 아무도 못 깨는 판)은 확실히 걸린다. */
  let keyReachable = false;
  if (lv.key) {
    const ky = settle(w, lv, lv.key.x, lv.key.y, empty);
    for (const [, [x, y]] of closed) {
      if (Math.abs(x - lv.key.x) < G.TILE * 1.5 && Math.abs(y - (ky === null ? lv.key.y : ky)) < G.TILE * 2) {
        keyReachable = true; break;
      }
    }
    if (!keyReachable) problems.push('열쇠에 닿을 수 없다');
  }

  const opens = lv.key ? keyReachable : (buttons >= needs);
  if (hasDoor && !opens && !lv.key) {
    problems.push('문이 있는데 닿을 수 있는 버튼이 ' + buttons + '개다 (' + needs + '개 필요)');
  }
  if (needs > n) {
    problems.push(needs + '명이 동시에 눌러야 하는데 인원이 ' + n + '명이다');
  }

  const open = (hasDoor && opens)
    ? flood(w, lv, seeds, { door: true, cr: {} }, boosts)
    : closed;

  if (!anyIn(open, (x, y) => G.inGoal(lv, x, y))) problems.push('출입구에 닿을 수 없다');

  return { name: lv.name, min: lv.min, buttons: buttons, problems: problems, spots: open.size };
}

module.exports = { W, check, flood, canStand, settle, hardHazard, jumpLandings };
