import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findCycles,
  packageNameFromSpecifier,
} from './check-workspace.mjs';

test('extracts dependency package names without treating local imports as packages', () => {
  assert.equal(
    packageNameFromSpecifier('@athr/contracts/subpath'),
    '@athr/contracts',
  );
  assert.equal(packageNameFromSpecifier('react/jsx-runtime'), 'react');
  assert.equal(packageNameFromSpecifier('node:fs'), null);
  assert.equal(packageNameFromSpecifier('../local'), null);
  assert.equal(packageNameFromSpecifier('@/lib/api'), null);
});

test('detects workspace dependency cycles', () => {
  const graph = new Map([
    ['@athr/a', new Set(['@athr/b'])],
    ['@athr/b', new Set(['@athr/c'])],
    ['@athr/c', new Set(['@athr/a'])],
  ]);

  assert.deepEqual(findCycles(graph), [
    ['@athr/a', '@athr/b', '@athr/c', '@athr/a'],
  ]);
});
