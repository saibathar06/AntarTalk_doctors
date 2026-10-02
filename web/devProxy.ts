import type { Plugin, ProxyOptions } from "vite";
import { randomUUID } from "node:crypto";
import { ServerResponse } from "node:http";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
export function apiTarget(value: string): URL {
  const target = new URL(value);
  if (
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    (target.protocol !== "https:" &&
      !(target.protocol === "http:" && loopbackHosts.has(target.hostname)))
  ) {
    throw new Error(
      "DOCTOR_API_TARGET must be an HTTPS origin or a loopback HTTP origin, without credentials or a path.",
    );
  }
  return target;
}

export function isLocalRequest(
  host: string | undefined,
  origin: string | undefined,
  address: string | undefined,
  method: string | undefined,
): boolean {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address ?? ""))
    return false;
  try {
    const local = new URL(`http://${host}`);
    if (!loopbackHosts.has(local.hostname)) return false;
    // Never turn a cross-site browser request into a trusted upstream Origin.
    if (origin) return origin === local.origin;
    return ["GET", "HEAD", "OPTIONS"].includes(method ?? "");
  } catch {
    return false;
  }
}

export function localCookie(cookie: string): string {
  // Only the doctor refresh cookie is adapted for the HTTP loopback development server.
  // HttpOnly, expiry and Path are retained. Production is untouched. A production
  // cross-site cookie uses SameSite=None + Secure; loopback HTTP requires Lax.
  if (!cookie.startsWith("antartalk_doctor_refresh=")) return cookie;
  return cookie
    .replace(/;\s*Secure(?=;|$)/gi, "")
    .replace(/;\s*SameSite=None/gi, "; SameSite=Lax")
    .replace(/;\s*Domain=[^;]*/gi, "");
}

export function localApiGuard(): Plugin {
  return {
    name: "doctor-loopback-api-guard",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!(req.url === "/api" || req.url?.startsWith("/api/")))
          return next();
        if (
          !isLocalRequest(
            req.headers.host,
            req.headers.origin,
            req.socket.remoteAddress,
            req.method,
          )
        ) {
          res.statusCode = 403;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: false,
              error: {
                code: "DEV_ORIGIN_DENIED",
                message: "Use the loopback doctor website on the same origin.",
              },
            }),
          );
          return;
        }
        // Correlate local gateway failures with Render logs without logging PII.
        req.headers["x-request-id"] = randomUUID();
        res.setHeader("X-Request-Id", req.headers["x-request-id"]);
        next();
      });
    },
  };
}

export function doctorProxy(target: URL): ProxyOptions {
  return {
    target: target.origin,
    changeOrigin: true,
    secure: true,
    proxyTimeout: 120000,
    configure(proxy) {
      proxy.on("error", (error, request, response) => {
        const requestId = request.headers["x-request-id"];
        console.error(
          JSON.stringify({
            event: "doctor_proxy_connection_failed",
            requestId,
            errorCode: (error as NodeJS.ErrnoException).code,
            method: request.method,
          }),
        );
        if (
          !(response instanceof ServerResponse) ||
          response.headersSent ||
          response.writableEnded
        )
          return;
        response.writeHead(502, {
          "Content-Type": "application/json",
          "X-AntarTalk-Gateway": "local-proxy",
        });
        response.end(
          JSON.stringify({
            success: false,
            error: {
              code: "API_CONNECTION_FAILED",
              message:
                "The local website could not get a response from the hosted API. Registration may have completed; check email verification before submitting again.",
            },
          }),
        );
      });
      proxy.on("proxyRes", (response) => {
        response.headers["x-antartalk-gateway"] = "upstream-response";
        if (response.headers["set-cookie"])
          response.headers["set-cookie"] =
            response.headers["set-cookie"].map(localCookie);
      });
    },
  };
}
