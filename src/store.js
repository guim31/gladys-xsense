// -----------------------------------------------------------------------------
// What the integration keeps in /data, the only writable place of the
// container (the rootfs is read-only): one JSON file, written atomically.
//
//   - `session`: the Cognito tokens of the X-Sense account (never the
//     password, which stays in the Gladys configuration), so a restart does
//     not sign in again;
//   - `selfTests`: the last self-test report of each detector, by serial — the
//     cloud only pushes it when the test runs;
//   - `lowBattery`: the detectors whose low battery was already announced, so
//     a restart does not fire the scene trigger again.
//
// The file is readable by the container user only.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class Store {
  /** @param {string} [dir] */
  constructor(dir = process.env.DATA_DIR ?? '/data') {
    this.file = join(dir, 'xsense.json');
    this.dir = dir;
    this.data = null;
    this.writing = Promise.resolve();
  }

  async load() {
    if (this.data) {
      return this.data;
    }
    try {
      this.data = JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      this.data = {};
    }
    return this.data;
  }

  async get(key) {
    return (await this.load())[key];
  }

  /** Writes are queued: the last one wins, never a half-written file. */
  async set(key, value) {
    const data = await this.load();
    if (value === null || value === undefined) {
      delete data[key];
    } else {
      data[key] = value;
    }
    const content = JSON.stringify(data);
    this.writing = this.writing.then(async () => {
      await mkdir(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, content, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    return this.writing;
  }
}

/** An in-memory store, for the tests and the probe script. */
export class MemoryStore {
  constructor(initial = {}) {
    this.data = structuredClone(initial);
  }

  async get(key) {
    return this.data[key];
  }

  async set(key, value) {
    if (value === null || value === undefined) {
      delete this.data[key];
    } else {
      this.data[key] = structuredClone(value);
    }
  }
}
