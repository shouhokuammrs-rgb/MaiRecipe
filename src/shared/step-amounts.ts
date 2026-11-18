// 手順に出てくる材料に、材料表の分量を添える（DEC-036）。
// 「塩をふる」→「塩（小さじ1/2）をふる」。データは書き換えず、表示のときに足す。AI は使わない
import { explainStep, splitGroup } from "./groups";
import { aliasesOf } from "./ingredients";

type Ing = { name: string; amount: string };

/** 名前の前に来てよい字（文の頭・句読点・空白・助詞）。「サラダ油」「溶き卵」の一部には当てない */
const BEFORE = "(?<=^|[\\s、。・,，/／にをはでともがへやた「『(（【［\\[])";
/**
 * 名前の後に続く字（助詞・句読点・文末）。「水気」「塩昆布」「塩もみ」や、
 * もう分量が書いてある「塩小さじ1」「塩（ひとつまみ）」には当てない
 */
const AFTER = "(?=[をのとにはでがや、。・,，/／)）]|$)";
/** 名前のすぐ後（助詞をはさんでも）に分量が書いてある：「塩をひとつまみ」「水200ml」。「2cm幅」「2等分」「2つに切る」は分量ではない */
const AMOUNT_NEXT =
  /^[をはも]?\s*(?:大さじ|小さじ|ひとつまみ|少々|適量|半量|カップ|[\d０-９.．/／]+\s*(?:g|ｇ|kg|ml|mL|cc|L|ℓ|グラム|個|本|枚|片|かけ|束|袋|缶|丁|合|杯|玉|切れ|尾|匹|パック|カップ|つ(?!に)))/u;
/** 並べた後にまとめて分量が書いてある：「酒、みりん、しょうゆを各大さじ1」「塩と砂糖各小さじ1」 */
const EACH_NEXT = /^(?:[、・と,，や][^。をにで]*)?[をは]?\s*各/u;
/** 材料としてではなく使うことが多いもの（水にさらす・水で洗う・油は捨てる）。「を」「と」「、」が続くときだけ添える */
const UTILITY = new Set(["水", "湯", "お湯", "ぬるま湯", "熱湯", "油"]);
const UTILITY_AFTER = /^[をと、・]/u;
/** 添える分量の長さの上限（長い但し書きは添えない） */
const AMOUNT_MAX = 12;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 分量の後ろの但し書き（「1枚(300g)」「400ml（水でも可）」）は外す。かっこが入れ子にならないように */
function shortAmount(raw: string): string | null {
  const a = raw
    .trim()
    .replace(/(\s*[（(][^）)]*[）)]?)+$/u, "")
    .trim();
  return a && a.length <= AMOUNT_MAX && !/[（()）]/.test(a) ? a : null;
}

/**
 * 手順では短く呼ぶ肉（「豚小間切れ肉」を「豚肉」）。その種類の材料が1つだけのときに、同じものと見なす。
 * 2つ以上あるとき（豚バラと豚ひき肉）は、どちらか分からないので添えない
 */
/** 名前が豚・鶏・牛で始まっても肉ではないもの（鶏がらスープの素・鶏卵・豚骨スープ・牛乳・牛蒡） */
const NOT_MEAT =
  /がら|ガラ|骨|卵|乳|脂|蒡|汁|スープ|だし|出汁|の素|エキス|コンソメ|ブイヨン/u;
const meat = (re: RegExp) => (n: string) => re.test(n) && !NOT_MEAT.test(n);
const MEAT_KINDS: { is: (n: string) => boolean; calls: string[] }[] = [
  { is: meat(/^豚/u), calls: ["豚肉"] },
  { is: meat(/^(?:鶏|とり|鳥)/u), calls: ["鶏肉", "とり肉", "鳥肉"] },
  { is: meat(/^牛/u), calls: ["牛肉"] },
  {
    is: meat(/(?:[ひび]き|挽き?)肉|ミンチ/u),
    calls: ["ひき肉", "挽き肉", "挽肉"],
  },
];

type Target = {
  key: string;
  /** 材料表の中の位置 */
  idx: number;
  name: string;
  amount: string;
  re: RegExp;
};

