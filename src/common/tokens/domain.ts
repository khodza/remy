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
  Integrations: {
    GoogleConnectionRepository: Symbol.for(
      'Domain.Integrations.GoogleConnectionRepository',
    ),
    GoogleCalendarGateway: Symbol.for(
      'Domain.Integrations.GoogleCalendarGateway',
    ),
    ConnectStateSigner: Symbol.for('Domain.Integrations.ConnectStateSigner'),
    GoogleConnectionNotifier: Symbol.for(
      'Domain.Integrations.GoogleConnectionNotifier',
    ),
    /** The morning brief's optional source of the day's calendar events. */
    CalendarEventsSource: Symbol.for(
      'Domain.Integrations.CalendarEventsSource',
    ),
  },
};
