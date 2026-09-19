/**
 * JSON Schema for OpenAI structured outputs (strict mode): every property is
 * required, nothing extra is allowed, "optional" means nullable. One flat
 * object for all intents keeps the schema small and the model reliable; the
 * fields that don't apply to an intent are null / empty.
 */
const nullable = (type: string) => ({ type: [type, 'null'] });

const recurrenceSchema = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'type',
        'interval_days',
        'interval',
        'by_weekday',
        'last_day_of_month',
        'until_local',
      ],
      properties: {
        type: {
          type: 'string',
          enum: [
            'daily',
            'weekdays',
            'weekly',
            'monthly',
            'every_n_days',
            'yearly',
          ],
        },
        interval_days: nullable('integer'),
        interval: nullable('integer'),
        by_weekday: {
          anyOf: [
            { type: 'null' },
            { type: 'array', items: { type: 'integer' } },
          ],
        },
        last_day_of_month: nullable('boolean'),
        until_local: nullable('string'),
      },
    },
  ],
};

export const ASSISTANT_OUTPUT_SCHEMA = {
  name: 'remy_interpretation',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'intent',
      'tasks',
      'query_range',
      'query_search',
      'targets',
      'due_local',
      'in_minutes',
      'shift_minutes',
      'new_title',
      'new_notes',
      'reply',
      'question',
      'options',
    ],
    properties: {
      intent: {
        type: 'string',
        enum: [
          'create',
          'query',
          'complete',
          'reschedule',
          'delete',
          'edit',
          'chat',
          'unclear',
        ],
      },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'title',
            'due_local',
            'in_minutes',
            'recurrence',
            'priority',
            'category',
            'lead_minutes',
            'notes',
          ],
          properties: {
            title: { type: 'string' },
            due_local: nullable('string'),
            in_minutes: nullable('integer'),
            recurrence: recurrenceSchema,
            priority: { type: 'string', enum: ['low', 'normal', 'high'] },
            category: nullable('string'),
            lead_minutes: nullable('integer'),
            notes: nullable('string'),
          },
        },
      },
      query_range: {
        anyOf: [
          { type: 'null' },
          {
            type: 'string',
            enum: ['today', 'tomorrow', 'week', 'overdue', 'inbox', 'all'],
          },
        ],
      },
      query_search: nullable('string'),
      targets: { type: 'array', items: { type: 'integer' } },
      due_local: nullable('string'),
      in_minutes: nullable('integer'),
      shift_minutes: nullable('integer'),
      new_title: nullable('string'),
      new_notes: nullable('string'),
      reply: nullable('string'),
      question: nullable('string'),
      options: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;
