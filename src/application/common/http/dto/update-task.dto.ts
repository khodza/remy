import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const RECURRENCE_TYPES = [
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'every_n_days',
] as const;

export class RecurrenceDto {
  @IsIn(RECURRENCE_TYPES as unknown as string[])
  type!: (typeof RECURRENCE_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  intervalDays?: number;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  /** null clears recurrence; undefined leaves it unchanged. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @ValidateNested()
  @Type(() => RecurrenceDto)
  recurrence?: RecurrenceDto | null;
}
