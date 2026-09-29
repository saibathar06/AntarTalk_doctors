export interface Profile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  dateOfBirth: string;
  gender: "FEMALE" | "MALE" | "NON_BINARY" | "OTHER" | "PREFER_NOT_TO_SAY" | null;
  professionalCategory: string;
  professionalStatus: string;
  verificationStatus: string;
  verificationSubmittedAt: string | null;
  verificationReason: string | null;
  licenseNumber: string | null;
  university: string | null;
  course: string | null;
  timezone: string;
  bio: string | null;
  qualification: string | null;
  institution: string | null;
  graduationYear: number | null;
  experienceYears: number | null;
  languages: string[];
  preferredSessionLanguage: string | null;
  expertise: string[];
  consultationFee: string | null;
  profileImageUrl: string | null;
  licenseDocumentUrl: string | null;
  profileCompleted: boolean;
  completionPercentage: number;
  missingFields: string[];
  isAcceptingBookings: boolean;
  canTakeSessions: boolean;
  emailNotifications: boolean;
}
export interface Viewer {
  id: string;
  role: "DOCTOR" | "ADMIN";
}
export interface VerificationRequest {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  gender: Profile["gender"];
  professionalCategory: string;
  professionalStatus: string;
  licenseNumber: string | null;
  licenseAuthority: string | null;
  university: string | null;
  course: string | null;
  specialization: string | null;
  expectedGraduationDate: string | null;
  enrollmentNumber: string | null;
  qualification: string | null;
  institution: string | null;
  graduationYear: number | null;
  experienceYears: number | null;
  consultationFee: string | null;
  bio: string | null;
  languages: string[];
  preferredSessionLanguage: string | null;
  expertise: string[];
  profileImageUrl: string | null;
  licenseDocumentUrl: string | null;
  hasLicenseDocument: boolean;
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";
  verificationSubmittedAt: string | null;
  verificationReason: string | null;
  isAcceptingBookings: boolean;
  updatedAt: string;
  timezone: string;
}
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}
export interface Page<T> {
  items: T[];
  pagination: Pagination;
}
export interface Appointment {
  id: string;
  clientLabel: string;
  sessionType: string;
  status: string;
  startTime: string;
  endTime: string;
  sessionDurationMinutes: number;
  bufferDurationMinutes: number;
  cancelledAt?: string | null;
  cancelledBy?: "CLIENT" | "DOCTOR" | null;
  cancellationReason?: string | null;
  rescheduleCount: number;
  earning?: { amount: string; currency: string; status: string } | null;
  rescheduleRequests: Array<{ id: string; proposedStartTime: string; proposedEndTime: string; reason: string | null; createdAt: string }>;
  join: { state: string; canJoin: boolean; opensAt: string; closesAt: string };
}
export interface Dashboard {
  todaySessions: number;
  totalClients: number;
  monthSessions: number;
  earnings: Balance[];
  averageRating: number | null;
  schedule: Page<Appointment>;
  timezone: string;
}
export interface WorkingHour {
  useDefault?: boolean;
  availableDate?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}
export interface Block {
  id: string;
  startTime: string;
  endTime: string;
  reason: string | null;
}
export interface Client {
  label: string;
  appointmentCount: number;
  latestAppointmentAt: string;
}
export interface Balance {
  currency: string;
  grossEarned?: string;
  penalties?: string;
  earned: string;
  withdrawn: string;
  available: string;
}
export interface Earning {
  id: string;
  bookingId: string;
  createdAt: string;
  amount: string;
  currency: string;
  status: string;
  type?: "EARNING" | "PENALTY";
  signedAmount?: string;
  reason?: string;
  booking?: { startTime: string };
}
export interface PayoutAccount {
  id: string;
  type: "UPI" | "BANK_ACCOUNT";
  displayLabel: string;
  isDefault: boolean;
  createdAt: string;
}
export interface Payout {
  id: string;
  doctorId: string;
  payoutAccountId: string;
  amount: string;
  currency: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
  failureReason: string | null;
  providerReference: string | null;
  createdAt: string;
  completedAt: string | null;
  payoutAccount: PayoutAccount;
}
export interface AdminPayout extends Payout {
  doctor: { id: string; firstName: string; lastName: string; email: string };
}
export interface AdminPayoutDetail extends AdminPayout {
  payoutAccount: PayoutAccount & { details: { type: string; upiId?: string; accountHolderName?: string; accountNumber?: string; ifsc?: string } };
}
export interface BookableDoctor {
  id: string;
  firstName: string;
  lastName: string;
  gender: Profile["gender"];
  professionalCategory: string;
  specialization: string | null;
  qualification: string | null;
  institution: string | null;
  experienceYears: number | null;
  preferredSessionLanguage: string | null;
  languages: string[];
  bio: string | null;
  timezone: string;
  verificationStatus: "VERIFIED";
  hasProfileImage: boolean;
  consultationFee: string | null;
}
export interface BookingSlot {
  doctorId: string;
  startTime: string;
  endTime: string;
  sessionDurationMinutes: number;
  bufferDurationMinutes: number;
}
export interface SlotReservation {
  reservationId: string;
  expiresAt: string;
  slot: BookingSlot;
}
export interface ClientBooking {
  id: string;
  doctorId: string;
  clientId: string;
  startTime: string;
  endTime: string;
  sessionDurationMinutes: number;
  bufferDurationMinutes: number;
  status: "CONFIRMED" | string;
  paymentId: string | null;
  createdAt: string;
  cancelledAt?: string | null;
  cancelledBy?: "CLIENT" | "DOCTOR" | null;
  cancellationReason?: string | null;
  rescheduleCount?: number;
  doctor?: { firstName: string; lastName: string; professionalCategory: string; preferredSessionLanguage: string | null };
  payment?: { amount: string; currency: string; status: string } | null;
  refund?: { amount: string; currency: string; status: string; completedAt: string | null } | null;
  rescheduleRequests?: Array<{ id: string; proposedStartTime: string; status: string; reason: string | null }>;
}
