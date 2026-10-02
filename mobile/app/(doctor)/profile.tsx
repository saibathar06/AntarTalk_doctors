import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, authenticatedFileSource, json, upload } from '../../src/api';
import { useSession } from '../../src/auth';
import { chooseCredentialDocument, chooseProfilePhoto } from '../../src/permissions';
import { colors } from '../../src/theme';
import { Button, Card, Field, InlineError, Screen, Title } from '../../src/ui';

type ProfileForm = {
  firstName: string; lastName: string; phoneNumber: string; dateOfBirth: string; gender: string;
  licenseNumber: string; qualification: string; institution: string; experienceYears: string; graduationYear: string;
  bio: string; languages: string; expertise: string; preferredSessionLanguage: string; consultationFee: string;
};

const blankForm: ProfileForm = { firstName: '', lastName: '', phoneNumber: '', dateOfBirth: '', gender: '', licenseNumber: '', qualification: '', institution: '', experienceYears: '', graduationYear: '', bio: '', languages: '', expertise: '', preferredSessionLanguage: '', consultationFee: '' };
const list = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

export default function ProfileScreen() {
  const { profile, refreshProfile } = useSession();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProfileForm>(blankForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [photoFailed, setPhotoFailed] = useState(false);
  const verified = profile?.verificationStatus === 'VERIFIED';
  const pending = profile?.verificationStatus === 'PENDING' && Boolean(profile?.verificationSubmittedAt);

  useEffect(() => {
    if (!profile) return;
    setForm({
      firstName: profile.firstName ?? '', lastName: profile.lastName ?? '', phoneNumber: profile.phoneNumber ?? '', dateOfBirth: profile.dateOfBirth?.slice(0, 10) ?? '', gender: profile.gender ?? '',
      licenseNumber: profile.licenseNumber ?? '', qualification: profile.qualification ?? '', institution: profile.institution ?? '', experienceYears: profile.experienceYears?.toString() ?? '', graduationYear: profile.graduationYear?.toString() ?? '',
      bio: profile.bio ?? '', languages: profile.languages.join(', '), expertise: profile.expertise.join(', '), preferredSessionLanguage: profile.preferredSessionLanguage ?? '', consultationFee: profile.consultationFee ?? '',
    });
  }, [profile]);
  useEffect(() => setPhotoFailed(false), [profile?.profileImageUrl]);

  const set = (key: keyof ProfileForm) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const resetEditor = () => { setError(''); setNotice(''); setEditing(false); };

  const save = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await json('/api/doctor/profile', 'PATCH', {
        firstName: form.firstName.trim(), lastName: form.lastName.trim(), phoneNumber: form.phoneNumber.trim(), dateOfBirth: form.dateOfBirth || undefined, gender: form.gender || null,
        ...(!verified ? { licenseNumber: form.licenseNumber.trim() || null } : {}), qualification: form.qualification.trim() || null, institution: form.institution.trim() || null,
        experienceYears: form.experienceYears === '' ? null : Number(form.experienceYears), graduationYear: form.graduationYear === '' ? null : Number(form.graduationYear),
        bio: form.bio.trim() || null, languages: list(form.languages), expertise: list(form.expertise), preferredSessionLanguage: form.preferredSessionLanguage.trim() || null, consultationFee: form.consultationFee || null,
        timezone: 'Asia/Kolkata',
      });
      await refreshProfile();
      setEditing(false);
      setNotice(verified ? 'Your personal profile was saved. Professional verification remains active.' : 'Profile saved as a draft. Upload the required photo and credential document, then submit it for review.');
    } catch (caught) { setError((caught as ApiError).message); } finally { setBusy(false); }
  };

  const uploadPhoto = async () => {
    const file = await chooseProfilePhoto();
    if (!file) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await upload('/api/doctor/profile/photo', file.uri, file.name, file.mimeType);
      await refreshProfile();
      setNotice('Profile photo uploaded and optimized securely.');
    } catch (caught) { setError((caught as ApiError).message); } finally { setBusy(false); }
  };

  const uploadDocument = async () => {
    const file = await chooseCredentialDocument();
    if (!file) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await upload('/api/doctor/profile/documents', file.uri, file.name, file.mimeType);
      await refreshProfile();
      setNotice('Credential document uploaded. It is private and will be reviewed only by authorized AntarTalk staff.');
    } catch (caught) { setError((caught as ApiError).message); } finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await json('/api/doctor/verification/submit', 'POST', {});
      await refreshProfile();
      setNotice('Your complete professional profile is now under review. We will notify you when it is approved.');
    } catch (caught) { setError((caught as ApiError).message); } finally { setBusy(false); }
  };

  const initials = `${profile?.firstName?.[0] ?? ''}${profile?.lastName?.[0] ?? ''}`.toUpperCase() || 'AT';
  const missing = profile?.missingFields ?? [];

  return <Screen>
    <Title subtitle={verified ? 'Your profile is verified and ready for your practice.' : pending ? 'Your professional profile is currently under review.' : 'Save your details as a draft, then submit your complete profile for review.'}>My profile</Title>
    <InlineError message={error} />
    {notice ? <View style={styles.notice}><Ionicons name="checkmark-circle-outline" size={19} color={colors.teal} /><Text style={styles.noticeText}>{notice}</Text></View> : null}
    {verified ? <View style={styles.verified}><Ionicons name="checkmark-circle" size={22} color={colors.teal} /><View style={{ flex: 1 }}><Text style={styles.verifiedTitle}>Profile complete and verified</Text><Text style={styles.verifiedText}>{profile?.isAcceptingBookings ? 'Your practice is accepting sessions.' : 'Your bookings are currently paused.'}</Text></View></View> : null}

    <Card>
      <View style={styles.photoRow}>
        <View style={styles.photo}>{profile?.profileImageUrl && !photoFailed ? <Image source={authenticatedFileSource(profile.profileImageUrl)} style={styles.photoImage} onError={() => setPhotoFailed(true)} /> : <Text style={styles.photoInitials}>{initials}</Text>}</View>
        <View style={styles.photoCopy}><Text style={styles.cardTitle}>Profile photo</Text><Text style={styles.description}>A clear photo is required before professional approval.</Text><Pressable disabled={busy} onPress={uploadPhoto} hitSlop={8}><Text style={[styles.uploadLink, busy && styles.disabledText]}>{profile?.profileImageUrl ? 'Replace photo' : 'Upload photo'}</Text></Pressable></View>
      </View>
      <Text style={styles.help}>JPEG, PNG or WebP up to 5 MB. The backend rotates, compresses and safely standardizes the image for display.</Text>
    </Card>

    {!editing ? <Card>
      <View style={styles.sectionTop}><View><Text style={styles.cardTitle}>{profile?.firstName} {profile?.lastName}</Text><Text style={styles.description}>{profile?.professionalCategory?.replace('_', ' ')} · {profile?.preferredSessionLanguage || 'Session language not set'}</Text></View><Pressable onPress={() => { setError(''); setNotice(''); setEditing(true); }} hitSlop={8}><Text style={styles.editLink}>Edit</Text></Pressable></View>
      <Text style={styles.bio}>{profile?.bio || 'Add a thoughtful short bio for clients.'}</Text>
    </Card> : <>
      <Card>
        <Text style={styles.cardTitle}>Personal information</Text><Text style={styles.description}>Keep your client-facing details current.</Text>
        <Field label="First name" value={form.firstName} onChangeText={set('firstName')} editable={!busy} />
        <Field label="Last name" value={form.lastName} onChangeText={set('lastName')} editable={!busy} />
        <Field label="Phone number" value={form.phoneNumber} onChangeText={set('phoneNumber')} keyboardType="phone-pad" editable={!busy} />
        <Field label="Date of birth (YYYY-MM-DD)" value={form.dateOfBirth} onChangeText={set('dateOfBirth')} editable={!busy} />
      </Card>
      <Card>
        <Text style={styles.cardTitle}>Professional details</Text><Text style={styles.description}>{verified ? 'Your reviewed professional credentials are locked.' : 'These details are assessed during professional verification.'}</Text>
        <Field label="Professional category" value={profile?.professionalCategory?.replace('_', ' ') ?? ''} editable={false} />
        <Field label="License / registration number" value={form.licenseNumber} onChangeText={set('licenseNumber')} editable={!busy && !verified} />
        <Field label="Qualification" value={form.qualification} onChangeText={set('qualification')} editable={!busy && !verified} />
        <Field label="Institution" value={form.institution} onChangeText={set('institution')} editable={!busy && !verified} />
        <Field label="Years of experience" value={form.experienceYears} onChangeText={set('experienceYears')} keyboardType="number-pad" editable={!busy && !verified} />
        <Field label="Graduation year (optional)" value={form.graduationYear} onChangeText={set('graduationYear')} keyboardType="number-pad" editable={!busy && !verified} />
      </Card>
      <Card>
        <Text style={styles.cardTitle}>About your practice</Text><Text style={styles.description}>These are the details clients use to understand your approach.</Text>
        <Field label="Short bio" value={form.bio} onChangeText={set('bio')} multiline editable={!busy} />
        <Field label="Languages (comma separated)" value={form.languages} onChangeText={set('languages')} editable={!busy} />
        <Field label="Areas of expertise (comma separated)" value={form.expertise} onChangeText={set('expertise')} editable={!busy} />
        <Field label="Preferred session language" value={form.preferredSessionLanguage} onChangeText={set('preferredSessionLanguage')} editable={!busy} />
        <Field label="Consultation fee (INR)" value={form.consultationFee} onChangeText={set('consultationFee')} keyboardType="decimal-pad" editable={!busy} />
        <Button label="Save profile" onPress={save} loading={busy} />
        {verified ? <Button label="Discard changes" onPress={resetEditor} disabled={busy} variant="secondary" /> : null}
      </Card>
    </>}

    <Card>
      <Text style={styles.cardTitle}>License document</Text>
      <Text style={styles.description}>{verified ? 'Your verified credential document is private and locked.' : 'Upload a clear license or registration document for the verification team.'}</Text>
      {!verified ? <Button label={profile?.licenseDocumentUrl ? 'Replace credential document' : 'Upload credential document'} onPress={uploadDocument} loading={busy} variant="secondary" /> : null}
      <Text style={styles.help}>{profile?.licenseDocumentUrl ? 'Credential document securely attached.' : 'Required before you can submit a licensed professional profile for review.'} PDF, JPEG, PNG, or WebP · maximum 5 MB.</Text>
    </Card>

    {!verified ? <Card>
      <Text style={styles.finalStep}>FINAL STEP</Text><Text style={styles.cardTitle}>Save, then submit for review</Text>
      <Text style={styles.description}>{pending ? 'Your submission is with the verification team. You can still save permitted draft updates if needed.' : 'Saving keeps a draft. Submitting sends your complete professional profile to AntarTalk for review.'}</Text>
      {!profile?.profileCompleted ? <Text style={styles.missing}>Still needed: {missing.map((item) => item.replace(/([A-Z])/g, ' $1').toLowerCase()).join(', ') || 'complete profile details'}.</Text> : null}
      {!pending ? <Button label="Submit for review" onPress={submit} loading={busy} disabled={!profile?.profileCompleted} /> : null}
    </Card> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderWidth: 1, borderColor: '#CFECE6', backgroundColor: '#F2FBF9', borderRadius: 13, padding: 12 }, noticeText: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 18 }, verified: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 15, padding: 14, backgroundColor: colors.tealSoft }, verifiedTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' }, verifiedText: { color: colors.muted, fontSize: 12, marginTop: 3 }, photoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 }, photo: { width: 80, height: 80, borderRadius: 40, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pinkSoft }, photoImage: { width: '100%', height: '100%' }, photoInitials: { color: colors.pink, fontSize: 25, fontWeight: '800' }, photoCopy: { flex: 1, gap: 3 }, cardTitle: { color: colors.ink, fontWeight: '800', fontSize: 16 }, description: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 }, uploadLink: { color: colors.pink, fontSize: 13, fontWeight: '800', marginTop: 7 }, disabledText: { color: colors.muted }, help: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 12 }, sectionTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }, editLink: { color: colors.pink, fontSize: 13, fontWeight: '800' }, bio: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 12 }, finalStep: { color: colors.teal, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 5 }, missing: { color: colors.danger, fontSize: 12, lineHeight: 17, marginTop: 11 },
});
