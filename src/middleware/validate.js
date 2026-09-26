import { AppError } from '../errors/AppError.js';

export const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse({ body: req.body, query: req.query, params: req.params, headers: req.headers });
  if (!result.success) {
    return next(new AppError(422, 'VALIDATION_ERROR', 'The request contains invalid data.', result.error.flatten()));
  }
  if (result.data.body !== undefined) req.body = result.data.body;
  if (result.data.params !== undefined) req.params = result.data.params;
  // Express 5 exposes query through a prototype getter, so shadow it with validated data.
  if (result.data.query !== undefined) Object.defineProperty(req, 'query', { value: result.data.query, configurable: true, enumerable: true });
  next();
};
