'use strict';

// fvgsd is not published to npm. Both packages are private, so an accidental
// `npm publish` fails instead of claiming the unscoped `fvgsd` name or `@fvgsd/sdk`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('the fvgsd and @fvgsd/sdk packages are private', () => {
  for (const [rel, name] of [['../package.json', 'fvgsd'], ['../sdk/package.json', '@fvgsd/sdk']]) {
    const pkg = require(rel);
    assert.equal(pkg.name, name);
    assert.equal(pkg.private, true, `${name} is not marked private`);
  }
});
