import { useState } from "react";
import {
  deleteProviderCredential,
  saveProviderCredential,
  type ProviderStatus,
} from "../lib/runtime";

interface ProviderSettingsProps {
  status: ProviderStatus;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

const providers = [
  { id: "deepgram", label: "Deepgram", configured: "deepgramConfigured" },
  { id: "cerebras", label: "Cerebras", configured: "cerebrasConfigured" },
] as const;

export function ProviderSettings({
  status,
  onClose,
  onChanged,
}: ProviderSettingsProps) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save(provider: (typeof providers)[number]) {
    setBusy(provider.id);
    setMessage(null);
    try {
      await saveProviderCredential(provider.id, keys[provider.id] ?? "");
      setKeys((current) => ({ ...current, [provider.id]: "" }));
      await onChanged();
      setMessage(
        `${provider.label} key saved to your operating system credential store. Restart ZeroLag to activate it.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save the API key.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove(provider: (typeof providers)[number]) {
    setBusy(provider.id);
    setMessage(null);
    try {
      await deleteProviderCredential(provider.id);
      await onChanged();
      setMessage(`${provider.label} key removed.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not remove the API key.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-header">
          <div>
            <span className="card-kicker">Secure configuration</span>
            <h2 id="provider-settings-title">Provider keys</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        </div>
        <p className="settings-copy">
          Keys are stored in macOS Keychain or Windows Credential Manager.
          ZeroLag never writes them to project files or browser storage.
        </p>
        <div className="provider-list">
          {providers.map((provider) => {
            const configured = status[provider.configured];
            return (
              <div className="provider-row" key={provider.id}>
                <div className="provider-meta">
                  <strong>{provider.label}</strong>
                  <span
                    className={
                      configured
                        ? "provider-state provider-state--ready"
                        : "provider-state"
                    }
                  >
                    {configured ? "Configured" : "Not configured"}
                  </span>
                </div>
                <input
                  type="password"
                  value={keys[provider.id] ?? ""}
                  onChange={(event) =>
                    setKeys((current) => ({
                      ...current,
                      [provider.id]: event.target.value,
                    }))
                  }
                  placeholder={
                    configured ? "Enter a replacement key" : "Paste API key"
                  }
                  aria-label={`${provider.label} API key`}
                  autoComplete="off"
                />
                <div className="provider-actions">
                  <button
                    className="small-button small-button--primary"
                    type="button"
                    disabled={
                      busy !== null || !(keys[provider.id] ?? "").trim()
                    }
                    onClick={() => void save(provider)}
                  >
                    {busy === provider.id ? "Saving…" : "Save key"}
                  </button>
                  {configured ? (
                    <button
                      className="small-button"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void remove(provider)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {message ? (
          <p className="settings-message" role="status">
            {message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
