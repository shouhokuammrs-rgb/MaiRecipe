import { Hono } from "hono";
import type { AppEnv } from "./app-env";
import { createAuth, hasGoogle, isDevLogin } from "./auth";
import { handleError } from "./errors";
import { group, invites } from "./routes/group";
import { importer } from "./routes/importer";
import { pantry } from "./routes/pantry";
import { plans, shopping } from "./routes/plans";
import { recipes } from "./routes/recipes";
import { recommend } from "./routes/recommend";
import { requireUser } from "./auth/session";

const app = new Hono<AppEnv>();
app.onError(handleError);

app.get("/api/health", (c) => c.json({ ok: true }));

// ログイン画面に出す方式（Google の鍵が入っているか、ローカルの仮ログインか）
app.get("/api/config", (c) =>
  c.json({ googleLogin: hasGoogle(c.env), devLogin: isDevLogin(c.env) }),
);

app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw),
);

const api = new Hono<AppEnv>();
api.use("*", requireUser);
api.get("/me", (c) => c.json({ userId: c.var.userId }));
api.route("/recipes", recipes);
api.route("/import", importer);
api.route("/plans", plans);
api.route("/shopping", shopping);
api.route("/pantry", pantry);
api.route("/recommend", recommend);
api.route("/group", group);
api.route("/invites", invites);

app.route("/api", api);

app.all("/api/*", (c) => c.json({ error: "見つかりません" }, 404));

export default app;
