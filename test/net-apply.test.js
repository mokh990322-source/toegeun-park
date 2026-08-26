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
