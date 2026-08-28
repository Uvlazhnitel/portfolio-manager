import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PnlIndicator } from "@/components/ui/pnl-indicator";

describe("PnlIndicator", () => {
  it("renders positive currency as a success pill with an explicit plus sign", () => {
    const markup = renderToStaticMarkup(<PnlIndicator value="191.28" format="currency" currency="USD" />);

    expect(markup).toContain("data-tone=\"positive\"");
    expect(markup).toContain("data-variant=\"pill\"");
    expect(markup).toContain("+$191.28");
    expect(markup).toContain("border-success");
    expect(markup).toContain("bg-success");
    expect(markup).toContain("text-success");
  });

  it("renders negative percent as a destructive pill with a true minus sign", () => {
    const markup = renderToStaticMarkup(<PnlIndicator value="-10.2" format="percent" />);

    expect(markup).toContain("data-tone=\"negative\"");
    expect(markup).toContain("−10.2%");
    expect(markup).toContain("text-destructive");
  });

  it("keeps zero and unavailable values neutral", () => {
    const zeroMarkup = renderToStaticMarkup(<PnlIndicator value="0" format="currency" currency="USD" />);
    const unavailableMarkup = renderToStaticMarkup(<PnlIndicator value={null} format="currency" currency="USD" unavailableLabel="Price unavailable" />);

    expect(zeroMarkup).toContain("data-tone=\"neutral\"");
    expect(zeroMarkup).toContain("$0.00");
    expect(zeroMarkup).not.toContain("text-success");
    expect(zeroMarkup).not.toContain("text-destructive");
    expect(unavailableMarkup).toContain("data-tone=\"neutral\"");
    expect(unavailableMarkup).toContain("Price unavailable");
  });

  it("can render as plain signed text without pill background or border", () => {
    const markup = renderToStaticMarkup(<PnlIndicator value="191.28" format="currency" currency="USD" variant="text" />);

    expect(markup).toContain("data-tone=\"positive\"");
    expect(markup).toContain("data-variant=\"text\"");
    expect(markup).toContain("+$191.28");
    expect(markup).toContain("text-success");
    expect(markup).not.toContain("border-success");
    expect(markup).not.toContain("bg-success");
    expect(markup).not.toContain("rounded-md");
  });
});
