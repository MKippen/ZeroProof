import 'express-session';
import 'express-serve-static-core';

interface SessionUser {
  id: number;
}

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    user?: SessionUser;
    credentialVersion?: string;
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

declare global {
  namespace Express {
    interface Request {
      authAccount?: {
        id: number;
        mustChangePassword: boolean;
        lastLogin: Date | null;
      };
    }
  }
}
