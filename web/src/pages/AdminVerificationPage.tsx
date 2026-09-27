import { useState } from "react";
import {
  CheckCircleIcon,
  FileArrowDownIcon,
  SignOutIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { api, fileUrl, mutate } from "../api";
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
import type { AdminPayout, AdminPayoutDetail, Page, VerificationRequest } from "../types";

const label = (value: string | null | undefined) => value?.trim() || "Not provided";
const formatDateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "Not submitted";

export function AdminVerificationPage() {
  const { logout } = useAuth();
  const [view, setView] = useState<"queue" | "doctors" | "payouts">("queue");
  const [payoutStatus, setPayoutStatus] = useState<AdminPayout["status"]>("PENDING");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<VerificationRequest | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const path = view === "payouts"
    ? `/api/admin/payouts?page=${page}&limit=25&status=${payoutStatus}`
    : view === "queue"
    ? `/api/admin/verification-requests?page=${page}&limit=25`
    : `/api/admin/doctors?page=${page}&limit=25`;
  const { data, error, loading, reload } = useResource<Page<VerificationRequest>>(path);
  const canReview = selected?.verificationStatus === "PENDING" && Boolean(selected.verificationSubmittedAt);

  function switchView(next: "queue" | "doctors" | "payouts") {
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
        ? "Professional verification approved. Bookings are now enabled for this doctor."
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
          eyebrow={view === "queue" ? "REVIEW QUEUE" : view === "doctors" ? "DOCTOR DIRECTORY" : "PAYOUT REVIEW"}
          title={view === "queue" ? "Review submitted profiles" : view === "doctors" ? "Doctor directory" : "Review withdrawals"}
          description={view === "queue"
            ? "Approve credentials or return a clear reason. Approval enables bookings automatically."
            : view === "doctors" ? "Browse professional profiles and their verification status. This directory contains no client or clinical data."
              : "Review withdrawal requests, then record the transfer after money reaches the doctor's account."}
        />
        <div className="admin-tabs" role="tablist" aria-label="Administrator views">
          <button role="tab" aria-selected={view === "queue"} className={view === "queue" ? "active" : ""} onClick={() => switchView("queue")}>Review queue</button>
          <button role="tab" aria-selected={view === "doctors"} className={view === "doctors" ? "active" : ""} onClick={() => switchView("doctors")}>All doctors</button>
          <button role="tab" aria-selected={view === "payouts"} className={view === "payouts" ? "active" : ""} onClick={() => switchView("payouts")}>Payouts</button>
        </div>
        {view === "payouts" ? <AdminPayoutsPanel
          data={data as unknown as Page<AdminPayout> | null}
          error={error} loading={loading} reload={reload} setPage={setPage}
          status={payoutStatus} setStatus={(next) => { setPayoutStatus(next); setPage(1); }}
        /> : <>
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
                    <div><small>Gender</small><strong>{label(selected.gender?.replaceAll("_", " "))}</strong></div>
                    <div><small>Qualification</small><strong>{label(selected.qualification)}</strong></div>
                    <div><small>Consultation fee</small><strong>{selected.consultationFee ? `₹${selected.consultationFee}` : "Not set"}</strong></div>
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
        </>}
      </main>
      {busy && <TransitionLoader label={busyLabel || "Updating the verification request…"} />}
    </>
  );
}

function AdminPayoutsPanel({ data, error, loading, reload, setPage, status, setStatus }: {
  data: Page<AdminPayout> | null; error: string; loading: boolean; reload: () => void;
  setPage: (page: number) => void;
  status: AdminPayout["status"]; setStatus: (status: AdminPayout["status"]) => void;
}) {
  const [selected, setSelected] = useState<AdminPayoutDetail | null>(null);
  const [reason, setReason] = useState("");
  const [transferReference, setTransferReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  async function select(id: string) {
    setBusy(true); setActionError("");
    try { setSelected(await api<AdminPayoutDetail>(`/api/admin/payouts/${id}`)); }
    catch (e) { setActionError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function review(decision: "APPROVE" | "REJECT") {
    if (!selected) return;
    setBusy(true); setActionError(""); setNotice("");
    try {
      await mutate(`/api/admin/payouts/${selected.id}/review`, "PATCH", { decision, reason: decision === "REJECT" ? reason.trim() : undefined });
      setNotice(decision === "APPROVE" ? "Approved. Transfer the funds to the account shown, then record the transfer reference." : "Request rejected. The reserved amount is available to the doctor again.");
      setSelected(null); setReason(""); reload();
    } catch (e) { setActionError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function complete() {
    if (!selected) return;
    setBusy(true); setActionError(""); setNotice("");
    try {
      await mutate(`/api/admin/payouts/${selected.id}/complete`, "POST", { providerReference: transferReference.trim() });
      setNotice("Transfer recorded and payout marked completed."); setSelected(null); setTransferReference(""); reload();
    } catch (e) { setActionError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <div className="card"><label>Request status <select value={status} onChange={(event) => { setSelected(null); setStatus(event.target.value as AdminPayout["status"]); }}>
      <option value="PENDING">Awaiting review</option><option value="PROCESSING">Approved · awaiting transfer</option>
      <option value="COMPLETED">Completed</option><option value="CANCELLED">Rejected</option><option value="FAILED">Failed</option>
    </select></label></div>
    <ErrorState message={error || actionError} />
    {notice && <p className="alert" role="status">{notice}</p>}
    {loading ? <LoadingState label="Loading payout requests…" /> : !data?.items.length ? <section className="card"><EmptyState title="No payout requests in this state" /></section> :
      <div className="admin-review-grid">
        <section className="card admin-queue"><h2>{data.pagination.total} payout requests</h2>
          {data.items.map((item) => <button key={item.id} className={`review-row ${selected?.id === item.id ? "selected" : ""}`} onClick={() => void select(item.id)}>
            <strong>{item.doctor.firstName} {item.doctor.lastName}</strong><span>{item.currency} {item.amount} · {item.status} · {formatDateTime(item.createdAt)}</span>
          </button>)}
          <Pager pagination={data.pagination} onPage={(next) => { setPage(next); setSelected(null); }} />
        </section>
        <section className="card admin-detail">{selected ? <>
          <div className="admin-detail-heading"><div><p className="eyebrow">WITHDRAWAL REQUEST</p><h2>{selected.doctor.firstName} {selected.doctor.lastName}</h2><p>{selected.doctor.email}</p></div><span className="badge">{selected.status}</span></div>
          <div className="review-facts"><div><small>Amount</small><strong>{selected.currency} {selected.amount}</strong></div><div><small>Requested</small><strong>{formatDateTime(selected.createdAt)}</strong></div><div><small>Payout account</small><strong>{selected.payoutAccount.displayLabel}</strong></div>
            {selected.payoutAccount.details.type === "UNAVAILABLE" && <div><small>Account details</small><strong>Unavailable · reject this request and ask the doctor to add a new account.</strong></div>}
            {selected.payoutAccount.details.upiId && <div><small>UPI ID</small><strong>{selected.payoutAccount.details.upiId}</strong></div>}
            {selected.payoutAccount.details.accountHolderName && <div><small>Account holder</small><strong>{selected.payoutAccount.details.accountHolderName}</strong></div>}
            {selected.payoutAccount.details.accountNumber && <div><small>Account number</small><strong>{selected.payoutAccount.details.accountNumber}</strong></div>}
            {selected.payoutAccount.details.ifsc && <div><small>IFSC</small><strong>{selected.payoutAccount.details.ifsc}</strong></div>}
            {selected.providerReference && <div><small>Transfer reference</small><strong>{selected.providerReference}</strong></div>}
            {selected.failureReason && <div><small>Reason</small><strong>{selected.failureReason}</strong></div>}
          </div>
          {selected.status === "PENDING" && <div className="review-actions"><label>Reason if rejecting<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} /></label><div><button className="button reject" disabled={busy || reason.trim().length < 3} onClick={() => void review("REJECT")}>Reject</button><button className="button" disabled={busy || selected.payoutAccount.details.type === "UNAVAILABLE"} onClick={() => void review("APPROVE")}>Approve request</button></div></div>}
          {selected.status === "PROCESSING" && <div className="review-actions"><p>Transfer the approved amount outside AntarTalk, then enter the transaction reference to mark it completed.</p><label>Bank / UPI transfer reference<input value={transferReference} onChange={(event) => setTransferReference(event.target.value)} minLength={6} maxLength={200} /></label><button className="button" disabled={busy || transferReference.trim().length < 6} onClick={() => void complete()}>Record completed transfer</button></div>}
        </> : <EmptyState title="Choose a payout request">Select an item to inspect the amount and transfer destination.</EmptyState>}</section>
      </div>}
    {busy && <TransitionLoader label="Updating payout review…" />}
  </>;
}
