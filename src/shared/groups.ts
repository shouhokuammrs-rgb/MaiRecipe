// 材料の「まとまり」（A・B・★ など）。手順の「Aを加える」の A が何か分かるようにする。
// 保存する形は名前の頭の【A】（例：【A】しょうゆ）。編集画面でもそのまま見え、直せる。
// 保存済みの「★しょうゆ」「(A)しょうゆ」も、表示のときに同じように扱う。AI は使わない

type Ing = { name: string; amount: string };

const SYMBOLS = "★☆◎●○◆◇■□▲△♪";
const toHalfUpper = (s: string) =>
  s
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .toUpperCase();
/** ⭐️ は ★ にそろえる。全角英字は半角の大文字に */
const normLabel = (g: string) =>
  /^[A-Za-zＡ-Ｚａ-ｚ]$/.test(g) ? toHalfUpper(g) : g.replace(/⭐️?/u, "★");

type Mark = {
  group: string;
  rest: string;
  kind: "bracket" | "symbol" | "bare";
};

/** 名前の頭の印を読む。印が無ければ null */
function parseMark(raw: string): Mark | null {
  const name = raw.trim();
  let m = name.match(/^【([^】]{1,8})】\s*(.+)$/u);
  if (m)
    return { group: normLabel(m[1]!), rest: m[2]!.trim(), kind: "bracket" };
  m = name.match(/^[(（<＜［[]([A-Za-zＡ-Ｚａ-ｚ])[)）>＞］\]]\s*(.+)$/u);
  if (m)
    return { group: normLabel(m[1]!), rest: m[2]!.trim(), kind: "bracket" };
  m = name.match(new RegExp(`^([${SYMBOLS}]|⭐\\uFE0F?)\\s*(.+)$`, "u"));
  if (m) return { group: normLabel(m[1]!), rest: m[2]!.trim(), kind: "symbol" };
  // 「Aしょうゆ」のような、かっこの無い英字1文字＋日本語（ほかの材料にも同じ字があるときだけ印とみなす）
  m = name.match(/^([A-ZＡ-Ｚ])[\s:：・]?([\u3000-\u9fff\uff66-\uff9f].*)$/u);
  if (m) return { group: normLabel(m[1]!), rest: m[2]!.trim(), kind: "bare" };
  return null;
}

/**
 * 材料の印を【A】の形にそろえる（取り込みのとき・表示のとき）。
 * ・「Aランク卵」のように1つにしか無い英字は、印ではなく名前の一部とみなす
 * ・全部の材料に同じ記号（★ など）が付いているだけなら、ただの箇条書きとして外す
 */
export function normalizeGroups<T extends Ing>(list: T[]): T[] {
  const marks = list.map((i) => parseMark(i.name));
  const count = new Map<string, number>();
  for (const m of marks)
    if (m) count.set(m.group, (count.get(m.group) ?? 0) + 1);
  const symbolForAll =
    list.length > 1 &&
    marks.every((m) => m && m.kind === "symbol" && m.group === marks[0]!.group);
  return list.map((i, k) => {
    const m = marks[k];
    if (!m) return i;
    if (symbolForAll) return { ...i, name: m.rest };
    if (m.kind === "bare" && (count.get(m.group) ?? 0) < 2) return i;
    return { ...i, name: `【${m.group}】${m.rest}` };
  });
}

/** 【A】しょうゆ → { group: "A", name: "しょうゆ" }（かっこ付きの (A) も読む） */
export function splitGroup(name: string): {
  group: string | null;
  name: string;
} {
  const m = parseMark(name);
  if (m && m.kind === "bracket") return { group: m.group, name: m.rest };
  return { group: null, name };
}

const PARTICLE = "(?=[をのとにはもで、。・,，\\s]|$)";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 印の字の書き方の揺れ（A と Ａ、★ と ⭐️）をまとめた正規表現の部分 */
function labelPattern(g: string): string {
  if (/^[A-Z]$/.test(g))
    return `[${g}${String.fromCharCode(g.charCodeAt(0) + 0xfee0)}]`;
  if (g === "★") return "(?:★|⭐\\uFE0F?)";
  return escape(g);
}

/**
 * 手順の「Aを加える」「★を合わせる」「タレをかける」に、まとまりの中身を書き足す。
 * 「A（しょうゆ・みりん）を加える」。書き足し済み・別の言葉の一部（Aランク）は触らない
 */
export function explainStep(step: string, ingredients: Ing[]): string {
  const groups = new Map<string, string[]>();
  for (const i of normalizeGroups(ingredients)) {
    const { group, name } = splitGroup(i.name);
    if (!group) continue;
    groups.set(group, [...(groups.get(group) ?? []), name]);
  }
  let out = step;
  for (const [g, names] of groups) {
    const list =
      names.length > 5
        ? `${names.slice(0, 5).join("・")}など`
        : names.join("・");
    const single = /^[A-Z]$/.test(g) || g.length === 1;
    const token = single
      ? `(?<![A-Za-zＡ-Ｚａ-ｚ])([(（【［\\[<＜]?${labelPattern(g)}[)）】］\\]>＞]?)`
      : `(${escape(g)})`;
    // すでに（…）が続いているものは書き足さない
    const re = new RegExp(`${token}(?![（(])${PARTICLE}`, "u");
    out = out.replace(re, (tok) => `${tok}（${list}）`);
  }
  return out;
}
