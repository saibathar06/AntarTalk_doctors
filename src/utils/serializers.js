export const doctorProfileSelect = {
  id: true,
  firstName: true,
  lastName: true,
  dateOfBirth: true,
  gender: true,
  phoneNumber: true,
  professionalCategory: true,
  professionalStatus: true,
  verificationStatus: true,
  verificationSubmittedAt: true,
  verificationReason: true,
  licenseNumber: true,
  licenseAuthority: true,
  university: true,
  course: true,
  specialization: true,
  expectedGraduationDate: true,
  enrollmentNumber: true,
  timezone: true,
  bio: true,
  profileImageUrl: true, licenseDocumentUrl: true, qualification: true,
  institution: true, graduationYear: true, experienceYears: true,
  languages: true, preferredSessionLanguage: true, expertise: true, consultationFee: true, emailNotifications: true,
  isAcceptingBookings: true,
  createdAt: true,
  updatedAt: true
};

export function serializeUser(user) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    dateOfBirth: user.dateOfBirth,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt,
    accountStatus: user.accountStatus,
    doctorProfile: user.doctorProfile
  };
}
