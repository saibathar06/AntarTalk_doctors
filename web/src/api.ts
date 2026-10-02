import { ApiError } from "./requestError";
import { responseError } from "./httpError";
export { ApiError } from "./requestError";
let accessToken: string | null = null;
let refreshPromise: Promise<void> | null = null;

const configuredApiOrigin = String(
  import.meta.env.VITE_DOCTOR_API_ORIGIN ?? "",
).trim();

function apiEndpoint(path: string): string {
  if (!configuredApiOrigin) return path;
  const origin = new URL(configuredApiOrigin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    origin.hostname,
  );
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback))
  ) {
    throw new Error(
      "VITE_DOCTOR_API_ORIGIN must be an HTTPS origin (or loopback HTTP origin) without credentials or a path.",
    );
  }
  return new URL(path, origin).toString();
}

async function fetchApi(path: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(apiEndpoint(path), {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(125000),
    });
  } catch (error) {
    throw new ApiError(
      0,
      "API_CONNECTION_FAILED",
      (error as Error).name === "TimeoutError"
        ? "The hosted API took too long to respond. Registration may have completed; check email verification before submitting again."
        : "The API connection was interrupted. Check your connection and use email verification before repeating registration.",
    );
  }
}
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export async function refreshSession() {
  const rotate = async () => {
    const response = await fetchApi("/api/doctor/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) {
      accessToken = null;
      throw await responseError(response);
    }
    const payload = await response.json();
    accessToken = payload.data.accessToken;
  };
  // Serialize cookie rotation across tabs as well as callers in this tab.
  if (!refreshPromise)
    refreshPromise = (
      navigator.locks
        ? navigator.locks.request("antartalk-refresh", rotate)
        : rotate()
    ).finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}
async function request(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetchApi(path, {
    ...options,
    headers,
    credentials: "include",
  });
  if (response.status === 401 && retry && !path.includes("/auth/")) {
    try {
      await refreshSession();
    } catch (error) {
      window.dispatchEvent(new Event("session-expired"));
      throw error;
    }
    return request(path, options, false);
  }
  if (!response.ok) {
    throw await responseError(response);
  }
  return response;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  return (await (await request(path, options)).json()).data;
}

// Client booking keeps its own in-memory token flow. It must never trigger the
// Doctors-app refresh endpoint or persist a client token in browser storage.
export async function apiWithAccessToken<T>(
  path: string,
  accessToken: string | null,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetchApi(path, {
    ...options,
    headers,
    credentials: "include",
  });
  if (!response.ok) throw await responseError(response);
  return (await response.json()).data;
}
export const mutate = <T>(path: string, method: string, body: unknown) =>
  api<T>(path, { method, body: JSON.stringify(body) });
export async function fileUrl(path: string) {
  return URL.createObjectURL(await (await request(path)).blob());
}
