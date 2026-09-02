import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecipesEmptyState } from "@/components/recipes/recipes-empty-state";

describe("RecipesEmptyState", () => {
  it("空状態の文言を表示する", () => {
    render(<RecipesEmptyState />);
    expect(screen.getByText("レシピはまだありません")).toBeInTheDocument();
  });
});
