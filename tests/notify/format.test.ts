import { describe, expect, it } from "vitest";
import {
  LIMITS, clip, formatClusterAlert, formatDigest, formatSignalAlert, type ClusterAlertInput, type SignalAlertInput,
} from "@/lib/notify/format";

const signal: SignalAlertInput = {
  ticker: "ACME", issuerName: "Acme Corp", owners: ["Rowan Pike"], role: "CEO", titleRaw: "Chief Executive Officer",
  shares: "5000", avgPrice: "31.6", value: "158000", pctIncrease: "25.0123", newPosition: false,
  txnDate: "2026-10-29", filedAt: "2026-11-02", score: 7, parts: [{ label: "CEO", points: 3 }, { label: "$158K", points: 1 }],
  heldVia: "direct", badges: ["Indirect"], url: "https://www.sec.gov/Archives/edgar/data/9000021/x-index.htm",
};

describe("signal alert", () => {
  it("builds the title, body and URL", () => {
    const a = formatSignalAlert(signal, "off");
    expect(a.title).toBe("ACME · CEO buy · $158K · +25%");
    expect(a.body).toBe(
      [
        "Rowan Pike (Chief Executive Officer)",
        "5,000 sh at $31.6 = $158K",
        "Bought 2026-10-29, filed 2026-11-02",
        "Indirect",
        "Score 7: CEO +3, $158K +1",
      ].join("\n"),
    );
    expect(a.url).toBe(signal.url);
    expect(a.priority).toBe(0);
  });

  it("shows New position instead of a percentage and drops an unknown one", () => {
    expect(formatSignalAlert({ ...signal, newPosition: true }, "off").title).toBe("ACME · CEO buy · $158K · New position");
    expect(formatSignalAlert({ ...signal, pctIncrease: null }, "off").title).toBe("ACME · CEO buy · $158K");
  });

  it("is high priority from score 10, never 2", () => {
    expect(formatSignalAlert({ ...signal, score: 9 }, "off").priority).toBe(0);
    expect(formatSignalAlert({ ...signal, score: 10 }, "off").priority).toBe(1);
    expect(formatSignalAlert({ ...signal, score: 99 }, "off").priority).toBe(1);
  });

  it("portfolio hint: off says nothing, flag adds a star, detail adds the body line", () => {
    const off = formatSignalAlert(signal, "off");
    const flag = formatSignalAlert(signal, "flag");
    const detail = formatSignalAlert(signal, "detail");
    expect(off.title + off.body).not.toMatch(/★|Held/);
    expect(flag.title).toBe("ACME ★ · CEO buy · $158K · +25%");
    expect(flag.body).not.toMatch(/Held/);
    expect(detail.title).not.toMatch(/★/);
    expect(detail.body).toMatch(/Held directly$/);
    expect(formatSignalAlert({ ...signal, heldVia: "funds" }, "detail").body).toMatch(/Held via funds$/);
    expect(formatSignalAlert({ ...signal, heldVia: null }, "flag").title).not.toMatch(/★/);
  });

  it("never exceeds 250 / 1024 / 512 characters", () => {
    const long = formatSignalAlert(
      {
        ...signal, ticker: "T".repeat(400), owners: Array.from({ length: 80 }, (_, i) => `Owner Number ${i}`),
        url: `https://example.invalid/${"u".repeat(900)}`,
      },
      "detail",
    );
    expect(long.title.length).toBeLessThanOrEqual(LIMITS.title);
    expect(long.body.length).toBeLessThanOrEqual(LIMITS.message);
    expect(long.url!.length).toBeLessThanOrEqual(LIMITS.url);
    expect(long.title.endsWith("…")).toBe(true);
  });
});

describe("cluster alert", () => {
  const cluster: ClusterAlertInput = {
    ticker: "ACME", issuerName: "Acme Corp", insiderCount: 3, totalValue: "480000", windowStart: "2026-10-20", windowEnd: "2026-11-05",
    members: [
      { owners: ["Rowan Pike"], role: "CEO", value: "158000" },
      { owners: ["Alder Jun"], role: "CFO", value: "7266" },
    ],
    heldVia: null, url: "https://www.sec.gov/x-index.htm",
  };

  it("lists the insiders and is high priority", () => {
    const a = formatClusterAlert(cluster, "off");
    expect(a.title).toBe("ACME · Cluster buy · 3 insiders · $480K");
    expect(a.body).toBe("2026-10-20 to 2026-11-05\nRowan Pike (CEO) $158K\nAlder Jun (CFO) $7K");
    expect(a.priority).toBe(1);
  });

  it("caps a very long member list", () => {
    const many = { ...cluster, members: Array.from({ length: 200 }, (_, i) => ({ owners: [`Person ${i}`], role: "DIRECTOR" as const, value: "1000" })) };
    expect(formatClusterAlert(many, "off").body.length).toBeLessThanOrEqual(LIMITS.message);
  });
});

describe("digest", () => {
  it("lists the titles", () => {
    const d = formatDigest(["A · CEO buy · $1M", "B · CFO buy · $2M"]);
    expect(d).toMatchObject({ title: "SignalPrism digest · 2 alerts", body: "A · CEO buy · $1M\nB · CFO buy · $2M", url: null, priority: 0 });
    expect(formatDigest(["x"]).title).toBe("SignalPrism digest · 1 alert");
  });

  it("fits in 1024 characters with a +N more line", () => {
    const titles = Array.from({ length: 100 }, (_, i) => `TICKER${i} · CEO buy · $1.${i}M · +10.${i}%`);
    const d = formatDigest(titles);
    expect(d.body.length).toBeLessThanOrEqual(LIMITS.message);
    expect(d.body).toMatch(/\n\+\d+ more$/);
    const shown = d.body.split("\n").length - 1;
    expect(d.body).toContain(`+${100 - shown} more`);
  });
});

it("clip keeps short text and ends a long one with an ellipsis at the limit", () => {
  expect(clip("abc", 5)).toBe("abc");
  expect(clip("abcdef", 5)).toBe("abcd…");
});
