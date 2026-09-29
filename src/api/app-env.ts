import type { GroupRepo } from "./data";
import type { membershipFor } from "./data/membership";

export type AppBindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DEV_LOGIN?: string;
  /** YouTube Data API v3 の鍵（任意。無ければ動画は題名だけ）。使うのは platform/ だけ。DEC-014 */
  YOUTUBE_API_KEY?: string;
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
};

export type AppEnv = {
  Bindings: AppBindings;
  Variables: {
    userId: string;
    user: SessionUser;
    repo: GroupRepo;
    membership: ReturnType<typeof membershipFor>;
  };
};
