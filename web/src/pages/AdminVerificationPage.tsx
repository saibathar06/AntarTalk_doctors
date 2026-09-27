import { useState } from "react";
import {
  CheckCircleIcon,
  FileArrowDownIcon,
  SignOutIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { fileUrl, mutate } from "../api";
import { useAuth } from "../auth";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pager,
  TransitionLoader,
  useResource,
} from "../components";
import type { Page, VerificationRequest } from "../types";

const label = (value: string | null | undefined) => value?.trim() || "Not provided";
const formatDateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "Not submitted";

export function AdminVerificationPage() {
  const { logout } = useAuth();
  const [view, setView] = useState<"queue" | "doctors">("queue");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<VerificationRequest | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const path = view === "queue"
    ? `/api/admin/verification-requests?page=${page}&limit=25`
    : `/api/admin/doctors?page=${page}&limit=25`;
  const { data, error, loading, reload } = useResource<Page<VerificationRequest>>(path);
  const canReview = selected?.verificationStatus === "PENDING" && Boolean(selected.verificationSubmittedAt);

  function switchView(next: "queue" | "doctors") {
    setView(next);
    setPage(1);
    setSelected(null);
    setReason("");
    setActionError("");
  }
  async function decide(status: "VERIFIED" | "REJECTED") {
    if (!selected || !canReview) return;
    if (status === "REJECTED" && reason.trim().length < 3) {
      setActionError("Add a clear reason of at least three characters before rejecting.");
      return;
    }
    setBusy(true);
    setBusyLabel(status === "VERIFIED" ? "Approving this professional…" : "Returning this profile for correction…");
    setActionError("");
    setNotice("");
    try {
      await mutate(`/api/admin/doctors/${selected.id}/verification`, "PATCH", {
        status,
        reason: status === "REJECTED" ? reason.trim() : undefined,
        expectedUpdatedAt: selected.updatedAt,
      });
      setNotice(status === "VERIFIED"
        ? "Professional verification approved. They must still enable bookings themselves."
        : "Verification request rejected with the reason provided.");
      setSelected(null);
      setReason("");
      reload();
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }
  async function downloadDocument() {
    if (!selected?.licenseDocumentUrl) return;
    setBusy(true);
    setBusyLabel("Preparing the credential document…");
    setActionError("");
    try {
      const url = await fileUrl(`/api/admin/doctors/${selected.id}/license-document`);
      const extension = selected.licenseDocumentUrl.endsWith(".pdf") ? "pdf" : "jpg";
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `credential-document.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice("Credential document download started.");
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }
  async function signOut() {
    setBusy(true);
    setBusyLabel("Signing you out securely…");
    try {
      await logout();
      window.location.assign("/doctor/login");
    } catch (error) {
      setActionError((error as Error).message);
      setBusy(false);
      setBusyLabel("");
    }
  }

  return (
    <>
      <main className="admin-page">
        <header className="admin-topbar">
          <div>
            <p className="eyebrow">ANTARTALK · ADMIN</p>
            <h1>Professional verification</h1>
          </div>
          <button className="button secondary small" disabled={busy} onClick={signOut}>
            <SignOutIcon /> Log out
          </button>
        </header>
        <PageHeader
          eyebrow={view === "queue" ? "REVIEW QUEUE" : "DOCTOR DIRECTORY"}
          title={view === "queue" ? "Review submitted profiles" : "Doctor directory"}
          description={view === "queue"
            ? "Approve credentials or return a clear reason. Approval never turns on bookings automatically."
            : "Browse professional profiles and their verification status. This directory contains no client or clinical data."}
        />
        <div className="admin-tabs" role="tablist" aria-label="Administrator views">
          <button role="tab" aria-selected={view === "queue"} className={view === "queue" ? "active" : ""} onClick={() => switchView("queue")}>Review queue</button>
          <button role="tab" aria-selected={view === "doctors"} className={view === "doctors" ? "active" : ""} onClick={() => switchView("doctors")}>All doctors</button>
        </div>
        <ErrorState message={error || actionError} />
        {notice && <div className="alert" role="status">{notice}</div>}
        {loading ? <LoadingState label={view === "queue" ? "Loading review requests…" : "Loading doctors…"} />
          : !data?.items.length ? <section className="card"><EmptyState title={view === "queue" ? "No profiles are waiting for review" : "No doctor profiles yet"}>{view === "queue" ? "Submitted, complete professional profiles appear here." : "Doctor profiles will appear here after registration."}</EmptyState></section>
            : <div className="admin-review-grid">
              <section className="card admin-queue">
                <h2>{data.pagination.total} {view === "queue" ? "awaiting review" : "doctor profiles"}</h2>
                {data.items.map((doctor) => <button key={doctor.id} className={`review-row ${selected?.id === doctor.id ? "selected" : ""}`} onClick={() => { setSelected(doctor); setReason(""); setActionError(""); }}>
                  <strong>{doctor.firstName} {doctor.lastName}</strong>
                  <span>{doctor.professionalCategory.replace("_", " ")} · {doctor.verificationStatus}</span>
                </button>)}
                <Pager pagination={data.pagination} onPage={(nextPage) => { setPage(nextPage); setSelected(null); }} />
              </section>
              <section className="card admin-detail">
                {selected ? <>
                  <div className="admin-detail-heading">
                    <div><p className="eyebrow">{canReview ? "PROFILE REVIEW" : "DOCTOR PROFILE"}</p><h2>{selected.firstName} {selected.lastName}</h2><p>{selected.email} · {selected.phoneNumber}</p></div>
                    <span className={`badge ${selected.verificationStatus.toLowerCase()}`}>{selected.verificationStatus}</span>
                  </div>
                  <div className="review-facts">
                    <div><small>Category</small><strong>{selected.professionalCategory.replace("_", " ")}</strong></div>
                    <div><small>Professional status</small><strong>{selected.professionalStatus.replaceAll("_", " ")}</strong></div>
                    <div><small>Qualification</small><strong>{label(selected.qualification)}</strong></div>
                    <div><small>Institution</small><strong>{label(selected.institution)}</strong></div>
                    <div><small>Submitted for review</small><strong>{formatDateTime(selected.verificationSubmittedAt)}</strong></div>
                    <div><small>Accepting bookings</small><strong>{selected.isAcceptingBookings ? "Yes" : "No"}</strong></div>
                    {selected.professionalStatus === "LICENSED_PROFESSIONAL" ? <><div><small>License number</small><strong>{label(selected.licenseNumber)}</strong></div><div><small>Authority</small><strong>{label(selected.licenseAuthority)}</strong></div></> : <><div><small>University / course</small><strong>{label(selected.university)} · {label(selected.course)}</strong></div><div><small>Enrollment number</small><strong>{label(selected.enrollmentNumber)}</strong></div></>}
                  </div>
                  <div className="review-copy"><h3>About the practice</h3><p>{label(selected.bio)}</p><p><strong>Languages:</strong> {selected.languages.join(", ") || "Not provided"}</p><p><strong>Preferred session language:</strong> {label(selected.preferredSessionLanguage)}</p><p><strong>Expertise:</strong> {selected.expertise.join(", ") || "Not provided"}</p></div>
                  {selected.hasLicenseDocument ? <button className="button secondary small" disabled={busy} onClick={downloadDocument}><FileArrowDownIcon /> Download credential document</button> : <p className="alert error">No credential document was attached.</p>}
                  {canReview ? <div className="review-actions"><button className="button secondary" disabled={busy} onClick={() => setSelected(null)}>Close</button><label>Rejection reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} placeholder="Explain what must be corrected or uploaded." /></label><div><button className="button reject" disabled={busy} onClick={() => decide("REJECTED")}><XCircleIcon /> Reject</button><button className="button" disabled={busy} onClick={() => decide("VERIFIED")}><CheckCircleIcon /> Approve verification</button></div></div> : <div className="admin-directory-note">This profile is not currently awaiting a verification decision.</div>}
                </> : <EmptyState title={view === "queue" ? "Choose a profile" : "Choose a doctor"}>Select an item on the left to inspect professional information.</EmptyState>}
              </section>
            </div>}
      </main>
      {busy && <TransitionLoader label={busyLabel || "Updating the verification request…"} />}
    </>
  );
}
