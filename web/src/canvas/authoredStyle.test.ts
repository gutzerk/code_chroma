import { describe, expect, it } from "vitest";
import { authoredStyle } from "./authoredStyle";

describe("authoredStyle", () => {
  it("maps allow-listed keys and passes string values through", () => {
    const style = authoredStyle({
      color: "#ff0000",
      "border-color": "var(--added)",
      background: "rebeccapurple",
      "border-style": "dashed",
    });

    expect(style).toEqual({
      color: "#ff0000",
      borderColor: "var(--added)",
      backgroundColor: "rebeccapurple",
      borderStyle: "dashed",
    });
  });

  it("drops unknown keys, non-string values and empty strings", () => {
    const style = authoredStyle({
      color: "green",
      position: "absolute",
      width: "500px",
      zIndex: "99",
      padding: "20px",
      background: 7,
      "border-color": "",
    });

    expect(style).toEqual({ color: "green" });
  });

  it("passes an edge's allow-listed color through with the same allow-list", () => {
    expect(authoredStyle({ color: "#ff5500" })).toEqual({ color: "#ff5500" });
    expect(
      authoredStyle({ color: "green", stroke: "red", width: "5px", color2: "", background: 7 }),
    ).toEqual({ color: "green" });
  });

  it("returns undefined for null, a non-object, or nothing applicable", () => {
    expect(authoredStyle(null)).toBeUndefined();
    expect(authoredStyle("bold")).toBeUndefined();
    expect(authoredStyle(undefined)).toBeUndefined();
    expect(authoredStyle({})).toBeUndefined();
    expect(authoredStyle({ color: "" })).toBeUndefined();
    expect(authoredStyle(["a"])).toBeUndefined();
  });
});
