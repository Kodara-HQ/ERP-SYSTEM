export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFound(entity: string): HttpError {
  return new HttpError(404, `${entity} was not found.`);
}
