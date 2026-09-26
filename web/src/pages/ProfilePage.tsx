import { useState, type FormEvent } from "react";
import { api, fileUrl, mutate } from "../api";
import { useAuth } from "../auth";
import {
  DoctorAvatar,
  ErrorState,
  PageHeader,
  ProfileCompletionCard,
} from "../components";

export function ProfilePage() {
  const { profile: p, reload } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const input = {
      ...values,
      languages: String(values.languages)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      expertise: String(values.expertise)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      experienceYears:
        values.experienceYears === "" ? null : Number(values.experienceYears),
      graduationYear:
        values.graduationYear === "" ? null : Number(values.graduationYear),
      institution: values.institution || null,
      consultationFee: values.consultationFee || null,
      qualification: values.qualification || null,
      bio: values.bio || null,
    };
    try {
      await mutate("/api/doctor/profile", "PATCH", input);
      await reload();
      setNotice(
        "Profile saved. Changed credentials require professional re-verification.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File | undefined, document: boolean) {
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      body.append("file", file);
      await api(`/api/doctor/profile/${document ? "documents" : "photo"}`, {
        method: "POST",
        body,
      });
      await reload();
      setNotice(
        document
          ? "Document saved. Your profile is now pending review."
          : "Photo saved.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    try {
      const url = await fileUrl(p!.licenseDocumentUrl!);
      const a = document.createElement("a");
      a.href = url;
      a.download = "license-document";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function submitForReview() {
    setBusy(true); setError(""); setNotice("");
    try {
      await mutate("/api/doctor/verification/submit", "POST", {});
      await reload();
      setNotice("Your complete profile was submitted for professional review. Bookings remain paused until you are verified and opt in.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader
        title="The professional behind the care."
        description="Clients will see your professional information. Keep it thoughtful and up to date."
      />
      <ProfileCompletionCard profile={p!} />
      {p!.verificationStatus === "REJECTED" && <section className="card verification-note"><h2>Review changes needed</h2><p>{p!.verificationReason || "Update your professional information, then submit it for review again."}</p></section>}
      {p!.verificationStatus === "PENDING" && p!.verificationSubmittedAt ? <section className="card verification-note"><h2>Profile under review</h2><p>Your verification request was submitted. You can keep editing your profile, but credential changes require a new submission.</p></section> : p!.verificationStatus !== "VERIFIED" && <section className="card verification-note"><h2>Submit for professional review</h2><p>When every required profile field is complete, send your profile to AntarTalk’s verification team.</p><button className="button" disabled={busy} onClick={submitForReview}>{busy ? "Submitting…" : "Submit for review"}</button></section>}
      <ErrorState message={error} />
      {notice && (
        <div className="alert" role="status">
          {notice}
        </div>
      )}
      <section className="card photo-section">
        <DoctorAvatar profile={p!} large />
        <div>
          <h2>Profile photo</h2>
          <p>A clear, welcoming photo helps clients recognize you. It is required before you can submit your profile for approval or take sessions.</p>
          <label className="file-label">
            Upload photo
            <input
              disabled={busy}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                void upload(e.target.files?.[0], false);
                e.target.value = "";
              }}
            />
          </label>
          <small>JPEG, PNG or WebP · up to 5 MB</small>
        </div>
      </section>
      <form className="card profile-form" onSubmit={save} key={p!.id}>
        <fieldset disabled={busy}>
          <h2>Professional information</h2>
          <div className="form-grid">
            <label>
              First name
              <input
                name="firstName"
                defaultValue={p!.firstName}
                maxLength={100}
                required
              />
            </label>
            <label>
              Last name
              <input
                name="lastName"
                defaultValue={p!.lastName}
                maxLength={100}
                required
              />
            </label>
            <label>
              Category
              <select
                name="professionalCategory"
                defaultValue={p!.professionalCategory}
              >
                <option value="PSYCHOLOGIST">Psychologist</option>
                <option value="PSYCHIATRIST">Psychiatrist</option>
                <option value="COUNSELLOR">Counsellor</option>
              </select>
            </label>
            <label>
              Years of experience
              <input
                type="number"
                name="experienceYears"
                min={0}
                max={80}
                defaultValue={p!.experienceYears ?? ""}
              />
            </label>
            <label>
              Qualification
              <input
                name="qualification"
                maxLength={200}
                defaultValue={p!.qualification ?? ""}
              />
            </label>
            <label>
              Institution (optional)
              <input
                name="institution"
                maxLength={200}
                defaultValue={p!.institution ?? ""}
              />
            </label>
            <label>
              Graduation year (optional)
              <input
                type="number"
                name="graduationYear"
                min={1900}
                max={2200}
                defaultValue={p!.graduationYear ?? ""}
              />
            </label>
            {p!.professionalStatus === "LICENSED_PROFESSIONAL" && (
              <label>
                License / registration number
                <input
                  name="licenseNumber"
                  minLength={2}
                  maxLength={100}
                  defaultValue={p!.licenseNumber ?? ""}
                  required
                />
              </label>
            )}
          </div>
          <h2>About your practice</h2>
          <label>
            Short bio
            <textarea
              name="bio"
              rows={5}
              maxLength={2000}
              defaultValue={p!.bio ?? ""}
              placeholder="Your approach to care, in your own words."
            />
          </label>
          <div className="form-grid">
            <label>
              Languages (comma separated)
              <input
                name="languages"
                defaultValue={p!.languages.join(", ")}
                placeholder="English, Hindi"
              />
            </label>
            <label>
              Areas of expertise (comma separated)
              <input
                name="expertise"
                defaultValue={p!.expertise.join(", ")}
                placeholder="Anxiety, Relationships"
              />
            </label>
            <label>
              Consultation fee (optional)
              <input
                name="consultationFee"
                type="number"
                min="0.01"
                max="10000000"
                step="0.01"
                defaultValue={p!.consultationFee ?? ""}
              />
            </label>
          </div>
          <p className="help">
            The fee is a profile preference, not a payment order. Session
            duration is controlled by the shared booking system.
          </p>
          <div className="form-footer">
            <span>
              Professional approval: <strong>{p!.verificationStatus}</strong>
            </span>
            <button className="button" disabled={busy}>
              {busy ? "Saving…" : "Save profile"}
            </button>
          </div>
        </fieldset>
      </form>
      <section className="card">
        <h2>License document</h2>
        <p>
          Private to your account. Uploading new credentials pauses bookings and
          requires re-verification.
        </p>
        <label className="file-label">
          Upload document
          <input
            disabled={busy}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => {
              void upload(e.target.files?.[0], true);
              e.target.value = "";
            }}
          />
        </label>
        {p!.licenseDocumentUrl && (
          <button className="button secondary" onClick={download}>
            Download saved document
          </button>
        )}
        <p className="help">
          PDF or image · up to 5 MB. Professional review is performed by
          authorized backend administrators.
        </p>
      </section>
    </>
  );
}
