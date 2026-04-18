import { IsBooleanString, IsOptional } from 'class-validator';

export class ListTasksQueryDto {
  @IsOptional()
  @IsBooleanString()
  includeCompleted?: string;
}
