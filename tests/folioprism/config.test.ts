import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";

const url = (u: string, hosts?: string) => () => loadConfig({ FOLIOPRISM_URL: u, PRISM_NET_HOSTS: hosts });

describe("FOLIOPRISM_URL host allowlist", () => {
  it.each([
    "http://127.0.0.1:9000",
    "http://localhost:9000",
    "http://[::1]:9000",
    "http://host.docker.internal:9000",
  ])("accepts %s", (u) => {
    expect(url(u)).not.toThrow();
  });

  it.each(["http://example.com", "http://192.168.1.5:9000", "http://folioprism:9000", "not a url"])(
    "refuses %s",
    (u) => {
      expect(url(u)).toThrow();
    },
  );

  it("accepts a host listed in PRISM_NET_HOSTS", () => {
    expect(url("http://folioprism-app:9000", "other, folioprism-app")).not.toThrow();
  });

  it("is optional", () => {
    expect(loadConfig({}).FOLIOPRISM_URL).toBeUndefined();
  });
});
