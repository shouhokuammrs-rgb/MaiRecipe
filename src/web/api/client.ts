// 画面から API を呼ぶ唯一の窓口。src/web の他の場所からは fetch を直接使わない。
import type {
  Category,
  Genre,
  Meal,
  ShopSection,
} from "../../shared/constants";
import type { FindResult } from "../../shared/find";
import type { Ingredient } from "../../shared/recipe";
import type { RecoLists } from "../../shared/recommend";
import type { Tip } from "../../shared/tips";
import type { MemoChange } from "../../shared/memo-apply";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, {
    ...init,
    headers,
    body,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new ApiError(
      data.error ?? `エラーが起きました（${res.status}）`,
      res.status,
    );
  }
  return data as T;
}

export type AppConfig = { googleLogin: boolean; devLogin: boolean };

export type RecipeHeader = {
  id: string;
  title: string;
  category: Category;
  genre: Genre;
  timeLabel: string;
  hasImage: boolean;
  /** 出典の画像の URL（null：まだ探していない・""：無かった）。DEC-023 */
  coverUrl: string | null;
  videoUrl: string | null;
  sourceUrl: string | null;
  versionCount: number;
  updatedAt: number;
};

export type Version = {
  id: string;
  seq: number;
  kind: "original" | "memo" | "manual";
  title: string;
  /** 何人分か（null：分からない・0：出典にも書いていなかった） */
  servings: number | null;
  ingredients: Ingredient[];
  steps: string[];
  /** コツ・ポイント（DEC-024）。前の版の API では無いことがある */
  tips?: Tip[];
  /** 手順ごとの、動画の中の開始の秒（無ければ空・前の版の API では無い） */
  stepTimes?: (number | null)[];
  changes: string[];
  createdAt: number;
};

export type Memo = {
  id: string;
  text: string;
  appliedVersionId: string | null;
  createdAt: number;
};

export type Rating = "again" | "ok" | "meh";
/** 作った記録（DEC-030）。評価と食べた人は名前で来る */
export type CookedEntry = {
  id: string;
  versionSeq: number | null;
  servings: number;
  cookedOn: string;
  cookedBy: string;
  note: string;
  myRating: Rating | null;
  ratings: { name: string; rating: Rating }[];
  eaters: string[];
  createdAt: number;
};
export type CookedStats = {
  count: number;
  lastCookedOn: string | null;
  again: number;
  myLatestRating: Rating | null;
};

export type RecipeDetail = Omit<RecipeHeader, "versionCount"> & {
  origin: "import" | "own" | "ai";
  createdAt: number;
  versions: Version[];
  memos: Memo[];
  cooked: CookedEntry[];
  cookedStats: CookedStats;
};

export type RecipeFields = {
  title: string;
  category: Category;
  genre: Genre;
  timeLabel: string;
  /** 何人分か。分からなければ null */
  servings: number | null;
  ingredients: Ingredient[];
  steps: string[];
  tips?: Tip[];
  stepTimes?: (number | null)[];
};

export type ImportDraft = RecipeFields & {
  /** 写真から読んだときは null */
  sourceUrl: string | null;
  videoUrl: string | null;
  /** 出典の画像（ページの共有用の画像）。"" は無し */
  coverUrl?: string | null;
};
export type ImportResult = {
  kind: "video" | "page" | "photo";
  found: boolean;
  draft: ImportDraft;
  message: string;
  /** 確かめてほしいこと（全体の量と内訳の重なりなど） */
  notice?: string | null;
};

/** 裏で進める取り込み（DEC-022） */
export type ImportJob = {
  id: string;
  url: string;
  /** 保存済みのレシピの読み直しなら、そのレシピ（結果は新しい版として保存する） */
  recipeId?: string | null;
  status: "running" | "done" | "failed";
  result: ImportResult | null;
  error: string | null;
  createdAt: number;
};

/** AI の献立の案（1つの枠＝日付×食事） */
export type PlanSuggestionView = {
  date: string;
  meal: Meal;
  reason: string;
  recipeIds: string[];
  recipes: { id: string; title: string; category: string }[];
};

export type PlanEntry = {
  id: string;
  date: string;
  meal: Meal;
  /** 枠の中の並び順（小さいほど上） */
  position: number;
  recipeId: string;
  /** この献立で何人分作るか。null はふだん作る人数 */
  servings?: number | null;
  title: string;
  category: Category;
};

export type GroupInfo = {
  name: string;
  /** ふだん作る人数（買い物リストの換算に使う） */
  servings: number;
  members: {
    id: string;
    name: string;
    isMe: boolean;
    role: "owner" | "member";
  }[];
  invites: { id: string; email: string }[];
};
export type MyInvite = { id: string; groupName: string; invitedBy: string };
export type AcceptResult = { movedRecipes: number };

export type ShopItem = {
  key: string;
  name: string;
  amount: string;
  section: ShopSection;
  recipes: string[];
  merged: string[];
  have: boolean;
};

