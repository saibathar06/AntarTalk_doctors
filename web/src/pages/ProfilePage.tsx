import { useEffect, useState, type FormEvent } from "react";
import { CheckCircleIcon, PencilSimpleIcon, XIcon } from "@phosphor-icons/react";
import { api, fileUrl, mutate } from "../api";
import { useAuth } from "../auth";
import {
  DoctorAvatar,
  ErrorState,
  PageHeader,
  TransitionLoader,
} from "../components";

export function ProfilePage() {
  const { profile: p, reload } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busyLabel, setBusyLabel] = useState(""),
    [editing, setEditing] = useState(false),
    [formVersion, setFormVersion] = useState(0);
  const verified = p?.verificationStatus === "VERIFIED";
  const canEdit = !verified || editing;

  useEffect(() => {
    if (p?.verificationStatus === "VERIFIED") setEditing(false);
  }, [p?.verificationStatus]);

  function beginEdit() {
    setError("");
    setNotice("");
    setEditing(true);
  }
  function cancelEdit() {
    setError("");
    setNotice("");
    setEditing(false);
    setFormVersion((value) => value + 1);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setBusyLabel("Saving your profile…");
    setError("");
    setNotice("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const input = {
      ...values,
      timezone: "Asia/Kolkata",
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
      preferredSessionLanguage: values.preferredSessionLanguage || null,
    };
    try {
      await mutate("/api/doctor/profile", "PATCH", input);
      await reload();
      setEditing(false);
      setFormVersion((value) => value + 1);
      setNotice(verified ? "Personal details saved. Your professional verification remains active." : "Profile saved. Changed credentials require professional re-verification.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }
  async function upload(file: File | undefined, document: boolean) {
    if (!file) return;
    setBusy(true);
    setBusyLabel(document ? "Uploading your verification document…" : "Uploading your profile photo…");
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
          ? "Document saved. When your profile is complete, submit it for review below."
          : "Photo uploaded and optimized for display.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setBusyLabel("");
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
    setBusy(true); setBusyLabel("Submitting your profile for review…"); setError(""); setNotice("");
    try {
      await mutate("/api/doctor/verification/submit", "POST", {});
      await reload();
      setNotice("Your complete profile was submitted for review. Once verified, your practice will start accepting bookings automatically.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setBusyLabel(""); }
  }
  return (
    <>
      <PageHeader
        title="The professional behind the care."
        description="Clients will see your professional information. Keep it thoughtful and up to date."
      />
      {verified && <section className="profile-verified-summary" aria-label="Profile verification status">
        <div>
          <CheckCircleIcon size={24} weight="fill" aria-hidden="true" />
          <span><strong>Profile complete and verified</strong><small>Your practice is {p!.isAcceptingBookings ? "accepting sessions" : "currently paused"}.</small></span>
        </div>
        {!editing ? <button type="button" className="button secondary small" onClick={beginEdit}><PencilSimpleIcon /> Edit personal details</button>
          : <button type="button" className="button secondary small" onClick={cancelEdit} disabled={busy}><XIcon /> Cancel editing</button>}
      </section>}
      {p!.timezone !== "Asia/Kolkata" && <p className="alert">New sessions use India Standard Time. Saving this profile changes your practice to IST and pauses previous weekly hours; you can set fresh hours after verification.</p>}
      {p!.verificationStatus === "REJECTED" && <section className="card verification-note"><h2>Review changes needed</h2><p>{p!.verificationReason || "Update your professional information, then submit it for review again."}</p></section>}
      {p!.verificationStatus === "PENDING" && p!.verificationSubmittedAt && <section className="card verification-note"><h2>Profile under review</h2><p>Your verification request was submitted. You can keep editing your profile, but credential changes require a new submission.</p></section>}
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
              disabled={busy || !canEdit}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                void upload(e.target.files?.[0], false);
                e.target.value = "";
              }}
            />
          </label>
          <small>JPEG, PNG or WebP · up to 5 MB. Photos are rotated correctly, resized to 800 px maximum and converted to JPEG securely on the server.</small>
        </div>
      </section>
      <form id="professional-profile-form" className="card profile-form" onSubmit={save} key={`${p!.id}-${formVersion}`}>
        <fieldset disabled={busy || !canEdit}>
          <div className="profile-section-heading"><div><h2>Personal information</h2><p>Keep your client-facing details current.</p></div>{verified && !editing && <span>Choose Edit to make changes</span>}</div>
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
              Gender
              <select name="gender" defaultValue={p!.gender ?? ""} required>
                <option value="" disabled>Select gender</option>
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
                <option value="NON_BINARY">Non-binary</option>
                <option value="OTHER">Other</option>
                <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
              </select>
            </label>
            <label>
              Date of birth
              <input name="dateOfBirth" type="date" defaultValue={p!.dateOfBirth.slice(0, 10)} required />
            </label>
            <label>
              Phone number
              <input name="phoneNumber" type="tel" defaultValue={p!.phoneNumber} required />
            </label>
          </div>
          <div className="profile-section-heading professional-heading"><div><h2>Professional details</h2><p>{verified ? "Verified credentials are locked. Contact AntarTalk support if a correction is required." : "These details are reviewed before your practice is approved."}</p></div></div>
          <div className="form-grid">
            <label>
              Category
              <select
                name="professionalCategory"
                defaultValue={p!.professionalCategory}
                disabled={verified}
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
                disabled={verified}
              />
            </label>
            <label>
              Qualification
              <input
                name="qualification"
                maxLength={200}
                defaultValue={p!.qualification ?? ""}
                disabled={verified}
              />
            </label>
            <label>
              Institution (optional)
              <input
                name="institution"
                maxLength={200}
                defaultValue={p!.institution ?? ""}
                disabled={verified}
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
                disabled={verified}
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
                  disabled={verified}
                />
              </label>
            )}
          </div>
          <div className="profile-section-heading"><div><h2>About your practice</h2><p>These are the details clients use to understand your approach.</p></div></div>
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
              Preferred session language
              <select name="preferredSessionLanguage" defaultValue={p!.preferredSessionLanguage ?? ""} required>
                <option value="" disabled>Select the language you prefer to use in sessions</option>
                <option value="English">English</option>
                <option value="Hindi">Hindi</option>
                <option value="Bengali">Bengali</option>
                <option value="Gujarati">Gujarati</option>
                <option value="Kannada">Kannada</option>
                <option value="Malayalam">Malayalam</option>
                <option value="Marathi">Marathi</option>
                <option value="Punjabi">Punjabi</option>
                <option value="Tamil">Tamil</option>
                <option value="Telugu">Telugu</option>
                <option value="Urdu">Urdu</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <label>
              Consultation fee (INR)
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
            Your consultation fee is required for review and is used as the INR session price. Session duration is controlled by the shared booking system.
          </p>
        </fieldset>
      </form>
      <section className="card">
        <h2>License document</h2>
        <p>{verified ? "Private and locked after verification. Contact AntarTalk support if your registration document needs correction." : "Private to your account. Uploading new credentials pauses bookings and requires re-verification."}</p>
        {!verified && <label className="file-label">
          Upload document
          <input
            disabled={busy || !canEdit}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => {
              void upload(e.target.files?.[0], true);
              e.target.value = "";
            }}
          />
        </label>}
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
      {!verified && <section className="card profile-actions">
        <div>
          <p className="eyebrow">FINAL STEP</p>
          <h2>Save, then submit for review.</h2>
          <p>Save profile keeps your work as a draft. Submit for review sends your completed professional profile to AntarTalk’s verification team.</p>
        </div>
        <div className="profile-actions-buttons">
          <button className="button secondary" type="submit" form="professional-profile-form" disabled={busy}>Save profile</button>
          {p!.verificationStatus !== "VERIFIED" && !(p!.verificationStatus === "PENDING" && p!.verificationSubmittedAt) && (
            <button className="button" type="button" disabled={busy || !p!.profileCompleted} onClick={submitForReview}>Submit for review</button>
          )}
        </div>
        {!p!.profileCompleted && <p className="help">Finish the required fields, including a profile photo, session language and consultation fee, then save your profile to unlock submission.</p>}
      </section>}
      {verified && editing && <section className="profile-edit-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={cancelEdit}>Discard changes</button>
        <button className="button" type="submit" form="professional-profile-form" disabled={busy}>Save profile</button>
      </section>}
      {busy && <TransitionLoader label={busyLabel || "Updating your profile…"} />}
    </>
  );
}