/** 探す書き方（名寄せの揺れも）と分量。長い名前から当てる。同じ名前はまとまりの外の材料を先に */
function buildTargets(ingredients: Ing[]): Target[] {
  const bases = ingredients.map((i) => splitGroup(i.name).name.trim());
  return ingredients
    .flatMap((i, idx) => {
      const amount = shortAmount(i.amount);
      if (!amount) return [];
      const { group, name } = splitGroup(i.name);
      const names = new Set([...aliasesOf(name), name.trim()]);
      for (const kind of MEAT_KINDS)
        if (kind.is(name.trim()) && bases.filter(kind.is).length === 1)
          for (const c of kind.calls) names.add(c);
      return [...names]
        .filter((n) => n.length > 0)
        .map((n) => ({
          key: i.name,
          idx,
          name: n,
          amount,
          grouped: group ? 1 : 0,
          re: new RegExp(`${BEFORE}${escape(n)}${AFTER}`, "gu"),
        }));
    })
    .sort((a, b) => b.name.length - a.name.length || a.grouped - b.grouped);
}

function annotate(
  step: string,
  targets: Target[],
  /** もう前の手順で分量を添えた材料（添えない） */
  already?: ReadonlySet<number>,
): { text: string; shown: Set<number> } {
  // 見つけた場所を集めてから、後ろから差し込む（差し込んだ文字に別の名前が当たらないように）
  const hits: { at: number; amount: string }[] = [];
  const shown = new Set<number>();
  const taken: [number, number][] = [];
  // 同じ材料・同じ書き方は、1つの手順で1回だけ（塩が材料表に2つあっても、2つ目に別の分量を付けない）
  const done = new Set<string>();
  for (const t of targets) {
    if (done.has(t.key) || done.has(`=${t.name}`)) continue;
    t.re.lastIndex = 0;
    for (const m of step.matchAll(t.re)) {
      const start = m.index;
      const end = start + t.name.length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      done.add(t.key);
      done.add(`=${t.name}`);
      const rest = step.slice(end);
      const skip =
        AMOUNT_NEXT.test(rest) ||
        EACH_NEXT.test(rest) ||
        (UTILITY.has(t.name) && !UTILITY_AFTER.test(rest));
      if (!skip && !already?.has(t.idx)) {
        hits.push({ at: end, amount: t.amount });
        shown.add(t.idx);
      }
      break; // 最初の1回だけ見る
    }
  }
  let out = step;
  for (const h of hits.sort((a, b) => b.at - a.at)) {
    // かっこの中（「（しょうゆ、砂糖、酒）を混ぜる」）では、かっこを重ねずに「しょうゆ 大さじ1」と書く
    // 閉じていないかっこ（書き間違い）では重ねる心配が無いので、後ろに閉じかっこがあるときだけ
    const before = step.slice(0, h.at);
    const inParen =
      (before.match(/[（(]/gu)?.length ?? 0) >
        (before.match(/[）)]/gu)?.length ?? 0) &&
      /[）)]/u.test(step.slice(h.at));
    out = `${out.slice(0, h.at)}${inParen ? ` ${h.amount}` : `（${h.amount}）`}${out.slice(h.at)}`;
  }
  return { text: out, shown };
}

/**
 * 全部の手順に分量を添える（探す準備はレシピで1回）。
 * once: 同じ材料には、最初に出てきた手順でだけ添える（手順を並べて見せるレシピの画面用。
 * 1つずつ見せる料理モードでは毎回添える）
 */
export function stepsWithAmounts(
  steps: string[],
  ingredients: Ing[],
  opts: { once?: boolean } = {},
): string[] {
  const targets = buildTargets(ingredients);
  const seen = new Set<number>();
  // 「Aを加える」→「A（しょうゆ 大さじ1・みりん 大さじ2）を加える」
  return steps.map((s) => {
    const { text, shown } = annotate(s, targets, opts.once ? seen : undefined);
    for (const k of shown) seen.add(k);
    return explainStep(text, ingredients, true, shown);
  });
}

export function stepWithAmounts(step: string, ingredients: Ing[]): string {
  return stepsWithAmounts([step], ingredients)[0]!;
}
