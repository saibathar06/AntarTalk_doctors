import { useState } from "react";
import {
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  CalendarCheckIcon,
  ClockIcon,
  GearSixIcon,
  HeartbeatIcon,
  HouseIcon,
  ListIcon,
  SignOutIcon,
  UserCircleIcon,
  UsersIcon,
  WalletIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useAuth } from "./auth";
import { DoctorAvatar, ErrorState, LoadingState, TransitionLoader } from "./components";
import { AuthPage } from "./pages/AuthPages";
import {
  AppointmentsPage,
  ClientsPage,
  DashboardPage,
  EarningsPage,
} from "./pages/WorkspacePages";
import { ProfilePage } from "./pages/ProfilePage";
import { AvailabilityPage } from "./pages/AvailabilityPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AdminVerificationPage } from "./pages/AdminVerificationPage";
import { BookSessionPage } from "./pages/BookSessionPage";

const links = [
  ["dashboard", "Dashboard", HouseIcon],
  ["appointments", "Appointments", CalendarCheckIcon],
  ["clients", "Clients", UsersIcon],
  ["availability", "Availability", ClockIcon],
  ["profile", "Profile", UserCircleIcon],
  ["earnings", "Earnings", WalletIcon],
  ["settings", "Settings", GearSixIcon],
] as const;
function DoctorLayout() {
  const { profile, viewer, loading, logout } = useAuth();
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const navigate = useNavigate(),
    location = useLocation();
  if (loading) return <LoadingState />;
  if (viewer?.role === "ADMIN") return <Navigate to="/doctor/admin" replace />;
  if (!profile) return <Navigate to="/doctor/login" replace />;
  const verified = profile.verificationStatus === "VERIFIED";
  if (!verified && !["/doctor", "/doctor/dashboard", "/doctor/profile", "/doctor/settings"].includes(location.pathname)) {
    return <Navigate to="/doctor/dashboard" replace />;
  }
  async function signOut() {
    setBusy(true);
    try {
      await logout();
      navigate("/doctor/login");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {open && (
        <button
          className="nav-overlay"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <NavLink className="brand" to="/doctor/dashboard">
          <HeartbeatIcon weight="bold" />
          AntarTalk<span>PROFESSIONALS</span>
        </NavLink>
        <button
          className="icon-button mobile-close"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        >
          <XIcon />
        </button>
        <p className="nav-label">YOUR WORKSPACE</p>
        <nav aria-label="Doctor navigation">
          {links.filter(([path]) => verified || ["dashboard", "profile", "settings"].includes(path)).map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={`/doctor/${path}`}
              onClick={() => setOpen(false)}
            >
              <Icon size={21} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <HeartbeatIcon size={24} />
            <p>
              A little care for yourself,
              <br />
              between caring for others.
            </p>
          </div>
          <button disabled={busy} className="logout" onClick={signOut}>
            <SignOutIcon size={21} />
            {busy ? "Signing out…" : "Log out"}
          </button>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label="Open navigation"
          >
            <ListIcon size={24} />
          </button>
          <span className="breadcrumb">
            Your workspace <span>/</span>{" "}
            {links.find(([path]) => location.pathname.endsWith(path))?.[1]}
          </span>
          <div className="topbar-right">
            <span className="practice-indicator">
              <i />
              {profile.canTakeSessions
                ? "Accepting sessions"
                : "Practice setup"}
            </span>
            <NavLink className="profile-chip" to="/doctor/profile">
              <DoctorAvatar profile={profile} />
              <span>
                {profile.firstName || "Your profile"}
                <small>
                  {profile.professionalStatus === "FINAL_YEAR_STUDENT"
                    ? "Final-year student"
                    : "Professional"}
                </small>
              </span>
            </NavLink>
          </div>
        </header>
        <main id="main" className="main-content">
          <ErrorState message={error} />
          <Outlet />
        </main>
        <footer className="workspace-footer">
          AntarTalk for Professionals
          <span>A thoughtful space for meaningful care.</span>
        </footer>
      </div>
      {busy && <TransitionLoader label="Signing you out securely…" />}
    </div>
  );
}
function AdminLayout() {
  const { viewer, loading } = useAuth();
  if (loading) return <LoadingState />;
  if (!viewer) return <Navigate to="/doctor/login" replace />;
  if (viewer.role !== "ADMIN") return <Navigate to="/doctor/dashboard" replace />;
  return <AdminVerificationPage />;
}
export function App() {
  return (
    <Routes>
      <Route path="/book-session/:doctorId" element={<BookSessionPage />} />
      <Route path="/doctor/login" element={<AuthPage mode="login" />} />
      <Route path="/doctor/register" element={<AuthPage mode="register" />} />
      <Route path="/doctor/verify" element={<AuthPage mode="verify" />} />
      <Route path="/doctor/forgot-password" element={<AuthPage mode="forgot" />} />
      <Route path="/doctor/reset-password" element={<AuthPage mode="reset" />} />
      <Route path="/doctor/admin" element={<AdminLayout />} />
      <Route path="/doctor" element={<DoctorLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="schedule" element={<Navigate to="/doctor/appointments" replace />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="availability" element={<AvailabilityPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="earnings" element={<EarningsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/doctor/dashboard" replace />} />
    </Routes>
  );
}
