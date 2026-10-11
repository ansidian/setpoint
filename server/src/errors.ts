// Errors carry a stable code for the web app and an HTTP status for the API (darma's pattern).
import type {z} from 'zod';

export class SetpointError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'SetpointError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const invalid = (message: string, details?: unknown) => new SetpointError('invalid_input', message, 400, details);
export const unauthorized = (message: string, code = 'unauthorized') => new SetpointError(code, message, 401);
export const forbidden = (message: string, code = 'forbidden') => new SetpointError(code, message, 403);
export const notFound = (message: string) => new SetpointError('not_found', message, 404);
export const conflict = (code: string, message: string, details?: unknown) => new SetpointError(code, message, 409, details);
export const tooMany = (message: string, details?: unknown) => new SetpointError('too_many_attempts', message, 429, details);

/** Parses input with a shared schema, or refuses it with each problem named. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map(issue => ({path: issue.path.join('.'), message: issue.message}));
    throw invalid(issues.map(issue => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join('; '), issues);
  }
  return result.data;
}
