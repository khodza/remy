import { extensionForMime } from './gateway';

describe('extensionForMime', () => {
  it.each([
    ['audio/ogg', 'ogg'],
    ['audio/webm;codecs=opus', 'webm'],
    ['video/webm', 'webm'],
    ['audio/mp4', 'm4a'],
    ['audio/x-m4a', 'm4a'],
    ['audio/mpeg', 'mp3'],
    ['audio/wav', 'wav'],
    ['application/octet-stream', 'ogg'],
  ])('%s → %s', (mime, ext) => {
    expect(extensionForMime(mime)).toBe(ext);
  });
});
