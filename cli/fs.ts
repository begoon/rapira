/**
 * Node-backed FileSystem for the CLI. Reads the file fully into memory on
 * `open`, mutates it in memory, and writes it back on `close` (or on
 * process exit via `closeAll`). Modern enough for the educational
 * workloads Rapira programs do, and matches the spec's loose semantics
 * around file state.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import type { FileSystem } from '../src/fs.ts';

interface FileEntry {
  path: string;
  contents: string;
  readPos: number;
  dirty: boolean;
}

export class NodeFileSystem implements FileSystem {
  private handles = new Map<string, FileEntry>();

  open(path: string, handle: string): void {
    const contents = existsSync(path) ? readFileSync(path, 'utf8') : '';
    this.handles.set(handle, { path, contents, readPos: 0, dirty: false });
  }

  close(handle: string): void {
    const h = this.handles.get(handle);
    if (!h) return;
    if (h.dirty) writeFileSync(h.path, h.contents, 'utf8');
    this.handles.delete(handle);
  }

  writeText(handle: string, s: string): void {
    const h = this.handles.get(handle);
    if (!h) throw new Error(`файл «${handle}» не открыт`);
    h.contents += s;
    h.dirty = true;
  }

  readLine(handle: string): string {
    const h = this.handles.get(handle);
    if (!h) throw new Error(`файл «${handle}» не открыт`);
    if (h.readPos >= h.contents.length) return '';
    const nl = h.contents.indexOf('\n', h.readPos);
    const line = nl === -1 ? h.contents.slice(h.readPos) : h.contents.slice(h.readPos, nl);
    h.readPos = nl === -1 ? h.contents.length : nl + 1;
    return line.replace(/\r$/, '');
  }

  readToken(handle: string): string {
    const h = this.handles.get(handle);
    if (!h) throw new Error(`файл «${handle}» не открыт`);
    while (h.readPos < h.contents.length && /\s/.test(h.contents[h.readPos]!)) h.readPos++;
    const start = h.readPos;
    while (h.readPos < h.contents.length && !/\s/.test(h.contents[h.readPos]!)) h.readPos++;
    return h.contents.slice(start, h.readPos);
  }

  /** Flush and release every open handle (call on process exit). */
  closeAll(): void {
    for (const handle of this.handles.keys()) this.close(handle);
  }
}
