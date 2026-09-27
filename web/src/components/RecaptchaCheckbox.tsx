import { useEffect, useRef, useState } from "react";
import { apiWithAccessToken } from "../api";

type Config = { enabled: boolean; siteKey: string | null };
type Grecaptcha = { render: (element: HTMLElement, options: Record<string, unknown>) => number; reset: (id?: number) => void };
declare global { interface Window { grecaptcha?: Grecaptcha } }

let scriptPromise: Promise<void> | null = null;
function loadScript() {
  if (window.grecaptcha) return Promise.resolve();
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Security verification could not load."));
    document.head.append(script);
  });
  return scriptPromise;
}

export function RecaptchaCheckbox({ onToken }: { onToken: (token: string) => void }) {
  const target = useRef<HTMLDivElement>(null);
  const widget = useRef<number | undefined>(undefined);
  const [message, setMessage] = useState("Loading security verification…");
  useEffect(() => {
    let live = true;
    void apiWithAccessToken<Config>("/api/doctor/auth/recaptcha-config", null)
      .then(async (config) => {
        if (!config.enabled || !config.siteKey) throw new Error("Security verification is not configured. Please try again later.");
        await loadScript();
        if (!live || !target.current || !window.grecaptcha) return;
        widget.current = window.grecaptcha.render(target.current, {
          sitekey: config.siteKey,
          callback: (token: string) => { onToken(token); setMessage(""); },
          "expired-callback": () => { onToken(""); setMessage("Security verification expired. Please complete it again."); },
          "error-callback": () => { onToken(""); setMessage("Security verification failed to load. Please try again."); },
        });
        setMessage("");
      })
      .catch((error) => live && setMessage((error as Error).message));
    return () => { live = false; if (widget.current !== undefined) window.grecaptcha?.reset(widget.current); };
  }, [onToken]);
  return <div className="recaptcha-field"><div ref={target} />{message && <p className="help" role="status">{message}</p>}</div>;
}
