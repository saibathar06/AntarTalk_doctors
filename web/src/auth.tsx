import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, mutate, refreshSession, setAccessToken } from "./api";
import type { Profile } from "./types";
interface Auth {
  profile: Profile | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  signIn: (token: string) => Promise<void>;
  logout: (all?: boolean) => Promise<void>;
}
const Context = createContext<Auth>(null!);
export const useAuth = () => useContext(Context);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function reload() {
    setProfile(await api<Profile>("/api/doctor/profile"));
  }
  async function signIn(token: string) {
    setError("");
    setAccessToken(token);
    await reload();
  }
  async function logout(all = false) {
    await refreshSession();
    await mutate("/api/doctor/auth/logout", "POST", { allDevices: all });
    setAccessToken(null);
    setProfile(null);
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
      setError("Your session has expired. Please sign in again.");
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  return (
    <Context.Provider
      value={{ profile, loading, error, reload, signIn, logout }}
    >
      {children}
    </Context.Provider>
  );
}
