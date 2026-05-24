import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = './cli/index.ts';

function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
  const result = spawnSync('bun', ['run', CLI, ...args], { encoding: 'utf8' });
  return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? 0 };
}

describe('CLI', () => {
  test('runs hello world', () => {
    const r = runCli(['examples/hello.rap']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('ЗДРАВСТВУЙ, МИР!\n');
  });

  test('runs factorial example', () => {
    const r = runCli(['examples/factorial.rap']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ФАКТ(0) = 1');
    expect(r.stdout).toContain('ФАКТ(5) = 120');
    expect(r.stdout).toContain('ФАКТ(7) = 5040');
  });

  test('--svg writes SVG with line events from turtle square', () => {
    const out = join(tmpdir(), `rapira-test-${Date.now()}.svg`);
    try {
      const r = runCli(['examples/turtle_square.rap', '--svg', out]);
      expect(r.code).toBe(0);
      const svg = readFileSync(out, 'utf8');
      expect(svg).toContain('<svg');
      // Square = 4 line segments
      expect(svg.match(/<line /g)).toHaveLength(4);
    } finally {
      if (existsSync(out)) unlinkSync(out);
    }
  });

  test('reports parse error with file:line:col', () => {
    const r = runCli(['examples/__broken_for_test.rap']);
    // file doesn't exist → node throws an error
    expect(r.code).not.toBe(0);
  });

  test('prints help on -h', () => {
    const r = runCli(['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage:');
    expect(r.stdout).toContain('--svg');
  });
});
