declare module 'express-serve-static-core' {
  interface Request {
    workspace?: { id: string; role: 'owner' | 'admin' | 'member' };
    session?: { id: string; userId: string };
  }
}

export {};
