import { useState } from "react";
import { CheckCircleIcon, FileArrowDownIcon, SignOutIcon, XCircleIcon } from "@phosphor-icons/react";
import { fileUrl, mutate } from "../api";
import { useAuth } from "../auth";
import { EmptyState, ErrorState, LoadingState, PageHeader, useResource } from "../components";
import type { Page, VerificationRequest } from "../types";

const label = (value: string | null | undefined) => value?.trim() || "Not provided";
const submittedAt = (value: string) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function AdminVerificationPage() {
  const { logout } = useAuth();
  const { data, error, loading, reload } = useResource<Page<VerificationRequest>>("/api/admin/verification-requests?page=1&limit=25");
  const [selected, setSelected] = useState<VerificationRequest | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  async function decide(status: "VERIFIED" | "REJECTED") {
    if (!selected || (status === "REJECTED" && reason.trim().length < 3)) {
      if (status === "REJECTED") setActionError("Add a clear reason of at least three characters before rejecting.");
      return;
    }
    setBusy(true); setActionError(""); setNotice("");
    try {
      await mutate(`/api/admin/doctors/${selected.id}/verification`, "PATCH", { status, reason: status === "REJECTED" ? reason.trim() : undefined, expectedUpdatedAt: selected.updatedAt });
      setNotice(status === "VERIFIED" ? "Professional verification approved. They must still enable bookings themselves." : "Verification request rejected with the reason provided.");
      setSelected(null); setReason(""); reload();
    } catch (error) { setActionError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function downloadDocument() {
    if (!selected) return;
    setActionError("");
    try {
      const url = await fileUrl(`/api/admin/doctors/${selected.id}/license-document`);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "credential-document"; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setActionError((error as Error).message); }
  }
  async function signOut() { setBusy(true); try { await logout(); window.location.assign("/doctor/login"); } catch (error) { setActionError((error as Error).message); setBusy(false); } }

  return <main className="admin-page">
    <header className="admin-topbar"><div><p className="eyebrow">ANTARTALK · ADMIN</p><h1>Professional verification</h1></div><button className="button secondary small" disabled={busy} onClick={signOut}><SignOutIcon />Log out</button></header>
    <PageHeader eyebrow="REVIEW QUEUE" title="Review submitted profiles" description="Approve credentials or return a clear reason. Approval never turns on bookings automatically." />
    <ErrorState message={error || actionError} />
    {notice && <div className="alert" role="status">{notice}</div>}
    {loading ? <LoadingState /> : !data?.items.length ? <section className="card"><EmptyState title="No profiles are waiting for review">Submitted, complete professional profiles appear here.</EmptyState></section> : <div className="admin-review-grid">
      <section className="card admin-queue"><h2>{data.pagination.total} awaiting review</h2>{data.items.map(request => <button key={request.id} className={`review-row ${selected?.id === request.id ? "selected" : ""}`} onClick={() => { setSelected(request); setReason(""); setActionError(""); }}><strong>{request.firstName} {request.lastName}</strong><span>{request.professionalCategory.replace("_", " ")} · submitted {submittedAt(request.verificationSubmittedAt)}</span></button>)}</section>
      <section className="card admin-detail">{selected ? <>
        <div className="admin-detail-heading"><div><p className="eyebrow">PROFILE REVIEW</p><h2>{selected.firstName} {selected.lastName}</h2><p>{selected.email} · {selected.phoneNumber}</p></div><span className="badge pending">PENDING</span></div>
        <div className="review-facts"><div><small>Category</small><strong>{selected.professionalCategory.replace("_", " ")}</strong></div><div><small>Professional status</small><strong>{selected.professionalStatus.replaceAll("_", " ")}</strong></div><div><small>Qualification</small><strong>{label(selected.qualification)}</strong></div><div><small>Institution</small><strong>{label(selected.institution)}</strong></div>{selected.professionalStatus === "LICENSED_PROFESSIONAL" ? <><div><small>License number</small><strong>{label(selected.licenseNumber)}</strong></div><div><small>Authority</small><strong>{label(selected.licenseAuthority)}</strong></div></> : <><div><small>University / course</small><strong>{label(selected.university)} · {label(selected.course)}</strong></div><div><small>Enrollment number</small><strong>{label(selected.enrollmentNumber)}</strong></div></>}</div>
        <div className="review-copy"><h3>About the practice</h3><p>{label(selected.bio)}</p><p><strong>Languages:</strong> {selected.languages.join(", ") || "Not provided"}</p><p><strong>Expertise:</strong> {selected.expertise.join(", ") || "Not provided"}</p></div>
        {selected.hasLicenseDocument ? <button className="button secondary small" onClick={downloadDocument}><FileArrowDownIcon />Download credential document</button> : <p className="alert error">No credential document was attached.</p>}
        <div className="review-actions"><button className="button secondary" disabled={busy} onClick={() => setSelected(null)}>Close</button><label>Rejection reason<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={3} placeholder="Explain what must be corrected or uploaded." /></label><div><button className="button reject" disabled={busy} onClick={() => decide("REJECTED")}><XCircleIcon />Reject</button><button className="button" disabled={busy} onClick={() => decide("VERIFIED")}><CheckCircleIcon />Approve verification</button></div></div>
      </> : <EmptyState title="Choose a profile">Select a submitted profile to inspect credentials and decide.</EmptyState>}</section>
    </div>}
  </main>;
}
