import { commandArgument, whenLine } from './command.handler';

describe('commandArgument', () => {
  it('returns what follows the command, trimmed', () => {
    expect(commandArgument('/list shopping')).toBe('shopping');
    expect(commandArgument('/list@remy_bot  My Shopping List ')).toBe(
      'My Shopping List',
    );
    expect(commandArgument('/list')).toBe('');
    expect(commandArgument(undefined)).toBe('');
  });
});

describe('whenLine', () => {
  const at = new Date('2026-09-21T07:00:00Z'); // 09:00 Berlin, 12:00 Tashkent
  it('shows the profile-zone time, with the task zone as a hint when it differs', () => {
    const task = {
      scheduledAt: at,
      snoozedUntil: null,
      allDay: false,
      timezone: 'Europe/Berlin',
    };
    expect(whenLine(task, 'Asia/Tashkent')).toBe(
      '⏰ Mon 21 Sep, 12:00 <i>(09:00 Berlin time)</i>',
    );
    expect(whenLine(task, 'Europe/Berlin')).toBe('⏰ Mon 21 Sep, 09:00');
    expect(whenLine({ ...task, allDay: true }, 'Asia/Tashkent')).toBe(
      '📅 Mon 21 Sep (all day)',
    );
    expect(whenLine({ ...task, scheduledAt: null }, 'Asia/Tashkent')).toBe(
      '📥 no date',
    );
  });
});
