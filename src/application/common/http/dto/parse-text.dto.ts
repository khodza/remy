import { IsString, MaxLength, MinLength } from 'class-validator';

export class ParseTextDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;
}
