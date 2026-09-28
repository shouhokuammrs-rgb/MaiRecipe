// D1（SQLite）のテーブル定義。SQL は Postgres に移せる普通の書き方にする（DEC-008）。
// ユーザーの持ち物は group_id で持つ（1人でも必ずグループに入る。DEC-004）。
import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch() * 1000)`;
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull().default(now);
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(now)
    .$onUpdate(() => new Date());

// ---- Better Auth（テーブル名・列名は Better Auth の既定に合わせる）
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---- グループ（共有の単位。M5 で招待を足す）
export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const groupMembers = sqliteTable(
  "group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] })
      .notNull()
      .default("owner"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("group_members_user_idx").on(t.userId),
  ],
);

// ---- レシピ（中身は版ごとに recipe_versions に持つ）
export const recipes = sqliteTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** 最新版の見出し（一覧で毎回版を読まないための写し） */
    title: text("title").notNull(),
    category: text("category").notNull(),
    genre: text("genre").notNull(),
    timeLabel: text("time_label").notNull().default(""),
    /** 出典。取り込んだレシピは消せない（DEC-011） */
    sourceUrl: text("source_url"),
    videoUrl: text("video_url"),
    origin: text("origin", { enum: ["import", "own"] })
      .notNull()
      .default("import"),
    /** 将来の SNS 用。今は常に private */
    visibility: text("visibility", { enum: ["private", "public"] })
      .notNull()
      .default("private"),
    hasImage: integer("has_image", { mode: "boolean" })
      .notNull()
      .default(false),
    /** 版の通し番号のカウンタ。版を消しても戻さない（番号を詰めない） */
    lastSeq: integer("last_seq").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("recipes_group_idx").on(t.groupId, t.updatedAt)],
);

export const recipeVersions = sqliteTable(
  "recipe_versions",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** 1 始まりの通し番号。消しても詰めない */
    seq: integer("seq").notNull(),
    kind: text("kind", { enum: ["original", "memo", "manual"] }).notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    genre: text("genre").notNull(),
    timeLabel: text("time_label").notNull().default(""),
    /** JSON: {name, amount}[] */
    ingredients: text("ingredients", { mode: "json" })
      .notNull()
      .$type<{ name: string; amount: string }[]>(),
    /** JSON: string[] */
    steps: text("steps", { mode: "json" }).notNull().$type<string[]>(),
    /** JSON: string[]（前の版との差分を人が読める形で） */
    changes: text("changes", { mode: "json" }).notNull().$type<string[]>(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("recipe_versions_seq_uq").on(t.recipeId, t.seq),
    index("recipe_versions_group_idx").on(t.groupId),
  ],
);

export const recipeMemos = sqliteTable(
  "recipe_memos",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    /** このメモを反映して作った版（版を消したら null に戻る） */
    appliedVersionId: text("applied_version_id").references(
      () => recipeVersions.id,
      {
        onDelete: "set null",
      },
    ),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index("recipe_memos_recipe_idx").on(t.recipeId)],
);

/** 写真は当面 D1 に置く（1枚 1MB 以下に縮めてから。R2 は公開時。DEC-008） */
export const recipeImages = sqliteTable("recipe_images", {
  recipeId: text("recipe_id")
    .primaryKey()
    .references(() => recipes.id, { onDelete: "cascade" }),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
  createdAt: createdAt(),
});

// ---- 献立（日付 × 朝昼晩に1品）
export const mealPlans = sqliteTable(
  "meal_plans",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    meal: text("meal", { enum: ["breakfast", "lunch", "dinner"] }).notNull(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("meal_plans_slot_uq").on(t.groupId, t.date, t.meal)],
);

// ---- 買い物リストの印（家にある / 買った）。キーは「材料名|単位」
export const shoppingMarks = sqliteTable(
  "shopping_marks",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    kind: text("kind", { enum: ["home", "bought"] }).notNull(),
    value: integer("value", { mode: "boolean" }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.key, t.kind] })],
);

// ---- 招待（相手の Google のメールアドレス宛て。参加・取り消しで行を消す）
export const groupInvites = sqliteTable(
  "group_invites",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** 小文字・前後の空白なしにそろえたアドレス */
    email: text("email").notNull(),
    invitedBy: text("invited_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("group_invites_email_uq").on(t.groupId, t.email),
    index("group_invites_email_idx").on(t.email),
  ],
);

// ---- 取り込みで読めなかった URL の報告（URL だけ。後で Issue にして読み取りを直す）
export const importReports = sqliteTable(
  "import_reports",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("import_reports_url_uq").on(t.groupId, t.url)],
);
