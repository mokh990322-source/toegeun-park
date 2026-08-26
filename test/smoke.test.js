'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

test('cloud-config 가 Firebase 주소를 window 에 올린다', () => {
  const w = load('cloud-config');
  assert.match(w.CLOUD_URL, /^https:\/\/.+firebasedatabase\.app$/);
});
