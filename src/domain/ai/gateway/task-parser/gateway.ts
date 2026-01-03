import { TaskParserInput, TaskParserOutput } from './types';

export interface TaskParserGateway {
  parse(input: TaskParserInput): Promise<TaskParserOutput>;
}
