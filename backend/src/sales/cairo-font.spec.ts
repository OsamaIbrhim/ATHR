import { readFileSync } from 'fs';
import { join } from 'path';

describe('bundled Cairo font', () => {
  it('is a real TrueType/OpenType file, not a saved HTML page', () => {
    const signature = readFileSync(join(__dirname, '../../assets/fonts/Cairo-Regular.ttf'))
      .subarray(0, 4)
      .toString('latin1');
    expect(['\u0000\u0001\u0000\u0000', 'OTTO', 'true']).toContain(signature);
  });
});
