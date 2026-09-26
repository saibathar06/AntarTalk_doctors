export interface Profile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  dateOfBirth: string;
  professionalCategory: string;
  professionalStatus: string;
  verificationStatus: string;
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
  join: { state: string; canJoin: boolean; opensAt: string; closesAt: string };
}
export interface Dashboard {
  todaySessions: number;
  totalClients: number;
  monthSessions: number;
  averageRating: number | null;
  schedule: Page<Appointment>;
  timezone: string;
}
export interface WorkingHour {
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
}
