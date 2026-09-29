import type { ApiClient } from "@/api/client";
import type { SessionSummary } from "@/types/api";
import { getSessionTitle } from "./sessionTitle";
import {
  codexModelAdvertisesFastTier,
  getDisplayedCodexServiceTier,
} from "@/components/AssistantChat/codexFastMode";

export type ServiceTierTarget = {
  id: string;
  title: string;
  flavor: string;
  model: string | null;
  current: "fast" | "standard";
  fastAvailable: boolean;
  unavailable?: string;
};

export type ServiceTierResult = {
  id: string;
  title: string;
  status: "applied" | "unchanged" | "skipped" | "failed";
  detail: string;
};

/** Reads only the current session and its advertised Codex catalog. */
export async function loadServiceTierTarget(
  api: ApiClient,
  summary: Pick<
    SessionSummary,
    "id" | "active" | "metadata" | "model" | "serviceTier"
  >,
): Promise<ServiceTierTarget> {
  const target: ServiceTierTarget = {
    id: summary.id,
    title: getSessionTitle(summary),
    flavor: summary.metadata?.flavor ?? "claude",
    model: summary.model,
    current: getDisplayedCodexServiceTier(summary.serviceTier),
    fastAvailable: false,
  };
  const unavailable = (reason: string) => ({ ...target, unavailable: reason });
  if (!summary.active)
    return unavailable("Offline. Resume this session before changing speed.");
  if ((summary.metadata?.flavor ?? "claude") !== "codex")
    return unavailable("Speed is only available for Codex sessions.");
  try {
    const { session } = await api.getSession(summary.id);
    if (!session.active) return unavailable("Session disconnected.");
    const flavor = session.metadata?.flavor ?? "claude";
    if (flavor !== "codex")
      return unavailable("Harness changed. Refresh the picker.");
    if (
      session.agentState?.controlledByUser &&
      !session.metadata?.capabilities?.concurrentClients
    ) {
      return unavailable(
        "Controlled in its terminal. Switch to remote control first.",
      );
    }
    const catalog = await api.getSessionCodexModels(summary.id);
    if (!catalog.success)
      throw Error(catalog.error ?? "Model discovery failed");
    return {
      ...target,
      flavor,
      model: session.model,
      current: getDisplayedCodexServiceTier(session.serviceTier),
      fastAvailable: codexModelAdvertisesFastTier(
        session.model,
        catalog.models ?? [],
      ),
    };
  } catch (error) {
    return unavailable(
      error instanceof Error ? error.message : "Could not load speed settings.",
    );
  }
}

/** Rechecks session ownership and advertised Fast support immediately before each write. */
export async function applyServiceTierTargets(
  api: ApiClient,
  targets: ServiceTierTarget[],
  value: "fast" | "standard",
): Promise<ServiceTierResult[]> {
  const results: ServiceTierResult[] = [];
  for (const target of targets) {
    const result = (status: ServiceTierResult["status"], detail: string) =>
      results.push({ id: target.id, title: target.title, status, detail });
    if (target.unavailable) {
      result("skipped", target.unavailable);
      continue;
    }
    try {
      const { session } = await api.getSession(target.id);
      if (session.model !== target.model) {
        result(
          "skipped",
          "Model changed after preview. Refresh before applying.",
        );
        continue;
      }
      const fresh = await loadServiceTierTarget(api, session);
      if (fresh.unavailable || fresh.model !== target.model) {
        result(
          "skipped",
          fresh.unavailable ?? "Capabilities changed. Refresh before applying.",
        );
        continue;
      }
      if (value === "fast" && !fresh.fastAvailable) {
        result(
          "skipped",
          "Fast is no longer advertised for this model and account.",
        );
        continue;
      }
      if (fresh.current === value) {
        result("unchanged", "Already selected.");
        continue;
      }
      await api.setServiceTier(target.id, value);
      result(
        "applied",
        `${value === "fast" ? "Fast" : "Standard"} accepted for subsequent model requests.`,
      );
    } catch (error) {
      result(
        "failed",
        `${error instanceof Error ? error.message : "Request failed"}. Not retried; refresh to verify state.`,
      );
    }
  }
  return results;
}
