import { useRef, useState, type FormEvent } from "react";
import { api, mutate } from "../api";
import { EmptyState, ErrorState, LoadingState, Pager, TransitionLoader, useResource } from "../components";
import type { Page, Payout, PayoutAccount } from "../types";

export function PayoutPanel() {
  const accounts = useResource<PayoutAccount[]>("/api/doctor/payout-accounts");
  const [page, setPage] = useState(1);
  const payouts = useResource<Page<Payout>>(`/api/doctor/payouts?page=${page}&limit=20`);
  const [accountType, setAccountType] = useState<"UPI" | "BANK_ACCOUNT">("UPI");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const withdrawalAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const isTuesday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "long" }).format(new Date()) === "Tuesday";

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setBusy(true); setError(""); setNotice("");
    try {
      await mutate("/api/doctor/payout-accounts", "POST", {
        type: accountType, displayLabel: values.displayLabel, isDefault: !accounts.data?.length,
        ...(accountType === "UPI" ? { upiId: values.upiId } : { accountHolderName: values.accountHolderName, accountNumber: values.accountNumber, ifsc: values.ifsc })
      });
      form.reset(); accounts.reload(); setNotice("Payout account saved securely.");
    } catch (requestError) { setError((requestError as Error).message); }
    finally { setBusy(false); }
  }

  async function requestWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const body = { amount: Number(values.amount), currency: "INR", payoutAccountId: values.payoutAccountId };
    const fingerprint = JSON.stringify(body);
    if (withdrawalAttempt.current?.fingerprint !== fingerprint) withdrawalAttempt.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/api/doctor/payouts/withdraw", {
        method: "POST", headers: { "Idempotency-Key": withdrawalAttempt.current.key },
        body: fingerprint
      });
      withdrawalAttempt.current = null;
      form.reset(); payouts.reload(); setNotice("Withdrawal request sent for admin review. Funds are reserved until it is completed or rejected.");
    } catch (requestError) { setError((requestError as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    <ErrorState message={error || accounts.error || payouts.error} />
    {notice && <p className="alert" role="status">{notice}</p>}
    <section className="card">
      <h2>Withdraw earnings</h2>
      <p>Requests can be submitted on Tuesdays in India Standard Time. Minimum withdrawal: ₹500. An admin reviews each request before transfer.</p>
      <form onSubmit={requestWithdrawal} className="settings-password-form">
        <label>Amount in INR<input type="number" name="amount" min="500" step="0.01" required /></label>
        <label>Send to <select name="payoutAccountId" required defaultValue=""><option value="" disabled>Select a payout account</option>{accounts.data?.map((account) => <option key={account.id} value={account.id}>{account.displayLabel} ({account.type.replaceAll("_", " ")})</option>)}</select></label>
        <button type="submit" className="button" disabled={busy || !isTuesday || !accounts.data?.length}>Request withdrawal</button>
        {!isTuesday && <p className="help">The request button opens on Tuesday in India Standard Time.</p>}
      </form>
    </section>
    <section className="card">
      <h2>Payout accounts</h2>
      {accounts.loading ? <LoadingState /> : accounts.data?.length ? <ul>{accounts.data.map((account) => <li key={account.id}>{account.displayLabel} · {account.type.replaceAll("_", " ")}{account.isDefault ? " · Default" : ""}</li>)}</ul> : <p>No payout account saved yet.</p>}
      <form onSubmit={saveAccount} className="settings-password-form">
        <h3>Add a payout account</h3>
        <label>Account type<select value={accountType} onChange={(event) => setAccountType(event.target.value as "UPI" | "BANK_ACCOUNT")}><option value="UPI">UPI</option><option value="BANK_ACCOUNT">Bank account</option></select></label>
        <label>Display name<input name="displayLabel" maxLength={120} placeholder="My primary account" required /></label>
        {accountType === "UPI" ? <label>UPI ID<input name="upiId" autoComplete="off" placeholder="name@bank" required /></label> : <>
          <label>Account holder name<input name="accountHolderName" autoComplete="name" required /></label>
          <label>Account number<input name="accountNumber" inputMode="numeric" autoComplete="off" pattern="[0-9]{6,20}" required /></label>
          <label>IFSC<input name="ifsc" autoComplete="off" maxLength={11} required /></label>
        </>}
        <button type="submit" className="button secondary" disabled={busy}>Save payout account</button>
      </form>
    </section>
    <section className="card"><h2>Withdrawal history</h2>
      {payouts.loading ? <LoadingState /> : payouts.data?.items.length ? <><div className="table-scroll"><table><thead><tr><th>Requested</th><th>Account</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>{payouts.data.items.map((payout) => <tr key={payout.id}><td>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(payout.createdAt))}</td><td>{payout.payoutAccount.displayLabel}</td><td>₹{payout.amount}</td><td>{payout.status}{payout.failureReason ? ` · ${payout.failureReason}` : ""}</td><td>{payout.providerReference ?? "—"}</td></tr>)}</tbody></table></div><Pager pagination={payouts.data.pagination} onPage={setPage} /></> : <EmptyState title="No withdrawals yet" />}
    </section>
    {busy && <TransitionLoader label="Saving your payout request…" />}
  </>;
}
