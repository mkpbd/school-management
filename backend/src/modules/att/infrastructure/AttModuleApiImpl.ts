import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import { monthRange, payRules } from '../application/StaffAttendanceUseCases.js';
import type { StaffAttRepository } from '../application/staffPorts.js';
import { summariseStaffMonth } from '../domain/staffAttendance.js';
import type { AttModuleApi, StaffMonthSummary } from '../public-api/AttModuleApi.js';

export class AttModuleApiImpl implements AttModuleApi {
  constructor(private readonly d: { uow: UnitOfWork; staffAttRepo: StaffAttRepository; coreApi: CoreModuleApi }) {}

  staffMonthSummaries(campusId: string, staffIds: string[], month: string): Promise<Map<string, StaffMonthSummary>> {
    return this.d.uow.run(
      async () => {
        const { from, end } = monthRange(month);
        const counts = await this.d.staffAttRepo.monthCounts(staffIds, from, end);
        const rules = await payRules(this.d, campusId);
        return new Map([...counts].map(([id, c]) => [id, summariseStaffMonth(c, rules)]));
      },
      { readOnly: !this.d.uow.isActive() },
    );
  }
}
