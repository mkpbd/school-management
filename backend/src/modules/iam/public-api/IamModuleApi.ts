/** Public API of IAM for other modules (account provisioning). Callers check their own permissions first. */
export interface IamModuleApi {
  createStaffAccount(input: {
    username: string;
    email?: string | null;
    password: string;
    roleCode: string;
    campusId?: string | null;
    locale?: 'en' | 'bn';
  }): Promise<{ userId: string }>;
  /** Guardian login by phone OTP; returns the existing account when the phone is already registered. */
  ensureGuardianAccount(input: { phone: string; locale?: 'en' | 'bn' }): Promise<{ userId: string; created: boolean }>;
  assignRole(userId: string, roleCode: string, campusId?: string | null): Promise<void>;
  disableAccount(userId: string): Promise<void>;
  /** delivery details of active / invited accounts (notifications) */
  contacts(userIds: string[]): Promise<Map<string, UserContact>>;
  /** accounts holding a role (any campus, or assigned org-wide / on this campus) */
  usersWithRole(roleId: string, campusId?: string | null): Promise<string[]>;
}

export interface UserContact {
  userId: string;
  userType: 'staff' | 'guardian' | 'student' | 'system';
  phone: string | null;
  email: string | null;
  locale: 'en' | 'bn';
}
