/** Public API of CORE (docs/backend/modules.md#core). The only CORE import other modules may use. */
export interface AcademicYearDto {
  id: string;
  code: string;
  startsOn: string;
  endsOn: string;
  status: 'planned' | 'open' | 'closing' | 'locked' | 'archived';
  isCurrent: boolean;
}

export interface SchoolDayInfo {
  schoolDay: boolean;
  reason?: 'weekend' | 'holiday' | 'outside_year';
  holiday?: string;
}

export interface CampusDto {
  id: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
}

export interface CoreModuleApi {
  currentYear(): Promise<AcademicYearDto | null>;
  getYear(id: string): Promise<AcademicYearDto | null>;
  /** The academic year containing the date (YYYY-MM-DD). */
  yearFor(date: string): Promise<AcademicYearDto | null>;
  getCampus(id: string): Promise<CampusDto | null>;
  /** active campuses of the organisation */
  campuses(): Promise<CampusDto[]>;
  /** academic years, newest first */
  years(): Promise<AcademicYearDto[]>;
  /** campus row overrides the organisation default */
  getSetting<T>(key: string, campusId?: string | null): Promise<T | undefined>;
  /** Working day (core.setting week.working_days) and not a non-instructional calendar event. */
  isSchoolDay(campusId: string, date: string): Promise<SchoolDayInfo>;
}
