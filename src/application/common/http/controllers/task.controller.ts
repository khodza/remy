import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { Throttle } from '@nestjs/throttler';
import { Domain } from '@common/tokens';
import { getEnv } from '@common/config';
import type { Task, TaskRepository } from '@domain/task';
import { TaskNotFoundError } from '@domain/task';
import type { User, UserRepository } from '@domain/user';
import { UserNotFoundError } from '@domain/user';
import {
  CreateStructuredTaskUsecase,
  DelayTaskUsecase,
  DeleteTaskUsecase,
  ListTasksUsecase,
  MarkCompleteUsecase,
  ProcessTextMessageUsecase,
  ProcessVoiceMessageUsecase,
  ReopenTaskUsecase,
  SkipOccurrenceUsecase,
  SnoozeTaskUsecase,
  UpdateTaskUsecase,
} from '@usecases/task';
import { ImportTasksUsecase } from '@usecases/data';
import {
  CreateTaskFromTextRequest,
  CreateTaskStructuredRequest,
  ImportTasksRequest,
  DelayTaskRequest,
  ListTasksQuery,
  SnoozeTaskRequest,
  UpdateTaskRequest,
  type CompleteResultWire,
  type DeleteResult,
  type TaskWire,
} from '@contract/remy-contract';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { recurrenceFromWire, toTaskWire } from '../mappers/task.mapper';
import type { AuthContext } from '../types';

