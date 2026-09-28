import type { GroupRepo } from "./data";

export type AppBindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DEV_LOGIN?: string;
};

export type AppEnv = {
  Bindings: AppBindings;
  Variables: { userId: string; repo: GroupRepo };
};
