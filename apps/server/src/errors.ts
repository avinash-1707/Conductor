/**
 * Typed domain errors. Handlers throw these; the central Fastify error handler
 * maps them to `{ error: { code, message } }` with the right status. Unexpected
 * errors log and return a generic 500 — never leak internals (code-standards).
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid request") {
    super(message, "validation_error", 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, "unauthorized", 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, "forbidden", 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, "not_found", 404);
  }
}
