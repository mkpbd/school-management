import type { Clock } from '../../../shared/domain/Clock.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { LibRepository } from '../application/ports.js';
import type { LibModuleApi } from '../public-api/LibModuleApi.js';

export class LibModuleApiImpl implements LibModuleApi {
  constructor(private readonly d: { uow: UnitOfWork; clock: Clock; libRepo: LibRepository }) {}

  clearanceStatus(studentId: string): Promise<{ cleared: boolean; activeLoans: number; overdueLoans: number }> {
    return this.d.uow.run(
      async () => {
        const c = await this.d.libRepo.activeLoanCount('student', studentId, LocalDate.today(this.d.clock).iso);
        return { cleared: c.active === 0, activeLoans: c.active, overdueLoans: c.overdue };
      },
      { readOnly: !this.d.uow.isActive() },
    );
  }
}
