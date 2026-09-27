import { useEffect, useRef, useState } from "react";
import { apiWithAccessToken } from "../api";

type RecaptchaMode = "v2_checkbox" | "v3";
type Config = { enabled: boolean; siteKey: string | null; mode?: RecaptchaMode };
type Grecaptcha = {
  render?: (element: HTMLElement, options: Record<string, unknown>) => number;
  reset?: (id?: number) => void;
  ready?: (callback: () => void) => void;
  execute?: (siteKey: string, options: { action: string }) => Promise<string>;
};
type CheckboxApi = Required<Pick<Grecaptcha, "render" | "reset">>;
type ScoreApi = Required<Pick<Grecaptcha, "ready" | "execute">>;
declare global { interface Window { grecaptcha?: Grecaptcha } }

let scriptPromise: Promise<void> | null = null;
let loadedMode: RecaptchaMode | null = null;

function checkboxApi(): CheckboxApi | null {
  const captcha = window.grecaptcha;
  return typeof captcha?.render === "function" && typeof captcha?.reset === "function" ? captcha as CheckboxApi : null;
}
function scoreApi(): ScoreApi | null {
  const captcha = window.grecaptcha;
  return typeof captcha?.ready === "function" && typeof captcha?.execute === "function" ? captcha as ScoreApi : null;
}
function apiFor(mode: RecaptchaMode) {
  return mode === "v3" ? scoreApi() : checkboxApi();
}
function waitForApi(mode: RecaptchaMode): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (apiFor(mode)) resolve();
      else if (Date.now() - started >= 10_000) reject(new Error(mode === "v3"
        ? "Google reCAPTCHA did not load the score-based API. Check the configured v3 key."
        : "Google reCAPTCHA loaded, but the checkbox did not initialize. Check the v2 Checkbox key and browser console."));
      else window.setTimeout(check, 100);
    };
    check();
  });
}
function loadScript(mode: RecaptchaMode, siteKey: string) {
  if (apiFor(mode)) return Promise.resolve();
  if (scriptPromise && loadedMode === mode) return scriptPromise;
  if (scriptPromise) return Promise.reject(new Error("Security verification is still loading. Please try again in a moment."));
  loadedMode = mode;
  // A prior mount may have loaded api.js while its dependencies are still initializing.
  const existing = document.querySelector<HTMLScriptElement>('script[src^="https://www.google.com/recaptcha/api.js"]');
  if (existing) {
    scriptPromise = waitForApi(mode).catch((error) => { scriptPromise = null; loadedMode = null; throw error; });
    return scriptPromise;
  }
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = mode === "v3"
      ? `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`
      : "https://www.google.com/recaptcha/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => { void waitForApi(mode).then(resolve, reject); };
    script.onerror = () => reject(new Error("Security verification could not load."));
    document.head.append(script);
  }).catch((error) => {
    scriptPromise = null;
    loadedMode = null;
    throw error;
  });
  return scriptPromise;
}
function waitForScoreApi(api: ScoreApi) {
  return new Promise<void>((resolve) => api.ready(resolve));
}

export function RecaptchaCheckbox({ onToken, action }: { onToken: (token: string) => void; action: string }) {
  const target = useRef<HTMLDivElement>(null);
  const widget = useRef<number | undefined>(undefined);
  const [message, setMessage] = useState("Loading security verification…");
  useEffect(() => {
    let live = true;
    let refreshTimer: number | undefined;
    void apiWithAccessToken<Config>("/api/doctor/auth/recaptcha-config", null)
      .then(async (config) => {
        if (!config.enabled || !config.siteKey) throw new Error("Security verification is not configured. Please try again later.");
        const mode = config.mode ?? "v2_checkbox";
        await loadScript(mode, config.siteKey);
        if (!live) return;
        if (mode === "v3") {
          const captcha = scoreApi();
          if (!captcha) return;
          const issueToken = async () => {
            await waitForScoreApi(captcha);
            const token = await captcha.execute(config.siteKey!, { action });
            if (live) { onToken(token); setMessage(""); }
          };
          await issueToken();
          // v3 tokens are short-lived. Refresh while the form remains open.
          refreshTimer = window.setInterval(() => { void issueToken().catch(() => live && setMessage("Security verification expired. Please try again.")); }, 90_000);
          return;
        }
        const captcha = checkboxApi();
        if (!target.current || !captcha) return;
        widget.current = captcha.render(target.current, {
          sitekey: config.siteKey,
          callback: (token: string) => { onToken(token); setMessage(""); },
          "expired-callback": () => { onToken(""); setMessage("Security verification expired. Please complete it again."); },
          "error-callback": () => { onToken(""); setMessage("Security verification failed to load. Please try again."); },
        });
        setMessage("");
      })
      .catch((error) => live && setMessage((error as Error).message));
    return () => {
      live = false;
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
      const captcha = checkboxApi();
      if (widget.current !== undefined && captcha) captcha.reset(widget.current);
    };
  }, [action, onToken]);
  return <div className="recaptcha-field"><div ref={target} />{message && <p className="help" role="status">{message}</p>}</div>;
}
