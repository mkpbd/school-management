import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { attendanceCorrection as corr, periodAttendance as pa } from '../../../shared/infrastructure/db/schema/att.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type {
  CorrectionRow,
  HistoryEvent,
  PeriodAttRepository,
  PeriodMark,
} from '../application/PeriodAttendanceUseCases.js';
import type { PeriodStatus } from '../domain/attendance.js';

const corrCols = {
  id: corr.id,
  campusId: corr.campusId,
  kind: corr.kind,
  studentId: corr.studentId,
  attendanceDate: corr.attendanceDate,
  classSectionId: corr.classSectionId,
  teachingGroupId: corr.teachingGroupId,
  periodDefinitionId: corr.periodDefinitionId,
  oldStatus: corr.oldStatus,
  newStatus: corr.newStatus,
  reason: corr.reason,
  status: corr.status,
  requestedBy: corr.requestedBy,
  requestedAt: corr.createdAt,
  decidedBy: corr.decidedBy,
  decidedAt: corr.decidedAt,
  decisionNote: corr.decisionNote,
};

/** Period-wise marks and attendance corrections. */
export class DrizzlePeriodAttRepository implements PeriodAttRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async periodMarks(f: {
    date: string;
    studentIds?: string[];
    periodDefinitionId?: string;
    teachingGroupId?: string;
  }): Promise<PeriodMark[]> {
    if (f.studentIds && !f.studentIds.length) return [];
    const where: SQL[] = [eq(pa.attendanceDate, f.date)];
    if (f.studentIds) where.push(inArray(pa.studentId, f.studentIds));
    if (f.periodDefinitionId) where.push(eq(pa.periodDefinitionId, f.periodDefinitionId));
    if (f.teachingGroupId) where.push(eq(pa.teachingGroupId, f.teachingGroupId));
    const rows = await this.tx
      .select({
        studentId: pa.studentId,
        periodDefinitionId: pa.periodDefinitionId,
        teachingGroupId: pa.teachingGroupId,
        status: pa.status,
        source: pa.source,
        markedBy: pa.markedBy,
        markedAt: pa.markedAt,
      })
      .from(pa)
      .where(and(...where));
    return rows as PeriodMark[];
  }

  async markCounts(date: string, groupPeriods: Array<{ teachingGroupId: string; periodDefinitionId: string }>) {
    const out = new Map<string, number>();
    if (!groupPeriods.length) return out;
    const rows = await this.tx
      .select({ g: pa.teachingGroupId, p: pa.periodDefinitionId, n: sql<number>`count(*)::int` })
      .from(pa)
      .where(
        and(
          eq(pa.attendanceDate, date),
          inArray(
            pa.teachingGroupId,
            groupPeriods.map((x) => x.teachingGroupId),
          ),
        ),
      )
      .groupBy(pa.teachingGroupId, pa.periodDefinitionId);
    for (const r of rows) out.set(`${r.g}|${r.p}`, r.n);
    return out;
  }

  async upsertPeriodMarks(
    rows: Array<{
      orgId: string;
      campusId: string;
      date: string;
      periodDefinitionId: string;
      teachingGroupId: string;
      studentId: string;
      status: PeriodStatus;
      source: 'teacher' | 'correction';
      markedBy: string | null;
    }>,
  ): Promise<void> {
    if (!rows.length) return;
    await this.tx
      .insert(pa)
      .values(
        rows.map((r) => ({
          orgId: r.orgId,
          campusId: r.campusId,
          attendanceDate: r.date,
          periodDefinitionId: r.periodDefinitionId,
          teachingGroupId: r.teachingGroupId,
          studentId: r.studentId,
          status: r.status,
          source: r.source,
          markedBy: r.markedBy,
        })),
      )
      .onConflictDoUpdate({
        target: [pa.studentId, pa.attendanceDate, pa.periodDefinitionId],
        set: {
          status: sql`excluded.status`,
          source: sql`excluded.source`,
          teachingGroupId: sql`excluded.teaching_group_id`,
          markedBy: sql`excluded.marked_by`,
          markedAt: sql`now()`,
        },
      });
  }

  async insertCorrection(values: Record<string, unknown>): Promise<CorrectionRow> {
    const [row] = await this.tx
      .insert(corr)
      .values(values as typeof corr.$inferInsert)
      .returning(corrCols);
    return row as CorrectionRow;
  }

  async correctionForUpdate(id: string): Promise<CorrectionRow | null> {
    const [row] = await this.tx.select(corrCols).from(corr).where(eq(corr.id, id)).for('update');
    return (row as CorrectionRow | undefined) ?? null;
  }

  async setCorrectionStatus(
    id: string,
    patch: { status: CorrectionRow['status']; decidedBy?: string; decidedAt?: Date; decisionNote?: string | null },
  ): Promise<void> {
    await this.tx.update(corr).set(patch).where(eq(corr.id, id));
  }

  corrections(f: {
    status?: string;
    campusId?: string | null;
    studentId?: string;
    date?: string;
    requestedBy?: string;
    limit: number;
  }): Promise<CorrectionRow[]> {
    const where: SQL[] = [];
    if (f.status) where.push(eq(corr.status, f.status as 'pending'));
    if (f.campusId) where.push(eq(corr.campusId, f.campusId));
    if (f.studentId) where.push(eq(corr.studentId, f.studentId));
    if (f.date) where.push(eq(corr.attendanceDate, f.date));
    if (f.requestedBy) where.push(eq(corr.requestedBy, f.requestedBy));
    return this.tx
      .select(corrCols)
      .from(corr)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(corr.attendanceDate), asc(corr.createdAt))
      .limit(f.limit) as Promise<CorrectionRow[]>;
  }

  async history(studentId: string, date: string): Promise<HistoryEvent[]> {
    const res = await this.tx.execute(sql`SELECT * FROM att.mark_history(${studentId}::uuid, ${date}::date)`);
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      occurredAt: new Date(r.occurred_at as string),
      actorUserId: (r.actor_user_id as string | null) ?? null,
      table: r.table_name as string,
      action: r.action as string,
      before: (r.before as Record<string, unknown> | null) ?? null,
      after: (r.after as Record<string, unknown> | null) ?? null,
      changedCols: (r.changed_cols as string[] | null) ?? [],
    }));
  }
}
