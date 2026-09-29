import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@/api/client";
import type { SessionSummary } from "@/types/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { queryKeys } from "@/lib/query-keys";
import { getSessionTitle } from "@/lib/sessionTitle";
import {
  applyReasoningTargets,
  loadReasoningTarget,
  reasoningLabel,
  type ReasoningResult,
  type ReasoningTarget,
} from "@/lib/sessionReasoning";
import {
  applyServiceTierTargets,
  loadServiceTierTarget,
  type ServiceTierResult,
  type ServiceTierTarget,
} from "@/lib/sessionServiceTier";

const DEFAULT = "__default__";
const effortOrder = [
  "__default__",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];
type Tab = "reasoning" | "speed";
type Result = ReasoningResult | ServiceTierResult;

export function SessionReasoningControl(props: {
  api: ApiClient | null;
  sessions: SessionSummary[];
  bulk?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<SessionSummary[] | null>(null);
  if (!props.api || !props.sessions.length) return null;
  const single = !props.bulk;
  const label = single
    ? `Bot settings for ${getSessionTitle(props.sessions[0])}`
    : `Bot settings for ${props.sessions.length} sessions`;
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        className={
          single
            ? "absolute right-1 top-1 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-[var(--app-bg)] text-[var(--app-hint)] hover:text-[var(--app-link)] sm:opacity-0 sm:group-hover/reasoning-row:opacity-100 sm:group-focus-within/reasoning-row:opacity-100 [@media(hover:none)]:opacity-100"
            : "rounded-md px-3 py-1.5 text-xs text-[var(--app-link)] hover:bg-[var(--app-secondary-bg)]"
        }
        onClick={(event) => {
          event.stopPropagation();
          setSnapshot([...props.sessions]);
        }}
      >
        {single ? (
          <span aria-hidden="true">⚙</span>
        ) : (
          `Bot settings · ${props.sessions.length}`
        )}
      </button>
      {snapshot ? (
        <BotSettingsDialog
          api={props.api}
          sessions={snapshot}
          bulk={Boolean(props.bulk)}
          onClose={() => setSnapshot(null)}
        />
      ) : null}
    </>
  );
}

