/**
 * End-to-end: the real AppModule over HTTP against an in-memory MongoDB.
 * Only Telegram is stubbed (no polling, no sends). Every response is checked
 * against the contract the frontend parses with.
 *
 *   npm run test:e2e
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TelegramBotService } from '@infra/bot/bot.service';
import { SendPendingRemindersUsecase } from '@usecases/task/send-pending-reminders';
import { SendDailyDigestsUsecase } from '@usecases/rhythm';
import { Domain } from '@common/tokens';
import type { TaskRepository } from '@domain/task';
import { formatInTimeZone } from 'date-fns-tz';
import {
  CalendarFeed,
  Category,
  CategoryList,
  DEFAULT_SETTINGS,
  ErrorBody,
  ExportResult,
  Settings,
  wire,
} from '@contract/remy-contract';
import type { InterpreterInput } from '@domain/assistant';

const MOCK_TG_ID = 123456789;

describe('Remy API (e2e)', () => {
  let mongod: MongoMemoryServer;
  let app: INestApplication;
  let token: string;
  // Everything the bot "sends" lands here.
  let messageSeq = 1000;
  const sendMessage = jest.fn(
    async (_chatId: number, _text: string, _other?: unknown) => ({
      message_id: ++messageSeq,
    }),
  );
  const sendDocument = jest.fn(
    async (_chatId: number, _file: unknown, _other?: unknown) => ({
      message_id: ++messageSeq,
    }),
  );
  // The assistant without OpenAI, one line at a time: "dentist" gets a
  // time tomorrow, anything else becomes a todo.
  const interpret = jest.fn(async (input: InterpreterInput) => {
    const dentist = /dentist/i.test(input.text);
    return {
      intent: 'create' as const,
      tasks: [
        {
          title: dentist ? 'Dentist' : 'Buy milk',
          dueAt: dentist ? new Date(input.now.getTime() + 24 * 3600_000) : null,
          recurrence: null,
          priority: dentist ? ('high' as const) : ('normal' as const),
          // Whatever category still exists (earlier tests delete some).
          categoryName: dentist ? (input.categories[0] ?? null) : null,
          leadMinutes: null,
          notes: null,
        },
      ],
    };
  });

  const api = () => request(app.getHttpServer());
  const authed = (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);
  const mockInitData = (userId = MOCK_TG_ID) =>
    `auth_date=${Math.floor(Date.now() / 1000)}&user=${encodeURIComponent(
      JSON.stringify({ id: userId, first_name: 'Dev' }),
    )}&signature=x&hash=dev-mock-hash`;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    // process.env wins over the developer's .env file.
    process.env['MONGODB_URI'] = mongod.getUri();
    process.env['DEV_ALLOW_MOCK_INITDATA'] = 'true';
    process.env['OWNER_TELEGRAM_ID'] = String(MOCK_TG_ID);
    process.env['OWNER_TIMEZONE'] = 'Asia/Tashkent';
    process.env['CORS_ORIGINS'] = '';

    // Importing AppModule early is fine: the Mongo URI and the auth switches
    // are read lazily (getEnv() re-reads process.env under NODE_ENV=test).
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TelegramBotService)
      .useValue({ getBot: () => ({ api: { sendMessage, sendDocument } }) })
      .overrideProvider(Domain.Assistant.InterpreterGateway)
      .useValue({ interpret })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await mongod?.stop();
  });

  it('health needs no auth', async () => {
    await api().get('/api/v1/health').expect(200);
  });

  it('rejects unauthenticated and foreign callers', async () => {
    const noToken = await api().get('/api/v1/tasks').expect(401);
    expect(() => ErrorBody.parse(noToken.body)).not.toThrow();

    await api()
      .post('/api/v1/auth/telegram')
      .set('Authorization', `tma ${mockInitData(999)}`)
      .expect(403); // owner lock
  });

  it('logs the owner in with mock initData and applies OWNER_TIMEZONE', async () => {
    const res = await api()
      .post('/api/v1/auth/telegram')
      .set('Authorization', `tma ${mockInitData()}`)
      .expect(201);
    const body = wire.AuthResult.parse(res.body);
    expect(body.user).toMatchObject({
      telegramUserId: MOCK_TG_ID,
      timezone: 'Asia/Tashkent',
    });
    token = body.token;

    const me = await authed(api().get('/api/v1/user/me')).expect(200);
    expect(wire.User.parse(me.body).timezone).toBe('Asia/Tashkent');
  });

  it('settings: defaults, nested partial update, validation', async () => {
    const initial = await authed(api().get('/api/v1/settings')).expect(200);
    expect(Settings.parse(initial.body)).toEqual(DEFAULT_SETTINGS);

    const patched = await authed(api().patch('/api/v1/settings'))
      .send({ defaultView: 'list', quietHours: { from: '22:30' } })
      .expect(200);
    expect(Settings.parse(patched.body)).toMatchObject({
      defaultView: 'list',
      quietHours: { ...DEFAULT_SETTINGS.quietHours, from: '22:30' },
    });

    await authed(api().patch('/api/v1/settings'))
      .send({ morningBrief: { time: '8am' } })
      .expect(400);
    await authed(api().patch('/api/v1/settings'))
      .send({ theme: 'dark' })
      .expect(400);
  });

  let healthCategoryId: string;

  it('categories: seeded defaults, create, update, duplicate, delete', async () => {
    const list = await authed(api().get('/api/v1/categories')).expect(200);
    const { categories } = CategoryList.parse(list.body);
    expect(categories.map((c) => c.name)).toEqual([
      'Work',
      'Home',
      'Health',
      'Errand',
      'Personal',
    ]);
    healthCategoryId = categories.find((c) => c.name === 'Health')!.id;

    const created = await authed(api().post('/api/v1/categories'))
      .send({
        name: 'Study',
        emoji: '📚',
        color: '#123456',
        keywords: ['Exam'],
      })
      .expect(201);
    const study = Category.parse(created.body);
    expect(study.keywords).toEqual(['exam']);

    await authed(api().post('/api/v1/categories'))
      .send({ name: 'study', emoji: '📚', color: '#123456' })
      .expect(400);

    const updated = await authed(api().patch(`/api/v1/categories/${study.id}`))
      .send({ color: '#000000' })
      .expect(200);
    expect(Category.parse(updated.body).color).toBe('#000000');

    await authed(api().delete(`/api/v1/categories/${study.id}`)).expect(200);
    await authed(api().delete(`/api/v1/categories/${study.id}`)).expect(404);
  });

  let reminderId: string;
  let todoId: string;
  const tomorrow = new Date(Date.now() + 26 * 60 * 60 * 1000);

  it('structured create: a categorised weekly reminder and a todo', async () => {
    const reminder = await authed(api().post('/api/v1/tasks/structured'))
      .send({
        description: '  Dentist ',
        notes: 'Ask for Friday',
        scheduledAt: tomorrow.toISOString(),
        recurrence: { type: 'weekly' },
        priority: 'high',
        categoryId: healthCategoryId,
        leadMinutes: 30,
        originalText: 'dentist tomorrow every week',
      })
      .expect(201);
    const task = wire.Task.parse(reminder.body);
    expect(task).toMatchObject({
      description: 'Dentist',
      kind: 'reminder',
      timezone: 'Asia/Tashkent',
      priority: 'high',
      categoryId: healthCategoryId,
      leadMinutes: 30,
      recurrence: { type: 'weekly' },
      nextFireAt: tomorrow.toISOString(),
      isOverdue: false,
      source: { type: 'miniapp', originalText: 'dentist tomorrow every week' },
    });
    reminderId = task.id;

    const todo = await authed(api().post('/api/v1/tasks/structured'))
      .send({ description: 'Learn plov' })
      .expect(201);
    expect(wire.Task.parse(todo.body)).toMatchObject({
      kind: 'todo',
      scheduledAt: null,
      nextFireAt: null,
    });
    todoId = todo.body.id;

    await authed(api().post('/api/v1/tasks/structured'))
      .send({ description: 'x', recurrence: { type: 'daily' } })
      .expect(400);
    await authed(api().post('/api/v1/tasks/structured'))
      .send({ description: 'x', categoryId: 'f'.repeat(24) })
      .expect(400);
  });

  it('views split reminders, todos and done', async () => {
    const ids = async (view: string) =>
      wire.TaskList.parse(
        (await authed(api().get(`/api/v1/tasks?view=${view}`)).expect(200))
          .body,
      ).tasks.map((t) => t.id);

    expect(await ids('inbox')).toEqual([todoId]);
    expect(await ids('upcoming')).toEqual([reminderId]);
    expect(await ids('today')).toEqual([]);
    expect((await ids('all')).sort()).toEqual([reminderId, todoId].sort());
    await authed(api().get('/api/v1/tasks?view=yesterday')).expect(400);
  });

  it('get, patch (null vs absent), validation and bad ids', async () => {
    const got = await authed(api().get(`/api/v1/tasks/${reminderId}`)).expect(
      200,
    );
    expect(wire.Task.parse(got.body).id).toBe(reminderId);

    const renamed = await authed(api().patch(`/api/v1/tasks/${reminderId}`))
      .send({ description: 'Dentist checkup', notes: null })
      .expect(200);
    expect(wire.Task.parse(renamed.body)).toMatchObject({
      description: 'Dentist checkup',
      notes: null,
      recurrence: { type: 'weekly' }, // untouched
      nextFireAt: tomorrow.toISOString(),
    });

    await authed(api().patch(`/api/v1/tasks/${reminderId}`))
      .send({ status: 'completed' })
      .expect(400);
    await authed(api().patch(`/api/v1/tasks/${reminderId}`))
      .send({ priority: 'urgent' })
      .expect(400);
    const badId = await authed(api().get('/api/v1/tasks/not-an-id')).expect(
      400,
    );
    expect(() => ErrorBody.parse(badId.body)).not.toThrow();
    await authed(api().get(`/api/v1/tasks/${'0'.repeat(24)}`)).expect(404);
  });

  it('snooze keeps the series, delay works from the snooze, todos cannot be snoozed', async () => {
    const until = new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000);
    const snoozed = await authed(
      api().post(`/api/v1/tasks/${reminderId}/snooze`),
    )
      .send({ until: until.toISOString() })
      .expect(201);
    expect(wire.Task.parse(snoozed.body)).toMatchObject({
      scheduledAt: tomorrow.toISOString(),
      snoozedUntil: until.toISOString(),
      nextFireAt: until.toISOString(),
    });

    const delayed = await authed(
      api().post(`/api/v1/tasks/${reminderId}/delay`),
    )
      .send({ minutes: 15 })
      .expect(201);
    expect(wire.Task.parse(delayed.body).nextFireAt).toBe(
      new Date(until.getTime() + 15 * 60 * 1000).toISOString(),
    );

    await authed(api().post(`/api/v1/tasks/${reminderId}/snooze`))
      .send({ until: new Date(Date.now() - 1000).toISOString() })
      .expect(400);
    await authed(api().post(`/api/v1/tasks/${todoId}/snooze`))
      .send({ until: until.toISOString() })
      .expect(400);
  });

  it('todo lifecycle: schedule it, unschedule it, complete, reopen, delete', async () => {
    const scheduled = await authed(api().patch(`/api/v1/tasks/${todoId}`))
      .send({ scheduledAt: tomorrow.toISOString() })
      .expect(200);
    expect(wire.Task.parse(scheduled.body).kind).toBe('reminder');

    const back = await authed(api().patch(`/api/v1/tasks/${todoId}`))
      .send({ scheduledAt: null })
      .expect(200);
    expect(wire.Task.parse(back.body)).toMatchObject({
      kind: 'todo',
      nextFireAt: null,
    });

    const done = await authed(
      api().post(`/api/v1/tasks/${todoId}/complete`),
    ).expect(201);
    expect(wire.Task.parse(done.body)).toMatchObject({ status: 'completed' });
    expect(done.body.completedAt).not.toBeNull();

    const doneList = await authed(
      api().get('/api/v1/tasks?view=done&limit=5'),
    ).expect(200);
    expect(wire.TaskList.parse(doneList.body).tasks.map((t) => t.id)).toEqual([
      todoId,
    ]);
    // Completed today → also part of "today".
    const today = await authed(api().get('/api/v1/tasks?view=today')).expect(
      200,
    );
    expect(wire.TaskList.parse(today.body).tasks.map((t) => t.id)).toEqual([
      todoId,
    ]);

    await authed(api().patch(`/api/v1/tasks/${todoId}`))
      .send({ notes: 'x' })
      .expect(400); // completed
    const reopened = await authed(
      api().post(`/api/v1/tasks/${todoId}/reopen`),
    ).expect(201);
    expect(wire.Task.parse(reopened.body)).toMatchObject({
      status: 'pending',
      completedAt: null,
    });

    await authed(api().delete(`/api/v1/tasks/${todoId}`)).expect(200, {
      success: true,
    });
    await authed(api().get(`/api/v1/tasks/${todoId}`)).expect(404);
  });

  it('completing a recurring task advances it and records the completion', async () => {
    // Fresh daily task that is already due.
    const dueAt = new Date(Date.now() - 60 * 60 * 1000);
    const created = await authed(api().post('/api/v1/tasks/structured'))
      .send({
        description: 'Vitamins',
        scheduledAt: dueAt.toISOString(),
        recurrence: { type: 'daily' },
      })
      .expect(201);
    expect(wire.Task.parse(created.body).isOverdue).toBe(true);

    const done = await authed(
      api().post(`/api/v1/tasks/${created.body.id}/complete`),
    ).expect(201);
    const after = wire.Task.parse(done.body);
    expect(after.status).toBe('pending');
    expect(after.completionsCount).toBe(1);
    expect(new Date(after.scheduledAt!).getTime()).toBe(
      dueAt.getTime() + 24 * 60 * 60 * 1000,
    );

    // Idempotent: a second tap does not skip tomorrow.
    const again = await authed(
      api().post(`/api/v1/tasks/${created.body.id}/complete`),
    ).expect(201);
    expect(wire.Task.parse(again.body).scheduledAt).toBe(after.scheduledAt);
    expect(again.body.completionsCount).toBe(1);
  });

  it('deleting a category uncategorises its tasks', async () => {
    await authed(api().delete(`/api/v1/categories/${healthCategoryId}`)).expect(
      200,
    );
    const task = await authed(api().get(`/api/v1/tasks/${reminderId}`)).expect(
      200,
    );
    expect(wire.Task.parse(task.body).categoryId).toBeNull();
  });

  it('the daily rhythm runs inside the real app: reminder → nudge scheduled, brief once per day', async () => {
    // Quiet hours would hold the reminder if this runs at night in Tashkent.
    await authed(api().patch('/api/v1/settings'))
      .send({
        quietHours: { enabled: false },
        morningBrief: {
          enabled: true,
          time: formatInTimeZone(new Date(), 'Asia/Tashkent', 'HH:mm'),
        },
      })
      .expect(200);

    const created = await authed(api().post('/api/v1/tasks/structured'))
      .send({
        description: 'Water the plants',
        scheduledAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      })
      .expect(201);
    const id: string = created.body.id;

    sendMessage.mockClear();
    const reminders = await app.get(SendPendingRemindersUsecase).execute();
    expect(reminders.sentCount).toBeGreaterThanOrEqual(1);
    const reminderCall = sendMessage.mock.calls.find((c) =>
      String(c[1]).includes('Water the plants'),
    );
    expect(reminderCall?.[1]).toContain('Reminder');
    // Escalation is on by default: the first nudge is 30 minutes out.
    const stored = await app
      .get<TaskRepository>(Domain.Task.Repository)
      .findById(id);
    expect(stored?.nudgeAt?.getTime()).toBeGreaterThan(
      Date.now() + 29 * 60_000,
    );
    expect(stored?.nudgeCount).toBe(0);

    sendMessage.mockClear();
    const digests = app.get(SendDailyDigestsUsecase);
    const first = await digests.execute();
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const brief = sendMessage.mock.calls.find((c) =>
      String(c[1]).includes('Good morning'),
    );
    expect(brief?.[1]).toContain('Water the plants');
    expect((await digests.execute()).sent).toBe(0); // once per local day
  });
  it('calendar feed: off by default; a public .ics once on; a new link retires the old one', async () => {
    const off = CalendarFeed.parse(
      (await authed(api().get('/api/v1/calendar/feed')).expect(200)).body,
    );
    expect(off).toEqual({ enabled: false, path: null });

    await authed(api().post('/api/v1/tasks/structured'))
      .send({
        description: 'Standup; notes, then coffee',
        scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
        recurrence: { type: 'weekdays' },
      })
      .expect(201);

    const on = CalendarFeed.parse(
      (await authed(api().post('/api/v1/calendar/feed')).expect(201)).body,
    );
    expect(on.path).toMatch(/^\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);

    // No JWT: the secret in the path is the credential.
    const ics = await api().get(`/api/v1${on.path}`).expect(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toContain('BEGIN:VCALENDAR');
    expect(ics.text).toContain(
      String.raw`SUMMARY:Standup\; notes\, then coffee`,
    );
    expect(ics.text).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(ics.text).toContain('DTSTART;TZID=Asia/Tashkent:');

    const renewed = CalendarFeed.parse(
      (await authed(api().post('/api/v1/calendar/feed')).expect(201)).body,
    );
    expect(renewed.path).not.toBe(on.path);
    await api().get(`/api/v1${on.path}`).expect(404);
    await api().get(`/api/v1${renewed.path}`).expect(200);

    await authed(api().delete('/api/v1/calendar/feed')).expect(200);
    await api().get(`/api/v1${renewed.path}`).expect(404);
    await api().get('/api/v1/calendar/not-a-token.ics').expect(404);
    await api().get('/api/v1/calendar/feed').expect(401);
  });

  it('export: the bot sends the file to the owner chat', async () => {
    sendDocument.mockClear();
    const res = await authed(api().post('/api/v1/export'))
      .send({ format: 'csv' })
      .expect(200);
    const result = ExportResult.parse(res.body);
    expect(result.filename).toMatch(/^remy-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.tasks).toBeGreaterThan(0);
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(sendDocument.mock.calls[0]![0]).toBe(MOCK_TG_ID);

    await authed(api().post('/api/v1/export'))
      .send({ format: 'pdf' })
      .expect(400);
  });

  it('list import: parse into reviewable drafts, then create them in one go', async () => {
    const parsed = await authed(api().post('/api/v1/ai/parse-list'))
      .send({ text: '- dentist tomorrow\n- buy milk' })
      .expect(201);
    const { tasks: drafts } = wire.ImportDrafts.parse(parsed.body);
    expect(drafts.map((d) => [d.description, d.scheduledAt === null])).toEqual([
      ['Dentist', false],
      ['Buy milk', true],
    ]);
    expect(drafts[0]!.categoryId).toEqual(expect.any(String));

    const created = await authed(api().post('/api/v1/tasks/import'))
      .send({
        tasks: drafts.map((d) => ({
          description: d.description,
          scheduledAt: d.scheduledAt,
          priority: d.priority,
          categoryId: d.categoryId,
        })),
      })
      .expect(201);
    const { tasks } = wire.TaskList.parse(created.body);
    expect(tasks.map((t) => [t.description, t.kind])).toEqual([
      ['Dentist', 'reminder'],
      ['Buy milk', 'todo'],
    ]);

    // A bad row fails the whole import; nothing half-saved.
    const before = wire.TaskList.parse(
      (await authed(api().get('/api/v1/tasks?view=inbox')).expect(200)).body,
    ).tasks.length;
    await authed(api().post('/api/v1/tasks/import'))
      .send({
        tasks: [
          { description: 'Fine' },
          { description: 'Broken', recurrence: { type: 'daily' } },
        ],
      })
      .expect(400);
    const after = wire.TaskList.parse(
      (await authed(api().get('/api/v1/tasks?view=inbox')).expect(200)).body,
    ).tasks.length;
    expect(after).toBe(before);
  });
});
