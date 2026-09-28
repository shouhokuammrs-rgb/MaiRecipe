// 画面から API を呼ぶ唯一の窓口。src/web の他の場所からは fetch を直接使わない。
import type {
  Category,
  Genre,
  Meal,
  ShopSection,
} from "../../shared/constants";
import type { FindResult } from "../../shared/find";
import type { Ingredient } from "../../shared/recipe";

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
  ingredients: Ingredient[];
  steps: string[];
  changes: string[];
  createdAt: number;
};

export type Memo = {
  id: string;
  text: string;
  appliedVersionId: string | null;
  createdAt: number;
};

export type RecipeDetail = Omit<RecipeHeader, "versionCount"> & {
  origin: "import" | "own";
  createdAt: number;
  versions: Version[];
  memos: Memo[];
};

export type RecipeFields = {
  title: string;
  category: Category;
  genre: Genre;
  timeLabel: string;
  ingredients: Ingredient[];
  steps: string[];
};

export type ImportDraft = RecipeFields & {
  sourceUrl: string;
  videoUrl: string | null;
};
export type ImportResult = {
  kind: "video" | "page";
  found: boolean;
  draft: ImportDraft;
  message: string;
  /** 確かめてほしいこと（全体の量と内訳の重なりなど） */
  notice?: string | null;
};

export type PlanEntry = {
  date: string;
  meal: Meal;
  recipeId: string;
  title: string;
  category: Category;
};

export type GroupInfo = {
  name: string;
  members: { name: string; isMe: boolean; role: "owner" | "member" }[];
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
  home: boolean;
  bought: boolean;
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
      origin: "import" | "own";
    },
  ) => call<{ id: string }>("/recipes", { method: "POST", json: input }),
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
  reportImport: (url: string) =>
    call<{ ok: true }>("/import/reports", { method: "POST", json: { url } }),
  importReports: () =>
    call<{ reports: { url: string; createdAt: number }[] }>("/import/reports"),

  plans: (from: string, to: string) =>
    call<{ plans: PlanEntry[]; today: string }>(`/plans?from=${from}&to=${to}`),
  setPlan: (date: string, meal: Meal, recipeId: string) =>
    call<void>("/plans", { method: "PUT", json: { date, meal, recipeId } }),
  deletePlan: (date: string, meal: Meal) =>
    call<void>(`/plans/${date}/${meal}`, { method: "DELETE" }),

  shopping: (days: number) =>
    call<{ from: string; to: string; recipeCount: number; items: ShopItem[] }>(
      `/shopping?days=${days}`,
    ),
  setMark: (key: string, kind: "home" | "bought", value: boolean) =>
    call<void>("/shopping/marks", {
      method: "PUT",
      json: { key, kind, value },
    }),
  clearBought: () => call<void>("/shopping/bought", { method: "DELETE" }),

  group: () => call<GroupInfo>("/group"),
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
