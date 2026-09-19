import type { Interpretation, InterpreterInput } from './types';

export interface InterpreterGateway {
  interpret(input: InterpreterInput): Promise<Interpretation>;
}
