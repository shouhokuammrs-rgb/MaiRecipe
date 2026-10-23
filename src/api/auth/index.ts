// Better Auth の設定。ログインは Google のみ（DEC-009）。
// DEV_LOGIN=1 のときだけ、Google なしで試せるメール + パスワードを出す（ローカル開発・テスト用）。
// Workers 無料プランの CPU 10ms ではパスワード処理が間に合わないため、本番では有効にしない。
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../data/schema";
import { canSignUp } from "../data/membership";

export type AuthEnv = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DEV_LOGIN?: string;
};

export function isDevLogin(env: AuthEnv): boolean {
  return env.DEV_LOGIN === "1";
}

export function hasGoogle(env: AuthEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function createAuth(env: AuthEnv) {
  const db = drizzle(env.DB, { schema });
  return betterAuth({
    appName: "MaiRecipe",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: isDevLogin(env),
      autoSignIn: true,
    },
    socialProviders: hasGoogle(env)
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
          },
        }
      : {},
    // 招待制（DEC-026）：新しいアカウントは、招待されたメールの人だけ作れる。
    // ローカル開発・テスト（DEV_LOGIN=1）だけは誰でも作れる
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (isDevLogin(env)) return;
            // 確認済みのメールだけ（招待への参加と同じ決まり。membership.ts）
            if (
              !user.email ||
              user.emailVerified !== true ||
              !(await canSignUp(db, user.email))
            )
              return false;
          },
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    telemetry: { enabled: false },
  });
}

export async function getSessionUser(env: AuthEnv, headers: Headers) {
  const auth = createAuth(env);
  const s = await auth.api.getSession({ headers });
  return s?.user ?? null;
}
