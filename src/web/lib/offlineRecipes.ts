// 電波が弱い台所でも、開いたことのあるレシピと、今日・明日の献立のレシピを見られるようにする。
// レシピの中身をこの端末（localStorage）に残し、API に届かないときだけそれを出す。
// 残すのは自分のグループのレシピだけ（API が返したもの）。ログアウトしたら消す
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { ApiError, apiClient, type RecipeDetail } from "@/api/client";

const PREFIX = "mairecipe:recipe:";
const INDEX = "mairecipe:recipes";
/** 残したレシピの持ち主（ログインしている人が変わったら全部消す） */
const OWNER = "mairecipe:recipes-owner";
/** 電波が弱くて返事が来ないとき、残していた内容に切り替えるまでの時間 */
const SLOW_MS = 5000;
/** 残しておく数（古いものから消す） */
const KEEP = 30;

export type OfflineRecipe = RecipeDetail & {
  /** 端末に残していたものを出しているとき、残した時刻 */
  offlineSavedAt?: number;
};

function readIndex(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(INDEX) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]) {
  try {
    localStorage.setItem(INDEX, JSON.stringify(ids));
  } catch {
    // 入らなくても、ふだんの表示には関係ない
  }
}

export function saveRecipe(r: RecipeDetail) {
  try {
    localStorage.setItem(
      PREFIX + r.id,
      JSON.stringify({ savedAt: Date.now(), recipe: r }),
    );
    const ids = [r.id, ...readIndex().filter((x) => x !== r.id)];
    for (const old of ids.slice(KEEP)) localStorage.removeItem(PREFIX + old);
    writeIndex(ids.slice(0, KEEP));
  } catch {
    // 端末の空きが無いなど。残せなくても、ふだんの表示には関係ない
  }
}

export function loadRecipe(id: string): OfflineRecipe | null {
  try {
    const v = JSON.parse(localStorage.getItem(PREFIX + id) ?? "null") as {
      savedAt: number;
      recipe: RecipeDetail;
    } | null;
    return v ? { ...v.recipe, offlineSavedAt: v.savedAt } : null;
  } catch {
    return null;
  }
}

export function forgetRecipe(id: string) {
  try {
    localStorage.removeItem(PREFIX + id);
    writeIndex(readIndex().filter((x) => x !== id));
  } catch {
    // 何もしない
  }
}

/** ログアウトしたとき・ログインしている人が変わったとき、この端末に残したレシピを全部消す */
export function clearOfflineRecipes() {
  for (const id of readIndex()) forgetRecipe(id);
  try {
    localStorage.removeItem(INDEX);
    localStorage.removeItem(OWNER);
  } catch {
    // 何もしない
  }
}

/** ログインしている人を確かめ、前と違う人なら残したレシピを消す（同じ端末を別の人が使ったとき） */
export function checkOfflineOwner(userId: string) {
  try {
    const prev = localStorage.getItem(OWNER);
    if (prev && prev !== userId) clearOfflineRecipes();
    localStorage.setItem(OWNER, userId);
  } catch {
    // 何もしない
  }
}

/** API から読み、読めたら端末に残す。届かない（電波が無い）ときは残していたものを出す */
export async function fetchRecipe(id: string): Promise<OfflineRecipe> {
  const fresh = apiClient.getRecipe(id).then((r) => {
    saveRecipe(r);
    return r;
  });
  try {
    // 電波が弱くて返事が来ないときは、残していた内容を先に出す（返事が来たら端末の分は新しくなる）
    const saved = loadRecipe(id);
    if (!saved) return await fresh;
    const slow = new Promise<"slow">((r) =>
      setTimeout(() => r("slow"), SLOW_MS),
    );
    const first = await Promise.race([fresh, slow]);
    if (first !== "slow") return first;
    fresh.catch(() => {});
    return saved;
  } catch (e) {
    // 消された・見られなくなったレシピは、端末からも消す
    if (e instanceof ApiError) {
      if (e.status === 404) forgetRecipe(id);
      throw e;
    }
    const saved = loadRecipe(id);
    if (saved) return saved;
    throw e;
  }
}

export const recipeQuery = (id: string) => ({
  queryKey: ["recipe", id],
  queryFn: () => fetchRecipe(id),
});

export function useRecipe(id: string) {
  return useQuery(recipeQuery(id));
}

/** 献立のレシピを、先に読んで端末に残しておく（料理を始める前に電波が切れても見られるように） */
export function prefetchRecipes(qc: QueryClient, ids: string[]) {
  for (const id of new Set(ids))
    void qc.prefetchQuery({ ...recipeQuery(id), staleTime: 5 * 60_000 });
}
