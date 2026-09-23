import { normaliseListName } from './list-name';

describe('normaliseListName', () => {
  it.each([
    ['Shopping', 'shopping'],
    ['  My   Shopping List ', 'shopping'],
    ['the ideas list', 'ideas'],
    ['Список покупок', 'список покупок'],
    ['list', 'list'],
    ['   ', null],
    [null, null],
    [undefined, null],
  ])('%j → %j', (raw, name) => {
    expect(normaliseListName(raw)).toBe(name);
  });

  it('caps the length', () => {
    expect(normaliseListName('x'.repeat(100))).toHaveLength(40);
  });
});
