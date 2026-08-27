import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataQualitySummary, deduplicateDataQualityItems } from "@/components/ui/data-quality-summary";

describe("DataQualitySummary", () => {
  it("renders nothing when data is complete", () => {
    expect(renderToStaticMarkup(<DataQualitySummary items={[]} />)).toBe("");
  });

  it("keeps a single issue out of the collapsed summary text", () => {
    const message = "Partial cost basis: PHYSICAL_GOLD";
    const markup = renderToStaticMarkup(<DataQualitySummary items={[{ message }]} />);

    expect(markup).toContain("Data quality: 1 issue");
    expect(markup.match(new RegExp(message, "g"))).toHaveLength(1);
  });

  it("deduplicates repeated messages and preserves the strongest tone", () => {
    expect(deduplicateDataQualityItems([
      { message: "Missing basis" },
      { message: " Missing basis ", tone: "destructive" },
      { message: "Missing price" },
    ])).toEqual([
      { message: "Missing basis", tone: "destructive" },
      { message: "Missing price" },
    ]);
  });
});
