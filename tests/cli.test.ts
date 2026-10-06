import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, chmodSync, writeFileSync, symlinkSync, readFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('nagori forwards canonical folder/file paths safely through native open', () => {
  const root = mkdtempSync(join(tmpdir(), 'nagori cli '));
  try {
    const app = join(root, 'src-tauri/target/release/bundle/macos/Nagori.app');
    const scripts = join(root, 'scripts'), bin = join(root, 'bin'), workspace = join(root, '日本語 notes');
    for (const path of [app, scripts, bin, workspace]) mkdirSync(path, { recursive: true });
    const launcher = join(scripts, 'nagori'), command = join(bin, 'nagori'), output = join(root, 'args');
    // Substitute only the temporary fixture's native-open path; production always uses /usr/bin/open.
    writeFileSync(launcher, readFileSync(new URL('../scripts/nagori', import.meta.url), 'utf8').replaceAll('/usr/bin/open', `"${join(bin, 'open')}"`));
    chmodSync(launcher, 0o755);
    symlinkSync('../scripts/nagori', command);
    writeFileSync(join(bin, 'open'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$NAGORI_TEST_ARGS"\n', { mode: 0o755 });
    writeFileSync(join(bin, 'uname'), '#!/bin/sh\nprintf "Darwin\\n"\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, NAGORI_TEST_ARGS: output };
    const run = (args: string[]) => spawnSync(command, args, { cwd: workspace, env, encoding: 'utf8' });
    const forwarded = () => readFileSync(output, 'utf8').trimEnd().split('\n');
    // /var on macOS can alias /private/var; resolve fixtures as the launcher does.
    const physical = spawnSync('/bin/sh', ['-c', 'pwd -P'], { cwd: workspace, encoding: 'utf8' }).stdout.trim();
    const physicalApp = spawnSync('/bin/sh', ['-c', 'pwd -P'], { cwd: app, encoding: 'utf8' }).stdout.trim();
    assert.equal(run(['.']).status, 0);
    assert.deepEqual(forwarded(), ['-a', physicalApp, physical]);
    assert.equal(run([]).status, 0);
    assert.deepEqual(forwarded(), ['-a', physicalApp, physical]);
    const filename = 'test $(touch should-not-exist) # file.md';
    writeFileSync(join(workspace, filename), '# Test');
    assert.equal(run([filename]).status, 0);
    assert.deepEqual(forwarded(), ['-a', physicalApp, physical, `${physical}/${filename}`]);
    mkdirSync(join(workspace, 'nested'));
    writeFileSync(join(workspace, 'nested/test.md'), '# Nested');
    assert.equal(run(['nested/test.md']).status, 0);
    assert.deepEqual(forwarded(), ['-a', physicalApp, physical, `${physical}/nested/test.md`]);
    const outside = join(root, 'outside.md');
    writeFileSync(outside, '# Outside');
    symlinkSync('../outside.md', join(workspace, 'alias.md'));
    assert.equal(run(['alias.md']).status, 0);
    const parent = physical.slice(0, physical.lastIndexOf('/'));
    assert.deepEqual(forwarded(), ['-a', physicalApp, parent, `${parent}/outside.md`]);
    assert.equal(run(['missing.md']).status, 1);
    assert.equal(run(['.', '.']).status, 1);
    assert.match(run(['--help']).stdout, /Usage: nagori/);
    const resource = join(app, 'Contents/Resources/cli');
    mkdirSync(resource, { recursive: true });
    copyFileSync(launcher, join(resource, 'nagori'));
    chmodSync(join(resource, 'nagori'), 0o755);
    rmSync(command);
    symlinkSync(join(resource, 'nagori'), command);
    assert.equal(run(['nested/test.md']).status, 0);
    assert.deepEqual(forwarded(), ['-a', physicalApp, physical, `${physical}/nested/test.md`]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('CLI link installer is idempotent and preserves unrelated and concurrently created commands', () => {
  const root = mkdtempSync(join(tmpdir(), 'nagori installer '));
  try {
    const source = join(root, "日本語 ' app/nagori"), destination = join(root, 'bin/nagori');
    mkdirSync(join(root, "日本語 ' app"), { recursive: true });
    writeFileSync(source, '#!/bin/sh\n', { mode: 0o755 });
    const helper = new URL('../scripts/cli-link.sh', import.meta.url).pathname;
    const run = (action: string, script = helper) => spawnSync('/bin/sh', [script, action, source, destination], { encoding: 'utf8' });
    assert.equal(run('install').status, 0);
    assert.equal(run('install').status, 0);
    assert.equal(run('uninstall').status, 0);
    assert.equal(run('uninstall').status, 0);
    writeFileSync(destination, 'unrelated');
    assert.equal(run('install').status, 17);
    assert.equal(run('uninstall').status, 17);
    assert.equal(readFileSync(destination, 'utf8'), 'unrelated');
    unlinkSync(destination);
    symlinkSync(join(root, 'missing-other-command'), destination);
    assert.equal(run('install').status, 17);
    assert.equal(run('uninstall').status, 17);
    unlinkSync(destination);
    const mocks = join(root, 'mocks');
    mkdirSync(mocks);
    writeFileSync(join(mocks, 'ln'), '#!/bin/sh\nprintf unrelated > "$4"\nexec /bin/ln "$@"\n', { mode: 0o755 });
    const raceHelper = join(root, 'race-helper.sh');
    writeFileSync(raceHelper, readFileSync(helper, 'utf8').replace('/bin/ln -s', `"${join(mocks, 'ln')}" -s`));
    const raced = run('install', raceHelper);
    assert.equal(raced.status, 17);
    assert.equal(readFileSync(destination, 'utf8'), 'unrelated');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
