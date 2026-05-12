import type { MembershipRole } from '../auth/membership.js';

declare module 'express-serve-static-core' {
  interface Request {
    workspace?: { id: string; role: MembershipRole };
    session?: { id: string; userId: string };
  }
}

export {};
