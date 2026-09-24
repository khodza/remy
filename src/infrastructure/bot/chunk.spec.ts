import { chunkLines } from './chunk';

describe('chunkLines', () => {
  it('keeps everything in one message while it fits', () => {
    expect(chunkLines(['a', 'b', 'c'], 10)).toEqual(['a\nb\nc']);
    expect(chunkLines([], 10)).toEqual([]);
  });

  it('starts a new message before a line that would not fit, never mid-line', () => {
    expect(chunkLines(['12345', '1234', '123456', '1'], 10)).toEqual([
      '12345\n1234',
      '123456\n1',
    ]);
  });

  it('sends an oversize line on its own instead of dropping it', () => {
    expect(chunkLines(['x'.repeat(30), 'y'], 10)).toEqual([
      'x'.repeat(30),
      'y',
    ]);
  });
});
