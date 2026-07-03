import { useCallback, useEffect, useState } from "react";
import {
  getProviderStatus,
  getRuntimeConfig,
  type ProviderStatus,
} from "../lib/runtime";
import type { SidecarHealth } from "../lib/sidecar";

export type RuntimeHealth = "starting" | "ready" | "unavailable";

export function useRuntimeHealth() {
  const [health, setHealth] = useState<RuntimeHealth>("starting");
  const [message, setMessage] = useState("Starting local runtime…");
  const [providers, setProviders] = useState<ProviderStatus>({
    deepgramConfigured: false,
    cerebrasConfigured: false,
  });

  const refreshProviders = useCallback(async () => {
    setProviders(await getProviderStatus());
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    async function check(attempt = 0) {
      try {
        const runtime = await getRuntimeConfig();
        if (runtime.startupError) throw new Error(runtime.startupError);
        const response = await fetch(`${runtime.baseUrl}/health`);
        if (!response.ok)
          throw new Error(`Sidecar returned ${response.status}`);
        const status = (await response.json()) as SidecarHealth;
        if (cancelled) return;
        setHealth("ready");
        setMessage(
          status.providers.speech === "mock"
            ? "Local runtime ready · Mock providers"
            : "Local runtime ready",
        );
        await refreshProviders();
      } catch (error) {
        if (cancelled) return;
        // One-file PyInstaller binaries extract on first launch and can take
        // several seconds on slower machines.
        if (attempt < 40) {
          timer = window.setTimeout(() => void check(attempt + 1), 250);
          return;
        }
        setHealth("unavailable");
        setMessage(
          error instanceof Error ? error.message : "Local runtime unavailable",
        );
      }
    }

    void check();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [refreshProviders]);

  return { health, message, providers, refreshProviders };
}
