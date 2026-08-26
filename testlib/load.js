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
