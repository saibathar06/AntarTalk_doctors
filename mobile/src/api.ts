import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const baseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const accessKey = 'antartalk.doctor.access';
const refreshKey = 'antartalk.doctor.refresh';
let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshFlight: Promise<void> | null = null;
export class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export const apiBaseUrl = () => baseUrl;
export const authenticatedHeaders = (): Record<string, string> => accessToken ? { Authorization: `Bearer ${accessToken}`, 'X-Client-Surface': 'MOBILE' } : { 'X-Client-Surface': 'MOBILE' };
export const authenticatedFileSource = (path: string) => ({ uri: endpoint(path), headers: authenticatedHeaders() });
// Verified doctors' display photos are already public to booking clients. Using the public
// image route avoids platform-specific failures when React Native image loaders drop headers.
export const publicDoctorPhotoSource = (doctorId: string, version: string | null) => ({ uri: endpoint(`/api/bookings/doctors/${doctorId}/photo${version ? `?v=${encodeURIComponent(version)}` : ''}`) });

const publicErrorMessages: Record<string, string> = {
  INVALID_CREDENTIALS: 'The email or password is incorrect.',
  ACCOUNT_UNAVAILABLE: 'This account is currently unavailable.',
  EMAIL_NOT_VERIFIED: 'Verify your email before signing in.',
  INVALID_OTP: 'The verification code is invalid or has expired.',
  AUTH_CHALLENGE_EXPIRED: 'This sign-in step has expired. Please sign in again.',
  INVALID_REFRESH_TOKEN: 'Your session has ended. Please sign in again.',
  SESSION_REVOKED: 'Your session has ended. Please sign in again.',
  AUTHENTICATION_REQUIRED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have permission to do that.',
  VALIDATION_ERROR: 'Review the highlighted details and try again.',
  REGISTRATION_CONFLICT: 'An account already uses these registration details.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  MOBILE_AUTH_UNAVAILABLE: 'Secure sign-in is temporarily unavailable. Please try again shortly.',
  REQUEST_TIMEOUT: 'The server took too long to respond. Please retry.',
  NETWORK_UNAVAILABLE: 'Unable to reach AntarTalk. Check your connection and retry.',
  API_NOT_CONFIGURED: 'The app connection is not configured.'
};
function publicErrorMessage(status: number, code: string) { return publicErrorMessages[code] ?? (status >= 500 ? 'We could not complete that request. Please try again shortly.' : 'We could not complete that request. Please try again.'); }
function endpoint(path: string) { if (!baseUrl) throw new ApiError(0, 'API_NOT_CONFIGURED', publicErrorMessage(0, 'API_NOT_CONFIGURED')); return `${baseUrl}${path}`; }
async function parseError(response: Response) { const body = await response.json().catch(() => null); const code = body?.error?.code ?? 'REQUEST_FAILED'; return new ApiError(response.status, code, publicErrorMessage(response.status, code)); }
export async function restoreTokens() { [accessToken, refreshToken] = await Promise.all([SecureStore.getItemAsync(accessKey), SecureStore.getItemAsync(refreshKey)]); return Boolean(accessToken && refreshToken); }
async function persist(tokens: { accessToken: string; refreshToken: string }) { accessToken = tokens.accessToken; refreshToken = tokens.refreshToken; await Promise.all([SecureStore.setItemAsync(accessKey, accessToken), SecureStore.setItemAsync(refreshKey, refreshToken)]); }
export async function clearTokens() { accessToken = null; refreshToken = null; await Promise.all([SecureStore.deleteItemAsync(accessKey), SecureStore.deleteItemAsync(refreshKey)]); }
async function raw(path: string, init: RequestInit = {}) { const headers = new Headers(init.headers); headers.set('Accept', 'application/json'); headers.set('X-Client-Surface', 'MOBILE'); if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`); if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json'); try { return await fetch(endpoint(path), { ...init, headers, signal: init.signal ?? AbortSignal.timeout(30_000) }); } catch (error) { const code = (error as Error).name === 'TimeoutError' ? 'REQUEST_TIMEOUT' : 'NETWORK_UNAVAILABLE'; throw new ApiError(0, code, publicErrorMessage(0, code)); } }
export async function refresh() { if (!refreshToken) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Sign in to continue.'); if (!refreshFlight) refreshFlight = (async () => { const response = await raw('/api/doctor/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }); if (!response.ok) { await clearTokens(); throw await parseError(response); } const data = (await response.json()).data; if (!data.refreshToken) { await clearTokens(); throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Sign in to continue.'); } await persist(data); })().finally(() => { refreshFlight = null; }); return refreshFlight; }
export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> { const response = await raw(path, init); if (response.status === 401 && retry && !path.includes('/auth/')) { await refresh(); return api<T>(path, init, false); } if (!response.ok) throw await parseError(response); return (await response.json()).data as T; }
export const json = <T>(path: string, method: string, body?: unknown, headers?: HeadersInit) => api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers });
export async function upload<T>(path: string, uri: string, name: string, mimeType: string) { const form = new FormData(); form.append('file', { uri, name, type: mimeType } as unknown as Blob); return api<T>(path, { method: 'POST', body: form }); }
export async function beginLogin(email: string, password: string) { return json<any>('/api/doctor/auth/login', 'POST', { email, password }); }
export async function registerDoctor(input: unknown) { return json<any>('/api/doctor/auth/register', 'POST', input); }
export async function verifyOtp(challengeToken: string, otp: string) { const data = await json<{ accessToken?: string; refreshToken?: string }>('/api/doctor/auth/verify-otp', 'POST', { challengeToken, otp }); if (typeof data.accessToken !== 'string' || typeof data.refreshToken !== 'string') throw new ApiError(500, 'MOBILE_AUTH_UNAVAILABLE', publicErrorMessage(500, 'MOBILE_AUTH_UNAVAILABLE')); await persist({ accessToken: data.accessToken, refreshToken: data.refreshToken }); return data; }
export async function resendOtp(challengeToken: string) { return json<any>('/api/doctor/auth/send-otp', 'POST', { challengeToken }); }
export async function logout(allDevices = false) { try { await json('/api/doctor/auth/logout', 'POST', { allDevices, refreshToken }); } finally { await clearTokens(); } }
export const platform = Platform.OS === 'ios' ? 'IOS' : 'ANDROID';
