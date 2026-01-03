export const Domain = {
  Task: {
    Repository: Symbol.for('Domain.Task.Repository'),
  },
  User: {
    Repository: Symbol.for('Domain.User.Repository'),
  },
  AI: {
    TranscriptionGateway: Symbol.for('Domain.AI.TranscriptionGateway'),
    TaskParserGateway: Symbol.for('Domain.AI.TaskParserGateway'),
  },
  Notification: {
    Gateway: Symbol.for('Domain.Notification.Gateway'),
  },
};
