import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class DelayTaskDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10080)
  minutes!: number;
}
