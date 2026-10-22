// 材料の「まとまり」（A・B・★ など）。手順の「Aを加える」の A が何か分かるようにする。
// 保存する形は名前の頭の【A】（例：【A】しょうゆ）。編集画面でもそのまま見え、直せる。
// 保存済みの「★しょうゆ」「(A)しょうゆ」も、表示のときに同じように扱う。AI は使わない

type Ing = { name: string; amount: string };

const SYMBOLS = "★☆◎●○◆◇■□▲△♪";
const HIRA_KANJI = "\\u3040-\\u309F\\u3400-\\u9FFF";
const toHalfUpper = (s: string) =>
  s
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .toUpperCase();
/** ⭐️ は ★ にそろえる。全角英字・小文字は半角の大文字に */
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
  // 「Aしょうゆ」「A醤油」：かっこの無い英字1文字＋ひらがな・漢字（Tボーン・Lサイズのようなカタカナは名前の一部）
  m = name.match(
    new RegExp(`^([A-ZＡ-Ｚ])[\\s:：・]?([${HIRA_KANJI}].*)$`, "u"),
  );
  if (m) return { group: normLabel(m[1]!), rest: m[2]!.trim(), kind: "bare" };
  return null;
}

/** 手順の中で、その印が呼ばれているか（「★を混ぜる」） */
function calledInSteps(group: string, steps: string[]): boolean {
  const re = new RegExp(`${tokenPattern(group)}${PARTICLE}`, "u");
  return steps.some((s) => re.test(s));
}

/**
 * 材料の印を【A】の形にそろえる（取り込みのとき・表示のとき）。
 * ・「Aランク卵」のように1つにしか無い英字は、印ではなく名前の一部とみなす
 * ・半分より多くの材料に付いている記号（◎・★ など）は、ただの箇条書きとして外す
 *   （手順で「★を混ぜる」と呼ばれていれば印として残す）
 */
export function normalizeGroups<T extends Ing>(
  list: T[],
  steps: string[] = [],
): T[] {
  const marks = list.map((i) => parseMark(i.name));
  const count = new Map<string, number>();
  for (const m of marks)
    if (m) count.set(m.group, (count.get(m.group) ?? 0) + 1);
  const bracketed = new Set(
    marks.filter((m) => m && m.kind === "bracket").map((m) => m!.group),
  );
  const bullet = (m: Mark) =>
    m.kind === "symbol" &&
    list.length > 1 &&
    (count.get(m.group) ?? 0) > list.length / 2 &&
    !calledInSteps(m.group, steps);
  return list.map((i, k) => {
    const m = marks[k];
    if (!m) return i;
    if (bullet(m)) return { ...i, name: m.rest };
    if (
      m.kind === "bare" &&
      (count.get(m.group) ?? 0) < 2 &&
      !bracketed.has(m.group)
    )
      return i;
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

/** 印の後に続く字（「Aを」「Aと」「Aは」）。続かなければ言葉の一部とみなす */
const PARTICLE = "(?=[をのとにはもで、。・,，\\s]|$)";
/** 印の前に来てよい字（文の頭・句読点・空白・助詞）。「ビタミンA」「合わせ調味料」は違う */
const BEFORE = "(?<=^|[\\s、。・,，にをはでともがへ「『(（【［\\[<＜])";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 印の字の書き方の揺れ（A・Ａ・a、★・⭐️、かっこ付き）をまとめた正規表現 */
function tokenPattern(g: string): string {
  let core: string;
  if (/^[A-Z]$/.test(g)) {
    const lower = g.toLowerCase();
    const full = (c: string) => String.fromCharCode(c.charCodeAt(0) + 0xfee0);
    core = `[${g}${lower}${full(g)}${full(lower)}](?![A-Za-zＡ-Ｚａ-ｚ])`;
  } else if (g === "★") core = "(?:★|⭐\\uFE0F?)";
  else core = escape(g);
  // かっこ付き（(A)【A】）か、そのまま
  return `${BEFORE}(?:[(（【［\\[<＜]${core}[)）】］\\]>＞]|${core})`;
}

/**
 * 手順の「Aを加える」「★を合わせる」「タレをかける」に、まとまりの中身を書き足す。
 * 「A（しょうゆ・みりん）を加える」。書き足し済み・別の言葉の一部（Aランク・ビタミンA）は触らない
 */
export function explainStep(step: string, ingredients: Ing[]): string {
  const groups = new Map<string, string[]>();
  for (const i of normalizeGroups(ingredients, [step])) {
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
    // すでに（…）が続いているものは書き足さない。かっこ付きの (A) は A（…）の形にする
    const re = new RegExp(`${tokenPattern(g)}(?![（(])${PARTICLE}`, "u");
    out = out.replace(re, () => `${g}（${list}）`);
  }
  return out;
}
