import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client";
import {
  applyServiceTierTargets,
  loadServiceTierTarget,
} from "./sessionServiceTier";

const summary = {
  id: "one",
  active: true,
  model: "m",
  serviceTier: null,
  metadata: { path: "/work", name: "Bot", flavor: "codex" },
} as const;

function setup() {
  const session = { ...summary, model: summary.model as string, agentState: null };
  const methods = {
    getSession: vi.fn().mockResolvedValue({ session }),
    getSessionCodexModels: vi
      .fn()
      .mockResolvedValue({
        success: true,
        models: [{ id: "m", isDefault: true, serviceTiers: ["priority"] }],
      }),
    setServiceTier: vi.fn().mockResolvedValue(undefined),
  };
  return { session, methods, api: methods as unknown as ApiClient };
}

describe("service tier capability preflight", () => {
  it("only enables Fast from the advertised native catalog", async () => {
    const { api, methods } = setup();
    expect((await loadServiceTierTarget(api, summary)).fastAvailable).toBe(true);
    methods.getSessionCodexModels.mockResolvedValue({
      success: true,
      models: [{ id: "m", isDefault: true, serviceTiers: [] }],
    });
    expect((await loadServiceTierTarget(api, summary)).fastAvailable).toBe(false);
  });
  it("rechecks the model before a write and does not retry failures", async () => {
    const { api, session, methods } = setup();
    const target = await loadServiceTierTarget(api, summary);
    session.model = "other";
    expect(
      (await applyServiceTierTargets(api, [target], "fast"))[0].status,
    ).toBe("skipped");
    expect(methods.setServiceTier).not.toHaveBeenCalled();
    session.model = "m";
    methods.setServiceTier.mockRejectedValueOnce(Error("Timeout"));
    expect(
      (await applyServiceTierTargets(api, [target], "fast"))[0].status,
    ).toBe("failed");
    expect(methods.setServiceTier).toHaveBeenCalledTimes(1);
  });
});
