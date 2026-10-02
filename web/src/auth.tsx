import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, mutate, refreshSession, setAccessToken } from "./api";
import type { Profile, Viewer } from "./types";
interface Auth {
  challenge: PasswordChallenge | null;
  setChallenge: (challenge: PasswordChallenge | null) => void;
  profile: Profile | null;
  viewer: Viewer | null;
  loading: boolean;
  error: string;
  reload: () => Promise<Viewer>;
  signIn: (token: string) => Promise<Viewer>;
  logout: (all?: boolean) => Promise<void>;
}
export interface PasswordChallenge {
  challengeToken: string;
  email: string;
  purpose: "VERIFY_EMAIL" | "DOCTOR_LOGIN";
  status: "OTP_SENT" | "OTP_COOLDOWN";
  message: string;
  retryAfterSeconds: number;
  otpExpiresInSeconds: number | null;
}
const Context = createContext<Auth>(null!);
export const useAuth = () => useContext(Context);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [challenge, setChallenge] = useState<PasswordChallenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function reload() {
    const current = await api<Viewer>("/api/doctor/auth/me");
    setViewer(current);
    setProfile(
      current.role === "DOCTOR"
        ? await api<Profile>("/api/doctor/profile")
        : null,
    );
    return current;
  }
  async function signIn(token: string) {
    setChallenge(null);
    setError("");
    setAccessToken(token);
    return reload();
  }
  async function logout(all = false) {
    try {
      await refreshSession();
      await mutate("/api/doctor/auth/logout", "POST", { allDevices: all });
    } finally {
      setAccessToken(null);
      setProfile(null);
      setViewer(null);
      setChallenge(null);
    }
  }
  useEffect(() => {
    refreshSession()
      .then(reload)
      .catch((error) => {
        if (error.status !== 401) setError(error.message);
      })
      .finally(() => setLoading(false));
    const expire = () => {
      setProfile(null);
      setViewer(null);
      setError("Your session has expired. Please sign in again.");
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  return (
    <Context.Provider
      value={{
        profile,
        viewer,
        loading,
        error,
        reload,
        signIn,
        logout,
        challenge,
        setChallenge,
      }}
    >
      {children}
    </Context.Provider>
  );
}
