export interface StaffSummary {
  id: string;
  staffNo: string;
  fullNameEn: string;
  campusId: string;
  staffType: string;
  status: string;
  userId: string | null;
  phone: string;
  gender: 'male' | 'female';
  joinedOn: string;
  leftOn: string | null;
}

/** Public API of HRM (staff identity data for ACA, ATT, COM, ...). */
export interface HrmModuleApi {
  staffSummary(staffId: string): Promise<StaffSummary | null>;
  staffSummaries(staffIds: string[]): Promise<Map<string, StaffSummary>>;
  /** staff whose primary campus is this one and who have not left (status active / probation / on leave) */
  staffOfCampus(campusId: string): Promise<StaffSummary[]>;
  /** login accounts of current staff (one campus, or every campus when null) */
  staffUserIds(campusId: string | null): Promise<string[]>;
}