export type PantryItem = {
  id: string;
  name: string;
  amount: string | null;
  expiresOn: string | null;
  addedOn: string;
};

export const apiClient = {
  config: () => call<AppConfig>("/config"),
  me: () => call<{ userId: string }>("/me"),

  listRecipes: (p: { q?: string; category?: string; genre?: string }) => {
    const qs = new URLSearchParams();
    if (p.q) qs.set("q", p.q);
    if (p.category) qs.set("category", p.category);
    if (p.genre) qs.set("genre", p.genre);
    return call<{ recipes: RecipeHeader[] }>(`/recipes?${qs.toString()}`).then(
      (r) => r.recipes,
    );
  },
  getRecipe: (id: string) =>
    call<{ recipe: RecipeDetail }>(`/recipes/${id}`).then((r) => r.recipe),
  createRecipe: (
    input: RecipeFields & {
      sourceUrl: string | null;
      videoUrl: string | null;
      coverUrl?: string | null;
      origin: "import" | "own" | "ai";
    },
  ) => call<{ id: string }>("/recipes", { method: "POST", json: input }),
  /** 冷蔵庫の食材から AI に新しいレシピを考えてもらう（出典なし。保存はしない。DEC-029） */
  recipeIdeas: (input: { use: string[]; wish: string }) =>
    call<{ ideas: RecipeFields[] }>("/recipes/ideas", {
      method: "POST",
      json: input,
    }),
  /** 前に保存したレシピの表紙を、出典のページから一度だけ探す（DEC-023） */
  findCover: (id: string) =>
    call<{ coverUrl: string | null }>(`/recipes/${id}/cover`, {
      method: "POST",
    }),
  /** 前に保存したレシピの人数を、出典から一度だけ探す（0：書いていなかった） */
  findServings: (id: string) =>
    call<{ servings: number | null }>(`/recipes/${id}/servings`, {
      method: "POST",
    }),
  /** 同じ出典のレシピが保存済みか（無ければ null） */
  findBySource: (url: string) =>
    call<{ recipe: { id: string; title: string } | null }>(
      `/recipes/by-source?url=${encodeURIComponent(url)}`,
    ).then((r) => r.recipe),
  /** メモから AI に変更案を出してもらう（保存はしない） */
  suggestMemoChanges: (id: string, memoId: string) =>
    call<{ versionId: string; changes: MemoChange[] }>(
      `/recipes/${encodeURIComponent(id)}/memos/${encodeURIComponent(memoId)}/suggest`,
      { method: "POST" },
    ),
  /** 作った！（DEC-030）。作った記録は共有、食べた人の記録と評価は本人のもの */
  addCooked: (
    recipeId: string,
    input: {
      versionId: string | null;
      servings: number;
      eaters: { userId: string; portion: number }[];
      rating: Rating | null;
      note: string;
      usedPantryIds: string[];
    },
  ) =>
    call<{ id: string }>(`/recipes/${recipeId}/cooked`, {
      method: "POST",
      json: input,
    }),
  rateCooked: (id: string, rating: Rating | null) =>
    call<void>(`/cooked/${id}/rating`, { method: "PUT", json: { rating } }),
  deleteCooked: (id: string) =>
    call<void>(`/cooked/${id}`, { method: "DELETE" }),
  deleteRecipe: (id: string) =>
    call<void>(`/recipes/${id}`, { method: "DELETE" }),
  addVersion: (id: string, input: RecipeFields & { memoId?: string }) =>
    call<
      | { unchanged: true }
      | { versionId: string; seq: number; changes: string[] }
    >(`/recipes/${id}/versions`, {
      method: "POST",
      json: input,
    }),
  deleteVersion: (id: string, versionId: string) =>
    call<void>(`/recipes/${id}/versions/${versionId}`, { method: "DELETE" }),
  addMemo: (id: string, text: string) =>
    call<{ id: string }>(`/recipes/${id}/memos`, {
      method: "POST",
      json: { text },
    }),
  deleteMemo: (id: string, memoId: string) =>
    call<void>(`/recipes/${id}/memos/${memoId}`, { method: "DELETE" }),
  putImage: (id: string, blob: Blob) =>
    call<void>(`/recipes/${id}/image`, {
      method: "PUT",
      body: blob,
      headers: { "content-type": blob.type },
    }),
  deleteImage: (id: string) =>
    call<void>(`/recipes/${id}/image`, { method: "DELETE" }),
  imageUrl: (id: string, bust: number) => `/api/recipes/${id}/image?v=${bust}`,
  find: (terms: string[]) =>
    call<{ results: FindResult[] }>("/recipes/find", {
      method: "POST",
      json: { terms },
    }).then((r) => r.results),

  importUrl: (url: string) =>
    call<ImportResult>("/import", { method: "POST", json: { url } }),
  /** 裏で読み取りを始める（すぐ返る。DEC-022） */
  startImport: (url: string) =>
    call<{ id: string }>("/import/jobs", { method: "POST", json: { url } }),
  /** 保存済みのレシピを、出典から裏で読み直す */
  rereadRecipe: (id: string) =>
    call<{ id: string }>(`/recipes/${encodeURIComponent(id)}/reread`, {
      method: "POST",
    }),
  importJobs: () => call<{ jobs: ImportJob[] }>("/import/jobs"),
  dismissImportJob: (id: string) =>
    call<null>(`/import/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** お料理アシスタントに相談する（DEC-021）。保存はしない */
  assist: (input: {
    recipeId: string;
    versionId?: string;
    stepIndex: number;
    people?: number;
    question: string;
    history: { role: "user" | "assistant"; text: string }[];
  }) =>
    call<{
      answer: string;
      action:
        | { type: "timer"; seconds: number; label?: string }
        | { type: "step"; number: number }
        | null;
    }>("/assist", { method: "POST", json: input }),
  /** 料理本の写真（縮めた JPEG の base64）から読む。保存はしない */
  importPhoto: (jpegBase64: string) =>
    call<ImportResult>("/import/photo", {
      method: "POST",
      body: jpegBase64,
      headers: { "content-type": "text/plain" },
    }),
  /** AI（無料）で読み取る。押した時だけ（DEC-012）。保存はしない */
  importAi: (input: { url?: string; text?: string; title?: string }) =>
    call<ImportResult>("/import/ai", { method: "POST", json: input }),
  reportImport: (url: string) =>
    call<{ ok: true }>("/import/reports", { method: "POST", json: { url } }),
  importReports: () =>
    call<{ reports: { url: string; createdAt: number }[] }>("/import/reports"),

  plans: (from: string, to: string) =>
    call<{ plans: PlanEntry[]; today: string }>(`/plans?from=${from}&to=${to}`),
  /** 保存しているレシピから AI に献立を考えてもらう（保存はしない） */
  suggestPlan: (input: { days: number; meals: Meal[]; wish: string }) =>
    call<{ suggestions: PlanSuggestionView[] }>("/plans/suggest", {
      method: "POST",
      json: input,
    }),
  /** 枠の最後に1品足す（同じレシピが既にあれば何もしない） */
  addPlan: (date: string, meal: Meal, recipeId: string) =>
    call<void>("/plans", { method: "PUT", json: { date, meal, recipeId } }),
  deletePlanItem: (id: string) =>
    call<void>(`/plans/items/${encodeURIComponent(id)}`, { method: "DELETE" }),
  setPlanServings: (id: string, servings: number | null) =>
    call<void>(`/plans/items/${encodeURIComponent(id)}/servings`, {
      method: "PUT",
      json: { servings },
    }),
  movePlanItem: (id: string, direction: "up" | "down") =>
    call<void>(`/plans/items/${encodeURIComponent(id)}/move`, {
      method: "POST",
      json: { direction },
    }),

  shopping: (days: number) =>
    call<{
      from: string;
      to: string;
      recipeCount: number;
      /** 換算に使った人数（ふだん作る人数） */
      people: number;
      /** 人数が分からず、元の分量のまま入れたレシピ */
      unscaled?: string[];
      items: ShopItem[];
    }>(`/shopping?days=${days}`),
  setHave: (name: string, value: boolean) =>
    call<void>("/shopping/have", { method: "PUT", json: { name, value } }),

  recommend: () => call<RecoLists & { today: string }>("/recommend"),

  pantry: () => call<{ items: PantryItem[]; today: string }>("/pantry"),
  addPantry: (names: string[]) =>
    call<{ added: string[]; skipped: string[] }>("/pantry", {
      method: "POST",
      json: { names },
    }),
  updatePantry: (
    id: string,
    patch: { amount?: string | null; expiresOn?: string | null },
  ) =>
    call<void>(`/pantry/${encodeURIComponent(id)}`, {
      method: "PATCH",
      json: patch,
    }),
  deletePantry: (id: string) =>
    call<void>(`/pantry/${encodeURIComponent(id)}`, { method: "DELETE" }),

  group: () => call<GroupInfo>("/group"),
  /** 今日の AI の使用量（DEC-025） */
  aiUsage: () =>
    call<{
      items: {
        key: string;
        label: string;
        used: number;
        stopAt: number;
        /** 鍵・バインディングがあって使える設定か */
        available: boolean;
      }[];
    }>("/ai/usage"),
  setHouseholdServings: (servings: number) =>
    call<{ servings: number }>("/group/servings", {
      method: "PUT",
      json: { servings },
    }),
  invite: (email: string) =>
    call<{ ok: true }>("/group/invites", { method: "POST", json: { email } }),
  cancelInvite: (id: string) =>
    call<void>(`/group/invites/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  myInvites: () => call<{ invites: MyInvite[] }>("/invites"),
  acceptInvite: (id: string) =>
    call<AcceptResult>(`/invites/${encodeURIComponent(id)}/accept`, {
      method: "POST",
    }),
};
