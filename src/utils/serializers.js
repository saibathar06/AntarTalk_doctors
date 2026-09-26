export const doctorProfileSelect = {
  id: true,
  firstName: true,
  lastName: true,
  dateOfBirth: true,
  phoneNumber: true,
  professionalCategory: true,
  professionalStatus: true,
  verificationStatus: true,
  licenseNumber: true,
  licenseAuthority: true,
  university: true,
  course: true,
  specialization: true,
  expectedGraduationDate: true,
  enrollmentNumber: true,
  timezone: true,
  bio: true,
  isAcceptingBookings: true,
  createdAt: true,
  updatedAt: true
};

export function serializeUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt,
    accountStatus: user.accountStatus,
    doctorProfile: user.doctorProfile
  };
}
