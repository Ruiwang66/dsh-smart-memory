import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

for (const [language, expectedDetail] of [['zh', 'README.zh.md'], ['en', 'README.md']]) {
  test(`locale/${language}.json exposes localized plugin metadata and detail document`, () => {
    const file = path.join(root, 'locale', `${language}.json`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(data.meta.detail, expectedDetail);
    assert.ok(data.meta.title.trim().length > 0);
    assert.ok(data.meta.description.trim().length > 0);
    assert.ok(fs.existsSync(path.join(root, expectedDetail)), `${expectedDetail} exists`);
  });
}

test('package manifest ships both locale files and both READMEs', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('locale'));
  assert.ok(pkg.files.includes('README.md'));
  assert.ok(pkg.files.includes('README.zh.md'));
  assert.ok(fs.existsSync(path.join(root, 'README.md')));
  assert.ok(fs.existsSync(path.join(root, 'README.zh.md')));
});
