import type { GroupRepo } from "./data";
import type { membershipFor } from "./data/membership";
import type { WorkersAiBinding } from "./platform/workers-ai";

export type AppBindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DEV_LOGIN?: string;
  /** YouTube Data API v3 の鍵（任意。無ければ動画は題名だけ）。使うのは platform/ だけ。DEC-014 */
  YOUTUBE_API_KEY?: string;
  /** Workers AI（鍵不要・無料枠）。「AI で読み取る」だけが src/api/ai/ 経由で使う。#36 */
  AI?: WorkersAiBinding;
  /** Gemini API の鍵（任意・無料枠）。動画を見て手順を読むときだけ platform/gemini.ts が使う。DEC-018 */
  GEMINI_API_KEY?: string;
  /** 裏で進める取り込み（Cloudflare Workflows・DEC-022）。無いとき（テスト等）はその場で読む */
  IMPORT_WORKFLOW?: {
    create: (opts: {
      id?: string;
      params: { jobId: string; groupId: string; url: string };
    }) => Promise<unknown>;
  };
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
    /** セッションから決めたグループ（裏の読み取りに渡すときだけ使う。DB は repo で触る） */
    groupId: string;
    repo: GroupRepo;
    membership: ReturnType<typeof membershipFor>;
  };
};
