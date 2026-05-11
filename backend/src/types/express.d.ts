import 'express-session';
import 'express-serve-static-core';

interface SessionUser {
  id: number;
}

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    user?: SessionUser;
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

