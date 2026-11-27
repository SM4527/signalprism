import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SampleBanner } from "@/components/mode-banner";
import { Nav } from "@/components/nav";

function render(mode: "mock" | "live") {
  return renderToStaticMarkup(createElement("div", null, createElement(SampleBanner, { mode }), createElement(Nav, { mode })));
}

describe("mode indicators", () => {
  it("mock shows the SAMPLE DATA banner and no Personal badge", () => {
    const html = render("mock");
    expect(html).toContain("SAMPLE DATA");
    expect(html).not.toContain("Personal");
  });

  it("live shows the Personal badge and no banner", () => {
    const html = render("live");
    expect(html).toContain("Personal");
    expect(html).not.toContain("SAMPLE DATA");
  });
});
