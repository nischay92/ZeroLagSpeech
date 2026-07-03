import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri";

export interface RuntimeConfig {
  baseUrl: string;
  token: string;
  startupError: string | null;
}

export interface ProviderStatus {
  deepgramConfigured: boolean;
  cerebrasConfigured: boolean;
}

const browserRuntime: RuntimeConfig = {
  baseUrl: import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:43110",
  token: import.meta.env.VITE_SIDECAR_TOKEN ?? "local-development-token",
  startupError: null,
};

let runtimePromise: Promise<RuntimeConfig> | null = null;

export function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (!runtimePromise) {
    runtimePromise = isTauriRuntime()
      ? invoke<RuntimeConfig>("runtime_config")
      : Promise.resolve(browserRuntime);
  }
  return runtimePromise;
}

export async function getProviderStatus(): Promise<ProviderStatus> {
  if (!isTauriRuntime()) {
    return { deepgramConfigured: false, cerebrasConfigured: false };
  }
  return invoke<ProviderStatus>("provider_status");
}

export async function saveProviderCredential(
  provider: string,
  apiKey: string,
): Promise<void> {
  if (!isTauriRuntime())
    throw new Error("Secure credentials require the desktop application.");
  await invoke("save_provider_credential", { provider, apiKey });
}

export async function deleteProviderCredential(
  provider: string,
): Promise<void> {
  if (!isTauriRuntime())
    throw new Error("Secure credentials require the desktop application.");
  await invoke("delete_provider_credential", { provider });
}
