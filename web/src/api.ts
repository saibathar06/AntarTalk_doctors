import { ApiError } from "./requestError";
import { responseError } from "./httpError";
export { ApiError } from "./requestError";
let accessToken: string | null = null;
let refreshPromise: Promise<void> | null = null;
async function fetchApi(path: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(path, {
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
      credentials: "same-origin",
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
    credentials: "same-origin",
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
export const mutate = <T>(path: string, method: string, body: unknown) =>
  api<T>(path, { method, body: JSON.stringify(body) });
export async function fileUrl(path: string) {
  return URL.createObjectURL(await (await request(path)).blob());
}
