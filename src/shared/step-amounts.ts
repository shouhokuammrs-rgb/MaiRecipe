// 手順に出てくる材料に、材料表の分量を添える（DEC-036）。
// 「塩をふる」→「塩（小さじ1/2）をふる」。データは書き換えず、表示のときに足す。AI は使わない
import { explainStep, splitGroup } from "./groups";
import { aliasesOf } from "./ingredients";

type Ing = { name: string; amount: string };

/** 名前の前に来てよい字（文の頭・句読点・空白・助詞）。「サラダ油」「溶き卵」の一部には当てない */
const BEFORE = "(?<=^|[\\s、。・,，/／にをはでともがへや「『(（【［\\[])";
/**
 * 名前の後に続く字（助詞・句読点・文末）。「水気」「塩昆布」や、
 * もう分量が書いてある「塩小さじ1」「塩（ひとつまみ）」には当てない
 */
const AFTER = "(?=[をのとにはもでがや、。・,，/／]|$)";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function stepWithAmounts(step: string, ingredients: Ing[]): string {
  // 探す書き方（名寄せの揺れも）と分量。長い名前から当てる
  const targets = ingredients
    .filter((i) => i.amount.trim())
    .flatMap((i) => {
      const names = new Set([
        ...aliasesOf(splitGroup(i.name).name),
        splitGroup(i.name).name.trim(),
      ]);
      return [...names]
        .filter((n) => n.length > 0)
        .map((n) => ({ key: i.name, name: n, amount: i.amount.trim() }));
    })
    .sort((a, b) => b.name.length - a.name.length);

  // 見つけた場所を集めてから、後ろから差し込む（差し込んだ文字に別の名前が当たらないように）
  const hits: { at: number; amount: string }[] = [];
  const taken: [number, number][] = [];
  const done = new Set<string>();
  for (const t of targets) {
    if (done.has(t.key)) continue;
    const re = new RegExp(`${BEFORE}${escape(t.name)}${AFTER}`, "gu");
    for (const m of step.matchAll(re)) {
      const start = m.index;
      const end = start + t.name.length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      hits.push({ at: end, amount: t.amount });
      done.add(t.key);
      break; // 同じ手順では最初の1回だけ
    }
  }
  let out = step;
  for (const h of hits.sort((a, b) => b.at - a.at))
    out = `${out.slice(0, h.at)}（${h.amount}）${out.slice(h.at)}`;
  // 「Aを加える」→「A（しょうゆ 大さじ1・みりん 大さじ2）を加える」
  return explainStep(out, ingredients, true);
}
