import { IsString, Length } from 'class-validator';

export class UpdateTimezoneDto {
  @IsString()
  @Length(1, 100)
  timezone!: string;
}
