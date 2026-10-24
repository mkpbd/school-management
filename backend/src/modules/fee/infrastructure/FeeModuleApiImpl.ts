import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Clock } from '../../../shared/domain/Clock.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import { invoice } from '../../../shared/infrastructure/db/schema/fee.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { SisModuleApi } from '../../sis/public-api/SisModuleApi.js';
import type { RaiseCharge } from '../application/FeeUseCases.js';
import { InvariantError } from '../../../shared/domain/errors.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { FeeRepository } from '../application/ports.js';
import type { ChargeRequest, ChargeResult, FeeModuleApi, StudentFeeItemRequest } from '../public-api/FeeModuleApi.js';

export class FeeModuleApiImpl implements FeeModuleApi {
  constructor(
    private readonly d: {
      uow: UnitOfWork;
      clock: Clock;
      ctx: RequestContext;
      sisApi: SisModuleApi;
      raiseCharge: RaiseCharge;
      feeRepo: FeeRepository;
    },
  ) {}

  addStudentFeeItem(item: StudentFeeItemRequest): Promise<{ id: string }> {
    return this.d.uow.run(async () => {
      const head = await this.d.feeRepo.feeHeadByCode(item.feeHeadCode);
      if (!head) throw new InvariantError('FEE_HEAD_MISSING', `Fee head ${item.feeHeadCode} is not configured`);
      const id = await this.d.feeRepo.insertStudentFeeItem({
        orgId: this.d.ctx.orgId,
        campusId: item.campusId,
        enrolmentId: item.enrolmentId,
        feeHeadId: head.id,
        amountPaisa: item.amountPaisa,
        validFrom: item.validFrom,
        sourceModule: item.sourceModule,
        sourceRef: item.sourceRef,
      });
      return { id };
    });
  }

  endStudentFeeItems(sourceModule: string, sourceRef: string, validTo: string): Promise<number> {
    return this.d.uow.run(() => this.d.feeRepo.endStudentFeeItems(sourceModule, sourceRef, validTo));
  }

  raiseCharge(charge: ChargeRequest): Promise<ChargeResult> {
    return this.d.raiseCharge.execute(charge);
  }

  familyDues(familyId: string): Promise<{ outstandingPaisa: number; overduePaisa: number }> {
    return this.d.uow.run(async () => {
      const today = LocalDate.today(this.d.clock).iso;
      const [r] = await this.d.uow
        .tx()
        .select({
          outstanding: sql<number>`coalesce(sum(${invoice.netPaisa} - ${invoice.paidPaisa}), 0)::bigint`,
          overdue: sql<number>`coalesce(sum(${invoice.netPaisa} - ${invoice.paidPaisa}) FILTER (WHERE ${invoice.dueDate} < ${today}), 0)::bigint`,
        })
        .from(invoice)
        .where(and(eq(invoice.familyId, familyId), inArray(invoice.status, ['issued', 'partially_paid'])));
      return { outstandingPaisa: Number(r?.outstanding ?? 0), overduePaisa: Number(r?.overdue ?? 0) };
    });
  }

  async clearanceStatus(studentId: string): Promise<{ cleared: boolean; overduePaisa: number }> {
    const brief = (await this.d.sisApi.studentBriefs([studentId])).get(studentId);
    if (!brief) return { cleared: false, overduePaisa: 0 };
    const { overduePaisa } = await this.familyDues(brief.familyId);
    return { cleared: overduePaisa === 0, overduePaisa };
  }
}
