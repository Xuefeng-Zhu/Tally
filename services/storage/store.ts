import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyState, type State } from '../../packages/contracts/index.js';

export interface Store {
  read(): Promise<State>;
  transact<T>(fn: (draft: State) => T): Promise<T>;
}
const clone = <T>(value: T): T => structuredClone(value);

/** Serial transactions isolate readers and publish only complete successful drafts. */
export class MemoryStore implements Store {
  private value: State;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(initial: State = emptyState()) { this.value = clone(initial); }
  async read(): Promise<State> { await this.tail; return clone(this.value); }
  transact<T>(fn: (draft: State) => T): Promise<T> {
    const work = this.tail.then(() => {
      const draft = clone(this.value);
      const result = fn(draft);
      if (result instanceof Promise) throw new Error('Store transaction callbacks must be synchronous');
      this.value = draft;
      return clone(result);
    });
    this.tail = work.catch(() => undefined);
    return work;
  }
}

const fileTails = new Map<string, Promise<unknown>>();
/** Local adapter: one process serializes each file, then atomically renames a full snapshot. */
export class FileStore implements Store {
  constructor(readonly path: string) {}
  private async load(): Promise<State> {
    try { return JSON.parse(await readFile(this.path, 'utf8')) as State; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState(); throw error; }
  }
  async read(): Promise<State> { await fileTails.get(this.path); return clone(await this.load()); }
  transact<T>(fn: (draft: State) => T): Promise<T> {
    const work = (fileTails.get(this.path) ?? Promise.resolve()).then(async () => {
      const draft = clone(await this.load());
      const result = fn(draft);
      if (result instanceof Promise) throw new Error('Store transaction callbacks must be synchronous');
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(draft, null, 2), { mode: 0o600 });
      await rename(temporary, this.path);
      return clone(result);
    });
    fileTails.set(this.path, work.catch(() => undefined));
    return work;
  }
}
