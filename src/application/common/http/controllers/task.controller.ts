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
import { Domain } from '@common/tokens';
import type { Task, TaskRepository } from '@domain/task';
import { TaskNotFoundError } from '@domain/task';
import type { UserRepository } from '@domain/user';
import { UserNotFoundError } from '@domain/user';
import {
  DelayTaskUsecase,
  DeleteTaskUsecase,
  ListTasksUsecase,
  MarkCompleteUsecase,
  ProcessTextMessageUsecase,
  ProcessVoiceMessageUsecase,
} from '@usecases/task';
import type { TaskWithOverdueFlag } from '@usecases/task';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CreateTaskDto } from '../dto/create-task.dto';
import { DelayTaskDto } from '../dto/delay-task.dto';
import { ListTasksQueryDto } from '../dto/list-tasks-query.dto';
import { UpdateTaskDto } from '../dto/update-task.dto';
import type { AuthContext } from '../types';

const VOICE_MAX_BYTES = 20 * 1024 * 1024; // 20 MiB
const VOICE_ALLOWED_MIME_PREFIXES = ['audio/', 'video/webm'];

export interface TaskDto {
  id: string;
  description: string;
  scheduledAt: string;
  status: Task['status'];
  isOverdue?: boolean;
  createdAt: string;
  updatedAt: string;
}

function toDto(task: Task | TaskWithOverdueFlag): TaskDto {
  const dto: TaskDto = {
    id: task.id,
    description: task.description,
    scheduledAt: task.scheduledAt.toISOString(),
    status: task.status,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
  if ('isOverdue' in task) dto.isOverdue = task.isOverdue;
  return dto;
}

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
    private readonly markCompleteUsecase: MarkCompleteUsecase,
    private readonly delayTaskUsecase: DelayTaskUsecase,
    private readonly deleteTaskUsecase: DeleteTaskUsecase,
  ) {}

  @Get()
  async list(
    @CurrentUser() auth: AuthContext,
    @Query() query: ListTasksQueryDto,
  ): Promise<{ tasks: TaskDto[] }> {
    const result = await this.listTasksUsecase.execute({
      userId: auth.userId,
      includeCompleted: query.includeCompleted === 'true',
    });
    return { tasks: result.tasks.map(toDto) };
  }

  @Post()
  async create(
    @CurrentUser() auth: AuthContext,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskDto> {
    const user = await this.userRepository.findById(auth.userId);
    if (!user) {
      throw new UserNotFoundError(`User ${auth.userId} not found`);
    }

    const result = await this.processTextMessageUsecase.execute({
      userId: user.id,
      telegramChatId: user.telegramUserId,
      text: dto.text,
      ...(user.timezone ? { userTimezone: user.timezone } : {}),
    });

    const task = await this.taskRepository.findById(result.taskId);
    if (!task) {
      throw new TaskNotFoundError(`Task ${result.taskId} not found after create`);
    }
    return toDto(task);
  }

  @Post('voice')
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: VOICE_MAX_BYTES },
    }),
  )
  async createFromVoice(
    @CurrentUser() auth: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<TaskDto> {
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
    if (!VOICE_ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
      throw new BadRequestException(`unsupported audio mime type: ${mime}`);
    }

    const user = await this.userRepository.findById(auth.userId);
    if (!user) {
      throw new UserNotFoundError(`User ${auth.userId} not found`);
    }

    const result = await this.processVoiceMessageUsecase.execute({
      userId: user.id,
      telegramChatId: user.telegramUserId,
      audioFileBuffer: file.buffer,
      mimeType: mime,
      ...(user.timezone ? { userTimezone: user.timezone } : {}),
    });

    const task = await this.taskRepository.findById(result.taskId);
    if (!task) {
      throw new TaskNotFoundError(
        `Task ${result.taskId} not found after create`,
      );
    }
    return toDto(task);
  }

  @Patch(':id')
  async update(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskDto> {
    await this.requireOwnedTask(id, auth.userId);
    const updated = await this.taskRepository.update({
      id,
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.scheduledAt !== undefined
        ? { scheduledAt: new Date(dto.scheduledAt) }
        : {}),
    });
    return toDto(updated);
  }

  @Post(':id/complete')
  async complete(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<TaskDto> {
    await this.requireOwnedTask(id, auth.userId);
    const task = await this.markCompleteUsecase.execute({ taskId: id });
    return toDto(task);
  }

  @Post(':id/delay')
  async delay(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: DelayTaskDto,
  ): Promise<TaskDto> {
    await this.requireOwnedTask(id, auth.userId);
    const task = await this.delayTaskUsecase.execute({
      taskId: id,
      delayMinutes: dto.minutes,
    });
    return toDto(task);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.requireOwnedTask(id, auth.userId);
    return this.deleteTaskUsecase.execute({ taskId: id });
  }

  private async requireOwnedTask(taskId: string, userId: string): Promise<Task> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(`Task ${taskId} not found`);
    }
    if (task.userId !== userId) {
      throw new ForbiddenException('You do not own this task');
    }
    return task;
  }
}
