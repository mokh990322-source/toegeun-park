'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

function R() { return load('room').Room; }

/* 지금이 10000ms 라고 두고, seen 을 '몇 초 전'으로 적는다 */
const NOW = 10000;
function who(spec) {
  const o = {};
  for (const k in spec) {
    o[k] = { name: k, join: spec[k].join, seen: NOW - spec[k].agoSec * 1000 };
  }
  return o;
}

test('상수가 말이 되는 범위다', () => {
  const r = R();
  assert.ok(r.HOST_TIMEOUT >= 2 && r.HOST_TIMEOUT <= 6, '너무 짧으면 렉에 승계가 튄다');
  assert.ok(r.CLAIM_WAIT > 0 && r.CLAIM_WAIT < r.HOST_TIMEOUT);
  assert.ok(r.SEEN_TIMEOUT > r.HOST_TIMEOUT, '호스트 판정보다 느슨해야 한다');
});

test('alive 는 최근에 소식 있는 사람만, 입장 순서로 준다', () => {
  const r = R();
  const w = who({ c: { join: 3, agoSec: 1 }, a: { join: 1, agoSec: 1 }, b: { join: 2, agoSec: 99 } });
  assert.deepStrictEqual(r.alive(w, NOW), ['a', 'c']);
});

test('alive 는 빈 목록도 견딘다', () => {
  const r = R();
  assert.deepStrictEqual(r.alive(null, NOW), []);
  assert.deepStrictEqual(r.alive({}, NOW), []);
});

test('nextHost 는 입장 순번이 가장 빠른 생존자', () => {
  const r = R();
  const w = who({ a: { join: 1, agoSec: 99 }, b: { join: 2, agoSec: 1 }, c: { join: 3, agoSec: 1 } });
  assert.strictEqual(r.nextHost(w, NOW), 'b');
});

test('nextHost 는 아무도 없으면 null', () => {
  const r = R();
  assert.strictEqual(r.nextHost(who({ a: { join: 1, agoSec: 99 } }), NOW), null);
});

test('hostDead 는 틱이 멈춘 지 오래면 참', () => {
  const r = R();
  const ms = r.HOST_TIMEOUT * 1000;
  assert.strictEqual(r.hostDead(50, NOW - ms - 500, NOW), true);
  assert.strictEqual(r.hostDead(50, NOW - 100, NOW), false);
});

test('hostDead 는 아직 스냅샷을 한 번도 못 받았으면 거짓', () => {
  const r = R();
  assert.strictEqual(r.hostDead(null, NOW - 99999, NOW), false, '방금 들어온 사람이 승계하면 안 된다');
});

/* ---------- shouldClaim ---------- */

function opts(over) {
  const base = {
    me: 'b', host: 'a',
    who: who({ a: { join: 1, agoSec: 99 }, b: { join: 2, agoSec: 1 }, c: { join: 3, agoSec: 1 } }),
    lastTick: 50, lastChangeMs: NOW - 5000, nowMs: NOW, claimedAtMs: 0
  };
  return Object.assign(base, over || {});
}

test('내가 이미 호스트면 아무것도 안 한다', () => {
  const r = R();
  assert.strictEqual(r.shouldClaim(opts({ me: 'a', host: 'a', lastChangeMs: NOW })), 'none');
});

test('호스트가 살아 있으면 아무것도 안 한다', () => {
  const r = R();
  assert.strictEqual(r.shouldClaim(opts({ lastChangeMs: NOW - 100 })), 'none');
});

test('호스트가 죽고 내가 다음 차례면 나선다', () => {
  const r = R();
  assert.strictEqual(r.shouldClaim(opts()), 'claim');
});

test('호스트가 죽어도 내 차례가 아니면 기다린다', () => {
  const r = R();
  assert.strictEqual(r.shouldClaim(opts({ me: 'c' })), 'none');
});

test('나선 직후에는 관망한다', () => {
  const r = R();
  const o = opts({ claimedAtMs: NOW - 200 });
  assert.strictEqual(r.shouldClaim(o), 'wait');
});

test('관망이 끝나고 내가 호스트가 됐으면 끝', () => {
  const r = R();
  const o = opts({ me: 'b', host: 'b', claimedAtMs: NOW - r.CLAIM_WAIT * 1000 - 100 });
  assert.strictEqual(r.shouldClaim(o), 'none');
});

test('관망이 끝났는데 남이 호스트가 됐으면 물러난다', () => {
  const r = R();
  const o = opts({ me: 'b', host: 'c', claimedAtMs: NOW - r.CLAIM_WAIT * 1000 - 100 });
  assert.strictEqual(r.shouldClaim(o), 'yield');
});

test('호스트가 목록에서 아예 사라졌으면 다음 차례가 나선다', () => {
  const r = R();
  const o = opts({
    host: '없는사람',
    who: who({ b: { join: 2, agoSec: 1 }, c: { join: 3, agoSec: 1 } })
  });
  assert.strictEqual(r.shouldClaim(o), 'claim');
});

test('나 혼자 남았으면 내가 호스트가 된다', () => {
  const r = R();
  const o = opts({ me: 'b', host: 'a', who: who({ b: { join: 2, agoSec: 1 } }) });
  assert.strictEqual(r.shouldClaim(o), 'claim');
});

test('망가진 인자에도 안 죽는다', () => {
  const r = R();
  for (const bad of [null, undefined, {}, { me: 'b' }]) {
    assert.ok(['none', 'claim', 'wait', 'yield'].indexOf(r.shouldClaim(bad)) >= 0);
  }
});
