/** カテゴリごとの、写真が無いときの色（見分けやすく） */
export function categoryTint(category: string): string {
  switch (category) {
    case "主菜":
      return "#F2D9C4";
    case "副菜":
      return "#D9E4CF";
    case "汁物":
      return "#EADFC8";
    case "丼":
      return "#F3E3B8";
    case "デザート":
      return "#F0D6DE";
    default:
      return "#E8E1D6";
  }
}
