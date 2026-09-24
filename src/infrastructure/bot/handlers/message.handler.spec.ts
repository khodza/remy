import type { Context } from 'grammy';
import { MessageHandler } from './message.handler';
import type { CommandHandler } from './command.handler';
import type { AssistantResponder } from '../assistant.responder';
import type { EnsureUserUsecase } from '@usecases/user/ensure-user';
import type {
  HandleMessageUsecase,
  TranscribeAudioUsecase,
} from '@usecases/assistant';
import { makeUser } from '@test/factories';

describe('MessageHandler.handleText', () => {
  const ensureUser = { execute: jest.fn().mockResolvedValue(makeUser()) };
  const responder = { respond: jest.fn().mockResolvedValue(undefined) };
  const commands = { handleLists: jest.fn().mockResolvedValue(undefined) };
  const handler = new MessageHandler(
    ensureUser as unknown as EnsureUserUsecase,
    {} as HandleMessageUsecase,
    {} as TranscribeAudioUsecase,
    responder as unknown as AssistantResponder,
    commands as unknown as CommandHandler,
  );
  const ctx = (text: string): Context =>
    ({
      message: { text, message_id: 7 },
      from: { id: 42, first_name: 'Owner' },
      me: { id: 99 },
    }) as unknown as Context;

  beforeEach(() => jest.clearAllMocks());

  it('routes /lists (with or without the bot name) to the command handler', async () => {
    await handler.handleText(ctx('/lists'));
    await handler.handleText(ctx('/lists@remy_bot'));
    expect(commands.handleLists).toHaveBeenCalledTimes(2);
    expect(responder.respond).not.toHaveBeenCalled();
  });

  it('ignores other commands and sends plain text to the assistant', async () => {
    await handler.handleText(ctx('/listsomething'));
    await handler.handleText(ctx('/unknown'));
    expect(commands.handleLists).not.toHaveBeenCalled();
    expect(responder.respond).not.toHaveBeenCalled();

    await handler.handleText(ctx('buy milk'));
    expect(responder.respond).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'user-1' }),
      'buy milk',
      { source: { type: 'text', messageId: 7 } },
    );
  });
});
