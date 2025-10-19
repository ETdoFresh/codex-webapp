import type { NextFunction, Request, Response } from 'express';

type AsyncHandler<T extends Request = Request, U extends Response = Response> = (
  req: T,
  res: U,
  next: NextFunction
) => Promise<void>;

export const asyncHandler =
  <T extends Request, U extends Response>(handler: AsyncHandler<T, U>) =>
  (req: T, res: U, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };

export default asyncHandler;
