import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import { academicYear, calendarEvent, campus, setting } from '../../../shared/infrastructure/db/schema/core.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { AcademicYearDto, CampusDto, CoreModuleApi, SchoolDayInfo } from '../public-api/CoreModuleApi.js';

const yearCols = {
  id: academicYear.id,
  code: academicYear.code,
  startsOn: academicYear.startsOn,
  endsOn: academicYear.endsOn,
  status: academicYear.status,
  isCurrent: academicYear.isCurrent,
};

/** Runs inside the caller's UnitOfWork (joins its transaction and RLS context). */
export class CoreModuleApiImpl implements CoreModuleApi {
  constructor(private readonly d: { uow: UnitOfWork; ctx: RequestContext }) {}

  private run<T>(fn: () => Promise<T>): Promise<T> {
    return this.d.uow.run(fn, { readOnly: !this.d.uow.isActive() });
  }

  currentYear(): Promise<AcademicYearDto | null> {
    return this.run(async () => {
      const [row] = await this.d.uow.tx().select(yearCols).from(academicYear).where(eq(academicYear.isCurrent, true));
      return row ?? null;
    });
  }

  getYear(id: string): Promise<AcademicYearDto | null> {
    return this.run(async () => {
      const [row] = await this.d.uow.tx().select(yearCols).from(academicYear).where(eq(academicYear.id, id));
      return row ?? null;
    });
  }

  yearFor(date: string): Promise<AcademicYearDto | null> {
    return this.run(async () => {
      const [row] = await this.d.uow
        .tx()
        .select(yearCols)
        .from(academicYear)
        .where(and(lte(academicYear.startsOn, date), gte(academicYear.endsOn, date)));
      return row ?? null;
    });
  }

  campuses(): Promise<CampusDto[]> {
    return this.run(() =>
      this.d.uow
        .tx()
        .select({ id: campus.id, code: campus.code, nameEn: campus.nameEn, nameBn: campus.nameBn })
        .from(campus)
        .where(eq(campus.isActive, true))
        .orderBy(campus.code),
    );
  }

  years(): Promise<AcademicYearDto[]> {
    return this.run(() => this.d.uow.tx().select(yearCols).from(academicYear).orderBy(desc(academicYear.startsOn)));
  }

  getCampus(id: string): Promise<CampusDto | null> {
    return this.run(async () => {
      const [row] = await this.d.uow
        .tx()
        .select({ id: campus.id, code: campus.code, nameEn: campus.nameEn, nameBn: campus.nameBn })
        .from(campus)
        .where(eq(campus.id, id));
      return row ?? null;
    });
  }

  getSetting<T>(key: string, campusId?: string | null): Promise<T | undefined> {
    return this.run(async () => {
      const rows = await this.d.uow
        .tx()
        .select({ campusId: setting.campusId, value: setting.value })
        .from(setting)
        .where(
          and(
            eq(setting.key, key),
            campusId ? or(isNull(setting.campusId), eq(setting.campusId, campusId)) : isNull(setting.campusId),
          ),
        )
        .orderBy(desc(setting.campusId)); // campus row (non-null) first
      const row = rows.find((r) => r.campusId !== null) ?? rows[0];
      return row?.value as T | undefined;
    });
  }

  isSchoolDay(campusId: string, date: string): Promise<SchoolDayInfo> {
    return this.run(async () => {
      const day = LocalDate.parse(date).dayOfWeek();
      const working = (await this.getSetting<number[]>('week.working_days', campusId)) ?? [6, 0, 1, 2, 3, 4];
      if (!working.includes(day)) return { schoolDay: false, reason: 'weekend' };
      if (!(await this.yearFor(date))) return { schoolDay: false, reason: 'outside_year' };
      const [holiday] = await this.d.uow
        .tx()
        .select({ title: calendarEvent.titleEn })
        .from(calendarEvent)
        .where(
          and(
            eq(calendarEvent.isInstructional, false),
            or(isNull(calendarEvent.campusId), eq(calendarEvent.campusId, campusId)),
            lte(calendarEvent.startsOn, date),
            gte(calendarEvent.endsOn, date),
            or(eq(calendarEvent.audience, 'all'), eq(calendarEvent.audience, 'students')),
          ),
        )
        .limit(1);
      return holiday ? { schoolDay: false, reason: 'holiday', holiday: holiday.title } : { schoolDay: true };
    });
  }
}
