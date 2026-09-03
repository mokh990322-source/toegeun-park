'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('../testlib/load');

test('cloud-config 가 Firebase 주소를 window 에 올린다', () => {
  const w = load('cloud-config');
  assert.match(w.CLOUD_URL, /^https:\/\/.+firebasedatabase\.app$/);
});

/* index.html 과 js/ 가 어긋나는 사고가 실제로 있었다 — 파일을 지우거나
   새로 만들고 index.html 을 안 고쳐서, 시험은 다 통과하는데 페이지는
   빈 화면이었다. 시험은 파일을 직접 읽으니 그 어긋남을 못 본다. */
test('index.html 이 js/ 의 모든 파일을 정확히 한 번씩 부른다', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  const called = [];
  const re = /<script src="js\/([A-Za-z0-9_-]+)\.js(\?[^"]*)?"><\/script>/g;
  let m;
  while ((m = re.exec(html))) called.push(m[1]);

  const onDisk = fs.readdirSync(path.join(root, 'js'))
    .filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).sort();

  assert.deepStrictEqual(called.slice().sort(), onDisk,
    '부르는 것: ' + called.join(', ') + '\n  있는 것: ' + onDisk.join(', '));

  /* 순서도 중요하다. bot.js 는 Levels 를 쓰고, game.js 는 전부를 쓴다. */
  assert.ok(called.indexOf('levels') < called.indexOf('bot'), 'bot 은 levels 뒤에 와야 한다');
  assert.ok(called.indexOf('sim') < called.indexOf('game'));
  assert.strictEqual(called[called.length - 1], 'game', 'game.js 가 마지막이어야 한다');
});
