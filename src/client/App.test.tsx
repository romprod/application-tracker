import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("application shell", () => {
  it("identifies the product and its current foundation state", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Your search, kept in order.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Foundation ready")).toBeInTheDocument();
  });
});