const VOICE_MAX_BYTES = 20 * 1024 * 1024; // 20 MiB
const VOICE_ALLOWED_MIME_PREFIXES = ['audio/', 'video/webm'];

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TaskController {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
    private readonly listTasksUsecase: ListTasksUsecase,
    private readonly processTextMessageUsecase: ProcessTextMessageUsecase,
    private readonly processVoiceMessageUsecase: ProcessVoiceMessageUsecase,
    private readonly createStructuredTaskUsecase: CreateStructuredTaskUsecase,
    private readonly importTasksUsecase: ImportTasksUsecase,
    private readonly updateTaskUsecase: UpdateTaskUsecase,
    private readonly markCompleteUsecase: MarkCompleteUsecase,
    private readonly reopenTaskUsecase: ReopenTaskUsecase,
    private readonly delayTaskUsecase: DelayTaskUsecase,
    private readonly snoozeTaskUsecase: SnoozeTaskUsecase,
    private readonly deleteTaskUsecase: DeleteTaskUsecase,
    private readonly skipOccurrenceUsecase: SkipOccurrenceUsecase,
  ) {}

  @Get()
  async list(
    @CurrentUser() auth: AuthContext,
    @Query(new ZodValidationPipe(ListTasksQuery)) query: ListTasksQuery,
  ): Promise<{ tasks: TaskWire[] }> {
    const user = await this.requireUser(auth.userId);
    const result = await this.listTasksUsecase.execute({
      userId: auth.userId,
      view: query.view ?? 'all',
      includeCompleted: query.includeCompleted === 'true',
      timezone: zoneOf(user),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.list !== undefined ? { list: query.list } : {}),
      ...(query.q !== undefined ? { search: query.q } : {}),
    });
    const now = new Date();
    return { tasks: result.tasks.map((task) => toTaskWire(task, now)) };
  }

  @Get(':id')
  async getOne(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<TaskWire> {
    return toTaskWire(await this.requireOwnedTask(id, auth.userId));
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateTaskFromTextRequest))
    dto: CreateTaskFromTextRequest,
  ): Promise<TaskWire> {
    const user = await this.requireUser(auth.userId);
    const result = await this.processTextMessageUsecase.execute({
      userId: user.id,
      telegramChatId: user.telegramUserId,
      text: dto.text,
      userTimezone: zoneOf(user),
      source: { type: 'miniapp' },
    });
    return toTaskWire(await this.requireTask(result.taskId));
  }

  @Post('structured')
  async createStructured(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateTaskStructuredRequest))
    dto: CreateTaskStructuredRequest,
  ): Promise<TaskWire> {
    const user = await this.requireUser(auth.userId);
    const task = await this.createStructuredTaskUsecase.execute({
      userId: user.id,
      telegramChatId: user.telegramUserId,
      timezone: zoneOf(user),
      description: dto.description,
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      ...(dto.recurrence !== undefined
        ? {
            recurrence: dto.recurrence
              ? recurrenceFromWire(dto.recurrence)
              : null,
          }
        : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
      ...(dto.leadMinutes !== undefined
        ? { leadMinutes: dto.leadMinutes }
        : {}),
      ...(dto.allDay !== undefined ? { allDay: dto.allDay } : {}),
      ...(dto.list !== undefined ? { list: dto.list } : {}),
      ...(dto.originalText !== undefined
        ? { originalText: dto.originalText }
        : {}),
    });
    return toTaskWire(task);
  }

  /** Reviewed drafts from a pasted list, created in one go. */
  @Post('import')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async import(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(ImportTasksRequest)) dto: ImportTasksRequest,
  ): Promise<{ tasks: TaskWire[] }> {
    const created = await this.importTasksUsecase.execute({
      userId: auth.userId,
      tasks: dto.tasks.map((t) => ({
        description: t.description,
        ...(t.notes !== undefined ? { notes: t.notes } : {}),
        scheduledAt: t.scheduledAt ? new Date(t.scheduledAt) : null,
        ...(t.recurrence !== undefined
          ? {
              recurrence: t.recurrence
                ? recurrenceFromWire(t.recurrence)
                : null,
            }
          : {}),
        ...(t.priority !== undefined ? { priority: t.priority } : {}),
        ...(t.categoryId !== undefined ? { categoryId: t.categoryId } : {}),
        ...(t.leadMinutes !== undefined ? { leadMinutes: t.leadMinutes } : {}),
        ...(t.allDay !== undefined ? { allDay: t.allDay } : {}),
        ...(t.list !== undefined ? { list: t.list } : {}),
        ...(t.originalText !== undefined
          ? { originalText: t.originalText }
          : {}),
      })),
    });
    return { tasks: created.map((task) => toTaskWire(task)) };
  }

  @Post('voice')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: VOICE_MAX_BYTES },
    }),
  )
  async createFromVoice(
    @CurrentUser() auth: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<TaskWire> {
    if (!file) {
      throw new BadRequestException('audio file is required');
    }
    if (file.size === 0) {
      throw new BadRequestException('audio file is empty');
    }
    if (file.size > VOICE_MAX_BYTES) {
      throw new PayloadTooLargeException('audio file exceeds 20 MiB limit');
    }
    const mime = file.mimetype || 'application/octet-stream';
    if (
      !VOICE_ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
    ) {
      throw new BadRequestException(`unsupported audio mime type: ${mime}`);
    }

    const user = await this.requireUser(auth.userId);
    const result = await this.processVoiceMessageUsecase.execute({
      userId: user.id,
      telegramChatId: user.telegramUserId,
      audioFileBuffer: file.buffer,
      mimeType: mime,
      userTimezone: zoneOf(user),
      sourceType: 'miniapp',
    });
    return toTaskWire(await this.requireTask(result.taskId));
  }

  @Patch(':id')
  async update(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body(new ZodValidationPipe(UpdateTaskRequest)) dto: UpdateTaskRequest,
  ): Promise<TaskWire> {
    await this.requireOwnedTask(id, auth.userId);
    const updated = await this.updateTaskUsecase.execute({
      taskId: id,
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...(dto.scheduledAt !== undefined
        ? {
            scheduledAt:
              dto.scheduledAt === null ? null : new Date(dto.scheduledAt),
          }
        : {}),
      ...(dto.recurrence !== undefined
        ? {
            recurrence: dto.recurrence
              ? recurrenceFromWire(dto.recurrence)
              : null,
          }
        : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
      ...(dto.leadMinutes !== undefined
        ? { leadMinutes: dto.leadMinutes }
        : {}),
      ...(dto.allDay !== undefined ? { allDay: dto.allDay } : {}),
      ...(dto.list !== undefined ? { list: dto.list } : {}),
    });
    return toTaskWire(updated);
  }

  @Post(':id/complete')
  async complete(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<CompleteResultWire> {
    await this.requireOwnedTask(id, auth.userId);
    const { alreadyDone, ...task } = await this.markCompleteUsecase.execute({
      taskId: id,
    });
    return { ...toTaskWire(task), alreadyDone };
  }

  /** "Not this time" on a repeating task: next occurrence, no Done. */
  @Post(':id/skip')
  async skip(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<TaskWire> {
    await this.requireOwnedTask(id, auth.userId);
    return toTaskWire(await this.skipOccurrenceUsecase.execute({ taskId: id }));
  }

  @Post(':id/reopen')
  async reopen(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<TaskWire> {
    await this.requireOwnedTask(id, auth.userId);
    return toTaskWire(await this.reopenTaskUsecase.execute({ taskId: id }));
  }

  @Post(':id/delay')
  async delay(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body(new ZodValidationPipe(DelayTaskRequest)) dto: DelayTaskRequest,
  ): Promise<TaskWire> {
    await this.requireOwnedTask(id, auth.userId);
    const task = await this.delayTaskUsecase.execute({
      taskId: id,
      delayMinutes: dto.minutes,
    });
    return toTaskWire(task);
  }

  @Post(':id/snooze')
  async snooze(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body(new ZodValidationPipe(SnoozeTaskRequest)) dto: SnoozeTaskRequest,
  ): Promise<TaskWire> {
    await this.requireOwnedTask(id, auth.userId);
    const task = await this.snoozeTaskUsecase.execute({
      taskId: id,
      until: new Date(dto.until),
    });
    return toTaskWire(task);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<DeleteResult> {
    await this.requireOwnedTask(id, auth.userId);
    return this.deleteTaskUsecase.execute({ taskId: id });
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError(`User ${userId} not found`);
    return user;
  }

  private async requireTask(taskId: string): Promise<Task> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) throw new TaskNotFoundError(`Task ${taskId} not found`);
    return task;
  }

  private async requireOwnedTask(
    taskId: string,
    userId: string,
  ): Promise<Task> {
    const task = await this.requireTask(taskId);
    // Deleted tasks are gone as far as the API is concerned.
    if (task.status === 'deleted') {
      throw new TaskNotFoundError(`Task ${taskId} not found`);
    }
    if (task.userId !== userId) {
      throw new ForbiddenException('You do not own this task');
    }
    return task;
  }
}

function zoneOf(user: Pick<User, 'timezone'>): string {
  return user.timezone ?? getEnv().OWNER_TIMEZONE ?? 'UTC';
}
