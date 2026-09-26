import type { UserRole, AccountStatus, VerificationStatus } from '@prisma/client';
declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
        role: UserRole;
        accountStatus: AccountStatus;
        tokenVersion: number;
        emailVerifiedAt: Date | null;
        doctorProfile: { id: string; verificationStatus: VerificationStatus } | null;
      };
    }
  }
}
export {};