function BotSettingsDialog({
  api,
  sessions,
  bulk,
  onClose,
}: {
  api: ApiClient;
  sessions: SessionSummary[];
  bulk: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>("reasoning");
  const [reasoning, setReasoning] = useState<ReasoningTarget[]>([]);
  const [speed, setSpeed] = useState<ServiceTierTarget[]>([]);
  const [selected, setSelected] = useState(new Set<string>());
  const [reasoningValue, setReasoningValue] = useState(DEFAULT);
  const [speedValue, setSpeedValue] = useState<"fast" | "standard">("standard");
  const [filter, setFilter] = useState("");
  const [group, setGroup] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [results, setResults] = useState<Result[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResults(null);
    void (async () => {
      try {
        const loadedReasoning: ReasoningTarget[] = [];
        const loadedSpeed: ServiceTierTarget[] = [];
        for (let start = 0; start < sessions.length; start += 4) {
          const batch = sessions.slice(start, start + 4);
          const [nextReasoning, nextSpeed] = await Promise.all([
            Promise.all(
              batch.map((session) => loadReasoningTarget(api, session)),
            ),
            Promise.all(
              batch.map((session) => loadServiceTierTarget(api, session)),
            ),
          ]);
          loadedReasoning.push(...nextReasoning);
          loadedSpeed.push(...nextSpeed);
        }
        if (cancelled) return;
        setReasoning(loadedReasoning);
        setSpeed(loadedSpeed);
        setSelected(new Set(sessions.map((session) => session.id)));
        setReasoningValue(
          !bulk ? (loadedReasoning[0]?.current ?? DEFAULT) : DEFAULT,
        );
        setSpeedValue(
          !bulk ? (loadedSpeed[0]?.current ?? "standard") : "standard",
        );
      } catch {
        if (!cancelled) {
          setReasoning(
            sessions.map((session) => ({
              id: session.id,
              title: getSessionTitle(session),
              flavor: session.metadata?.flavor ?? "claude",
              model: session.model,
              current: null,
              options: [],
              action: "effort",
              unavailable: "Could not load settings. Refresh to try again.",
            })),
          );
          setSpeed(
            sessions.map((session) => ({
              id: session.id,
              title: getSessionTitle(session),
              flavor: session.metadata?.flavor ?? "claude",
              model: session.model,
              current: "standard",
              fastAvailable: false,
              unavailable: "Could not load settings. Refresh to try again.",
            })),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, bulk, refresh, sessions]);

  const targets = tab === "reasoning" ? reasoning : speed;
  const requested =
    tab === "reasoning"
      ? reasoningValue === DEFAULT
        ? null
        : reasoningValue
      : speedValue;
  const capabilityOptions = useMemo(
    () =>
      new Map(
        reasoning.flatMap((target) =>
          target.options.map(
            (option) => [option.value ?? DEFAULT, option.label] as const,
          ),
        ),
      ),
    [reasoning],
  );
  const flavor = (target: ReasoningTarget | ServiceTierTarget) => target.flavor;
  const groups = useMemo(
    () => [...new Set(targets.map(flavor))].sort(),
    [targets],
  );
  useEffect(() => {
    if (group !== "all" && !groups.includes(group)) setGroup("all");
  }, [group, groups]);
  const visible = targets.filter(
    (target) =>
      (group === "all" || flavor(target) === group) &&
      `${target.title} ${flavor(target)} ${target.model ?? ""}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  const supports = (target: ReasoningTarget | ServiceTierTarget) =>
    tab === "reasoning"
      ? (target as ReasoningTarget).options.some(
          (option) => option.value === requested,
        )
      : requested === "standard" || (target as ServiceTierTarget).fastAvailable;
  const eligible = targets.filter(
    (target) =>
      selected.has(target.id) && !target.unavailable && supports(target),
  );
  const selectedCount = targets.filter((target) =>
    selected.has(target.id),
  ).length;
  const selectVisible = () =>
    setSelected((previous) => {
      const next = new Set(previous);
      const allSelected =
        visible.length > 0 && visible.every((target) => next.has(target.id));
      for (const target of visible)
        allSelected ? next.delete(target.id) : next.add(target.id);
      return next;
    });
  const apply = async () => {
    setBusy(true);
    try {
      const chosen = targets.filter((target) => selected.has(target.id));
      const next =
        tab === "reasoning"
          ? await applyReasoningTargets(
              api,
              chosen as ReasoningTarget[],
              requested as string | null,
            )
          : await applyServiceTierTargets(
              api,
              chosen as ServiceTierTarget[],
              requested as "fast" | "standard",
            );
      setResults(next);
      await client.invalidateQueries({ queryKey: queryKeys.sessions });
      await Promise.all(
        chosen.map((target) =>
          client.invalidateQueries({ queryKey: queryKeys.session(target.id) }),
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const resultText =
    results &&
    `${results.filter((r) => r.status === "applied").length} applied · ${results.filter((r) => r.status === "unchanged").length} already selected · ${results.filter((r) => r.status === "skipped").length} skipped · ${results.filter((r) => r.status === "failed").length} not confirmed`;
  const requestedLabel =
    tab === "reasoning"
      ? reasoningLabel(requested as string | null)
      : requested === "fast"
        ? "Fast"
        : "Standard";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[min(85dvh,calc(var(--app-viewport-height,100dvh)-24px))] flex-col gap-0 overflow-hidden p-0"
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <div className="shrink-0 px-4 pt-4">
        <DialogHeader>
          <DialogTitle>
            {bulk
              ? "Bot settings across sessions"
              : `Bot settings: ${getSessionTitle(sessions[0])}`}
          </DialogTitle>
          <DialogDescription>
            Changes apply to later model requests. Each bot is checked again
            before an update; unavailable bots stay unchanged.
          </DialogDescription>
        </DialogHeader>
        <div
          className="mt-4 flex gap-2"
          role="tablist"
          aria-label="Bot settings"
        >
          {(["reasoning", "speed"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              disabled={busy}
              aria-selected={tab === value}
              className={`rounded px-3 py-1.5 text-sm disabled:opacity-40 ${tab === value ? "bg-[var(--app-secondary-bg)] text-[var(--app-link)]" : ""}`}
              onClick={() => {
                setTab(value);
                setResults(null);
              }}
            >
              {value === "reasoning" ? "Reasoning" : "Speed"}
            </button>
          ))}
        </div>
        {loading ? (
          <p role="status" className="py-4 text-sm">
            Checking supported settings…
          </p>
        ) : (
          <>
            {!results ? (
              <>
                <label className="mt-4 block text-sm">
                  {tab === "reasoning"
                    ? "Requested reasoning level"
                    : "Requested speed"}
                  {tab === "reasoning" ? (
                    <select
                      aria-label="Requested reasoning level"
                      disabled={busy || !capabilityOptions.size}
                      value={
                        capabilityOptions.has(reasoningValue)
                          ? reasoningValue
                          : ""
                      }
                      onChange={(event) =>
                        setReasoningValue(event.target.value)
                      }
                      className="mt-1 w-full rounded border border-[var(--app-divider)] bg-[var(--app-bg)] p-2"
                    >
                      {[...capabilityOptions]
                        .sort(
                          ([a], [b]) =>
                            (effortOrder.indexOf(a) < 0
                              ? 99
                              : effortOrder.indexOf(a)) -
                              (effortOrder.indexOf(b) < 0
                                ? 99
                                : effortOrder.indexOf(b)) || a.localeCompare(b),
                        )
                        .map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <select
                      aria-label="Requested speed"
                      disabled={busy}
                      value={speedValue}
                      onChange={(event) =>
                        setSpeedValue(event.target.value as "fast" | "standard")
                      }
                      className="mt-1 w-full rounded border border-[var(--app-divider)] bg-[var(--app-bg)] p-2"
                    >
                      <option value="standard">Standard</option>
                      <option value="fast">Fast</option>
                    </select>
                  )}
                </label>
                <p className="my-2 text-xs text-[var(--app-hint)]">
                  Requested: {requestedLabel}. Supported by {eligible.length} of{" "}
                  {selectedCount} selected bots;{" "}
                  {selectedCount - eligible.length} will be skipped.
                </p>
                {bulk ? (
                  <div className="mb-2 grid gap-2 sm:grid-cols-2">
                    <input
                      aria-label="Filter bots"
                      disabled={busy}
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                      placeholder="Filter bots"
                      className="rounded border border-[var(--app-divider)] bg-[var(--app-bg)] px-2 py-1 text-sm"
                    />
                    <select
                      aria-label="Filter bot group"
                      disabled={busy}
                      value={group}
                      onChange={(event) => setGroup(event.target.value)}
                      className="rounded border border-[var(--app-divider)] bg-[var(--app-bg)] px-2 py-1 text-sm"
                    >
                      <option value="all">All providers</option>
                      {groups.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy || !visible.length}
                      className="text-left text-xs text-[var(--app-link)] disabled:opacity-40"
                      onClick={selectVisible}
                    >
                      {visible.every((target) => selected.has(target.id))
                        ? "Deselect filtered"
                        : "Select filtered"}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <p role="status" className="my-3 text-sm">
                {resultText}
              </p>
            )}
          </>
        )}
        </div>
        {!loading ? (
          <>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-2">
              {visible.map((target) => {
                const outcome = results?.find(
                  (result) => result.id === target.id,
                );
                const current =
                  tab === "reasoning"
                    ? reasoningLabel((target as ReasoningTarget).current)
                    : (target as ServiceTierTarget).current === "fast"
                      ? "Fast"
                      : "Standard";
                const detail =
                  target.unavailable ??
                  (supports(target)
                    ? "Requested setting supported."
                    : "Requested setting unsupported; will skip.");
                return (
                  <li
                    key={target.id}
                    className="rounded border border-[var(--app-divider)] p-2 text-sm"
                  >
                    <label className="flex items-center gap-2">
                      {bulk && !results ? (
                        <input
                          type="checkbox"
                          aria-label={`Include ${target.title}`}
                          disabled={busy}
                          checked={selected.has(target.id)}
                          onChange={(event) =>
                            setSelected((previous) => {
                              const next = new Set(previous);
                              event.target.checked
                                ? next.add(target.id)
                                : next.delete(target.id);
                              return next;
                            })
                          }
                        />
                      ) : null}
                      <span className="min-w-0 break-words font-medium">
                        {target.title}
                      </span>
                    </label>
                    <p className="text-xs text-[var(--app-hint)] break-words">
                      {flavor(target)} · {target.model ?? "Default model"} ·{" "}
                      {current}
                    </p>
                    <p className="mt-1 text-xs break-words">
                      {outcome
                        ? `${outcome.status}: ${outcome.detail}`
                        : results
                          ? "Not selected; unchanged."
                          : detail}
                    </p>
                  </li>
                );
              })}
            </ul>
            <div className="shrink-0 border-t border-[var(--app-divider)] px-4 py-3">
              <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded border border-[var(--app-divider)] px-3 py-2 text-sm"
                onClick={() => setRefresh((value) => value + 1)}
              >
                Refresh
              </button>
              {!results ? (
                <button
                  type="button"
                  disabled={
                    busy ||
                    !eligible.length ||
                    (tab === "reasoning" &&
                      !capabilityOptions.has(reasoningValue))
                  }
                  onClick={() => void apply()}
                  className="rounded bg-[var(--app-button)] px-3 py-2 text-sm text-[var(--app-button-text)] disabled:opacity-40"
                >
                  {busy
                    ? "Applying…"
                    : `Apply to ${eligible.length} bot${eligible.length === 1 ? "" : "s"}`}
                </button>
              ) : null}
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
