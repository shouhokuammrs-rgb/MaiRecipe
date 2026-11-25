#!/usr/bin/env python3
"""成分表（八訂 増補2023年）の Excel から、MaiRecipe が使う食材の分だけを取り出して
src/shared/nutrition-data.ts を作る。

使い方:
  1. 文部科学省「日本食品標準成分表（八訂）増補2023年」のページから
     「第2章（データ）」の Excel を落とす（https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html）
  2. python3 scripts/nutrition/build.py <落とした.xlsx>
  3. npm run format（作ったファイルの形をそろえる）

食材を足すときは foods.tsv に行を足して、これを流し直す（数字を手で書かない）。
"""
import json, re, sys
from pathlib import Path
import openpyxl

HERE = Path(__file__).parent
OUT = HERE.parent.parent / "src" / "shared" / "nutrition-data.ts"
# 成分識別子 → MaiRecipe の栄養素の並び（nutrition.ts の NUTRIENT_IDS と同じ順）
COLS = ["FE", "CA", "PROT-", "FIB-", "VITA_RAE", "THIA", "VITC", "VITD"]


def num(v):
    s = str(v).strip().replace("(", "").replace(")", "").replace("†", "")
    if s in ("Tr", "-", "", "None", "*"):
        return 0.0  # Tr（微量）・-（未測定）は 0 として扱う
    return float(s)


def load(xlsx):
    ws = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)["表全体"]
    head = [(c or "").strip() for c in next(ws.iter_rows(min_row=12, max_row=12, values_only=True))]
    idx = [head.index(c) for c in COLS]
    foods = {}
    for r in ws.iter_rows(min_row=13, values_only=True):
        if r[1]:
            vals = [num(r[i]) for i in idx]
            # 備考に「ビタミンC：酸化防止用として添加された食品を含む」とある加工品（ハム・ベーコンなど）は、
            # 製品で大きく違い、食材そのものの栄養ではないので、ビタミンC を数えない
            note = str(r[61] or "")  # 備考の列
            if "ビタミンC" in note and "添加" in note:
                vals[COLS.index("VITC")] = 0.0
            foods[r[1]] = (re.sub(r"\s+", " ", r[3]).strip(), vals, num(r[4]))
    return foods


def main():
    foods = load(sys.argv[1])
    rows = []
    for line in (HERE / "foods.tsv").read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        key, pat, ref, units, shell = (line.split("\t") + ["", ""])[:5]
        re.compile(pat)
        if re.fullmatch(r"\d{5}", ref):
            no = ref
        else:
            terms = ref.split()
            hits = [k for k, v in foods.items() if all(t in v[0] for t in terms)]
            if not hits:
                sys.exit(f"成分表に見つからない: {key}（{ref}）")
            no = hits[0]
        name, vals, refuse = foods[no]
        u = {}
        for part in filter(None, units.split(",")):
            k, v = part.split("=")
            u[k] = float(v)
        rows.append({"key": key, "pattern": pat, "no": no, "source": name, "per100g": vals, "units": u,
                     "edible": round(1 - refuse / 100, 2) if shell else 1})
    body = ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in rows)
    OUT.write_text(
        "// 自動で作ったファイル。手で直さない（scripts/nutrition/build.py と foods.tsv から作る）。\n"
        "// 数字は「日本食品標準成分表（八訂）増補2023年」から引用（可食部 100g あたり）。\n"
        "// 並びは 鉄 mg・カルシウム mg・たんぱく質 g・食物繊維 g・ビタミンA μg・ビタミンB1 mg・ビタミンC mg・ビタミンD μg。\n"
        "// units は 1個・1本などの目安の重さ（g）。成分表の値ではなく、台所での一般的な目安。\n"
        "export type FoodRow = {\n  key: string;\n  pattern: string;\n  no: string;\n  source: string;\n"
        "  per100g: number[];\n  units: Record<string, number>;\n"
        "  /** 量った重さのうち食べられる割合（殻つきの貝だけ 1 未満。成分表の廃棄率から） */\n  edible: number;\n};\n\n"
        f"export const FOOD_ROWS: FoodRow[] = [\n{body},\n];\n",
        encoding="utf-8",
    )
    print(f"{len(rows)} 食材 → {OUT}")


if __name__ == "__main__":
    main()
