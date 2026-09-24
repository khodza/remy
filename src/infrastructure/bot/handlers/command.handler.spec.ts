import { commandArgument } from './command.handler';

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
