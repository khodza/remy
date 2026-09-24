import { presentLists } from './lists.presenter';

describe('presentLists', () => {
  it('lists every list with counts and a button each, no trailing empty row', () => {
    const reply = presentLists([
      { name: 'ideas', pending: 3, completed: 0 },
      { name: 'shopping <3', pending: 2, completed: 5 },
      { name: 'trip', pending: 0, completed: 1 },
    ]);
    expect(reply.html).toContain('• <b>ideas</b> · 3 open');
    expect(reply.html).toContain('• <b>shopping &lt;3</b> · 2 open · 5 done');
    const rows = reply.keyboard!.inline_keyboard;
    expect(rows.map((r) => r.length)).toEqual([2, 1]);
    expect(rows[0]![0]).toMatchObject({
      text: '🗂 ideas',
      callback_data: 'lst:ideas',
    });
  });

  it('explains how to start a list when there is none', () => {
    const reply = presentLists([]);
    expect(reply.html).toContain('No lists yet');
    expect(reply.keyboard).toBeUndefined();
  });
});
