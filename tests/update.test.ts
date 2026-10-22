import { describe, expect, test } from "bun:test";
import { latestRelease, newer, parseVersion } from "../src/update";

describe("updates", () => {
  test("versions compare by number, with or without a v", () => {
    expect(parseVersion("v0.12.3")).toEqual([0, 12, 3]);
    expect(newer("0.12.0", "0.11.0")).toBe(true);
    expect(newer("v0.11.10", "0.11.9")).toBe(true);
    expect(newer("0.11.0", "0.11.0")).toBe(false);
    expect(newer("0.10.9", "0.11.0")).toBe(false);
    expect(newer("1.0.0", "0.99.99")).toBe(true);
  });

  test("the newest release, its notes and its offline file come from GitHub", async () => {
    const fake = (async (url: string) => {
      expect(url).toBe("https://api.github.com/repos/LMJuerioeoe/railplot/releases/latest");
      return new Response(JSON.stringify({ tag_name: "v0.12.0", body: "New things", html_url: "https://github.com/x/releases/tag/v0.12.0",
        assets: [{ name: "Railplot_0.12.0_x64-setup.exe", browser_download_url: "https://x/setup.exe" }, { name: "railplot-offline.html", browser_download_url: "https://x/railplot-offline.html" }] }));
    }) as unknown as typeof fetch;
    const r = await latestRelease(fake);
    expect(r).toMatchObject({ version: "0.12.0", notes: "New things", offlineUrl: "https://x/railplot-offline.html" });
  });

  test("no published release, or GitHub refusing, comes back as a plain message", async () => {
    await expect(latestRelease((async () => new Response("", { status: 404 })) as unknown as typeof fetch)).rejects.toThrow(/no published release/);
    await expect(latestRelease((async () => new Response("", { status: 403 })) as unknown as typeof fetch)).rejects.toThrow(/Try again/);
  });
});
