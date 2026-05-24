/**
 * File-system capability injected via the Host. Hosts that omit it get a
 * clean runtime error if a Rapira program tries to do file I/O (this is
 * how the web playground refuses files — no fs, no leaking secrets).
 *
 * Handles are addressed by their Rapira-side identifier (the name after
 * `КАК` in ОТКРЫТЬ, e.g. `ИФ`). The handle string is what `ВЫВОД В ФАЙЛ
 * ИФ` and `ВВОД ИЗ ФАЙЛА ИФ` use to refer to the open file.
 *
 * Reads are line-oriented; writes append a string to the buffer; the
 * implementation decides when/whether to flush to durable storage.
 */
export interface FileSystem {
  /** Open `path` and label it as `handle`. If the file doesn't exist it
   *  starts empty. Replaces any previously-open file under `handle`. */
  open(path: string, handle: string): void;
  /** Flush and release a handle. No-op if not open. */
  close(handle: string): void;
  /** Append text to the open file under `handle`. */
  writeText(handle: string, s: string): void;
  /** Read the next line (without the trailing newline) from `handle`.
   *  Returns the empty string at end-of-file. */
  readLine(handle: string): string;
  /** Read the next whitespace-delimited token, skipping leading
   *  whitespace and newlines. Returns '' at EOF. */
  readToken(handle: string): string;
}

interface FileEntry {
  path: string;
  contents: string;
  readPos: number;
  dirty: boolean;
}

/**
 * Pure in-memory file system. Survives only for the lifetime of the
 * interpreter run. Used by BufferedHost for tests and the web playground
 * (the web doesn't ship this either — it has *no* fs, see web/worker.ts).
 */
export class InMemoryFileSystem implements FileSystem {
  private handles = new Map<string, FileEntry>();
  /** Path → contents, persisted across open/close within a single instance. */
  private store: Map<string, string>;

  constructor(initial: Record<string, string> = {}) {
    this.store = new Map(Object.entries(initial));
  }

  open(path: string, handle: string): void {
    const contents = this.store.get(path) ?? '';
    this.handles.set(handle, { path, contents, readPos: 0, dirty: false });
  }

  close(handle: string): void {
    const h = this.handles.get(handle);
    if (!h) return;
    if (h.dirty) this.store.set(h.path, h.contents);
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
    const line = nl === -1
      ? h.contents.slice(h.readPos)
      : h.contents.slice(h.readPos, nl);
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

  /** Read out the persisted store (test helper). */
  snapshot(): Map<string, string> {
    return new Map(this.store);
  }
}
