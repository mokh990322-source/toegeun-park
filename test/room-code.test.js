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
