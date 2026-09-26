import { ApiError } from "./requestError";

export async function responseError(response: Response): Promise<ApiError> {
  const payload = await response.json().catch(() => null);
  const details = payload?.error?.details?.fieldErrors;
  const validationMessages = details
    ? Object.values(details)
        .flat()
        .filter((value) => typeof value === "string")
        .slice(0, 4)
        .join(" ")
    : "";
  const gateway = [502, 503, 504].includes(response.status);
  const fallback = gateway
    ? "The hosted API could not complete this request. Registration may already exist; use email verification before submitting again."
    : "The request could not be completed. Please try again.";
  const id = response.headers.get("x-request-id");
  const requestId = id && /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : undefined;
  return new ApiError(
    response.status,
    payload?.error?.code ?? (gateway ? "API_UNAVAILABLE" : "REQUEST_FAILED"),
    (validationMessages || payload?.error?.message || fallback) +
      (requestId ? ` Reference: ${requestId}` : ""),
    requestId,
  );
}
