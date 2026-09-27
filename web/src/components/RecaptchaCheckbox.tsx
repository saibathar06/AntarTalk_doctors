import { useEffect, useRef, useState } from "react";
import ReCAPTCHA from "react-google-recaptcha";
import { apiWithAccessToken } from "../api";

type Config = { enabled: boolean; siteKey: string | null; mode?: string };
let configuration: Promise<Config> | null = null;
function getConfiguration() {
  // Reuse public configuration across form navigation, never cache tokens.
  return configuration ??= apiWithAccessToken<Config>("/api/doctor/auth/recaptcha-config", null)
    .catch((error) => { configuration = null; throw error; });
}

export function RecaptchaCheckbox({ onToken, resetVersion }: {
  onToken: (token: string) => void;
  resetVersion: number;
}) {
  const widget = useRef<ReCAPTCHA>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [message, setMessage] = useState("Loading security verification…");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    void getConfiguration().then((result) => {
      if (!result.enabled || !result.siteKey) throw new Error("Security verification is not configured. Please contact support.");
      if (result.mode && result.mode !== "v2_checkbox") throw new Error("Security verification requires a reCAPTCHA v2 Checkbox key.");
      if (live) setConfig(result);
    }).catch((error) => { if (live) setMessage((error as Error).message); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    widget.current?.reset();
    onToken("");
  }, [resetVersion, onToken]);

  useEffect(() => {
    if (!config || loaded) return;
    const timer = window.setTimeout(() => setMessage("Security verification could not load. Check your connection or browser extensions, then reload the page."), 20_000);
    return () => window.clearTimeout(timer);
  }, [config, loaded]);

  const localLink = import.meta.env.DEV && window.location.hostname === "127.0.0.1"
    ? `http://localhost:${window.location.port}${window.location.pathname}` : null;

  return <div className="recaptcha-field">
    {localLink && <p className="help">For local security verification, <a href={localLink}>open this page on localhost</a>.</p>}
    {config?.siteKey && <ReCAPTCHA
      ref={widget}
      sitekey={config.siteKey}
      size="normal"
      theme="light"
      asyncScriptOnLoad={() => { setLoaded(true); setMessage(""); }}
      onChange={(token) => { onToken(token ?? ""); setMessage(token ? "" : "Complete the security check to continue."); }}
      onExpired={() => { onToken(""); setMessage("Security verification expired. Please check the box again."); }}
      onErrored={() => { onToken(""); setMessage("Security verification failed. Please try again or reload the page."); }}
    />}
    {message && <p className="help" role="status">{message}</p>}
  </div>;
}
