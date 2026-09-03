// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readJsonFile } from './readJsonFile';

function file(text) {
  return new File([text], 'scenes.json', { type: 'application/json' });
}

describe('readJsonFile', () => {
  it('resolves the parsed document', async () => {
    const doc = { version: 2, scenes: [{ id: 'a', name: 'A', layers: [] }] };
    expect(await readJsonFile(file(JSON.stringify(doc)))).toEqual(doc);
  });

  it('rejects a file that is not JSON, with a message that reads after "Import failed:"', async () => {
    // The only thing either caller does with the rejection is interpolate it,
    // so the clause has to stand on its own — including the full stop.
    await expect(readJsonFile(file('<html>nope</html>')))
      .rejects.toThrow('the file is not valid JSON.');
  });

  it('does not confuse an empty file with an empty library', async () => {
    await expect(readJsonFile(file(''))).rejects.toThrow(/not valid JSON/);
  });
});
