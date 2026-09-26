let accessToken: string | null = null;
let refreshPromise: Promise<void> | null = null;
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export async function refreshSession() {
  const rotate = async () => {
    const response = await fetch("/api/doctor/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const payload = await response.json();
    if (!response.ok) {
      accessToken = null;
      throw new ApiError(
        response.status,
        payload.error?.code,
        payload.error?.message ?? "Please sign in again.",
      );
    }
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
  const response = await fetch(path, {
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
    const payload = await response.json().catch(() => null);
    const details = payload?.error?.details?.fieldErrors;
    const validationMessages = details
      ? Object.values(details)
          .flat()
          .filter((value) => typeof value === "string")
          .slice(0, 4)
          .join(" ")
      : "";
    throw new ApiError(
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
      validationMessages ||
        payload?.error?.message ||
        "Unable to connect. Please retry.",
    );
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
