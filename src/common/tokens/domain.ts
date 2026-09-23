export const Domain = {
  Task: {
    Repository: Symbol.for('Domain.Task.Repository'),
  },
  User: {
    Repository: Symbol.for('Domain.User.Repository'),
  },
  AI: {
    TranscriptionGateway: Symbol.for('Domain.AI.TranscriptionGateway'),
  },
  Notification: {
    Gateway: Symbol.for('Domain.Notification.Gateway'),
  },
  Conversation: {
    Repository: Symbol.for('Domain.Conversation.Repository'),
  },
  Assistant: {
    InterpreterGateway: Symbol.for('Domain.Assistant.InterpreterGateway'),
  },
};
