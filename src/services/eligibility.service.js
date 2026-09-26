// Computed from persisted fields, never accepted from a client or cached as a flag.
export function profileCompletion(profile) {
  const fields = {
    name: Boolean(profile.firstName?.trim() && profile.lastName?.trim()),
    photo: Boolean(profile.profileImageUrl),
    category: Boolean(profile.professionalCategory),
    experience: Number.isInteger(profile.experienceYears) && profile.experienceYears >= 0,
    qualification: Boolean(profile.qualification?.trim()),
    credentials: profile.professionalStatus === 'FINAL_YEAR_STUDENT'
      ? Boolean(profile.university && profile.course && profile.enrollmentNumber && profile.expectedGraduationDate)
      : Boolean(profile.licenseNumber?.trim()),
    bio: Boolean(profile.bio?.trim()),
    languages: Boolean(profile.languages?.length),
    expertise: Boolean(profile.expertise?.length)
  };
  const missingFields = Object.keys(fields).filter((key) => !fields[key]);
  return { profileCompleted: missingFields.length === 0, completionPercentage: Math.round((9 - missingFields.length) / 9 * 100), missingFields };
}

export function canDoctorTakeSessions(profile, user = profile?.user) {
  return Boolean(profile && user?.role === 'DOCTOR' && user.accountStatus === 'ACTIVE' && user.emailVerifiedAt &&
    profileCompletion(profile).profileCompleted && profile.verificationStatus === 'VERIFIED' && profile.isAcceptingBookings);
}
