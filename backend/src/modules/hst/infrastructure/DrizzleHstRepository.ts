import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  allocation,
  bed,
  hostel,
  outpass,
  rollCall,
  room,
  visitorLog,
} from '../../../shared/infrastructure/db/schema/hst.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type {
  AllocationRow,
  BedRow,
  HostelRow,
  HstRepository,
  OccupancyRoom,
  OutpassRow,
  ResidentRow,
  RollRow,
  VisitorRow,
} from '../application/ports.js';

const hostelCols = {
  id: hostel.id,
  campusId: hostel.campusId,
  code: hostel.code,
  name: hostel.name,
  gender: hostel.gender,
  wardenStaffId: hostel.wardenStaffId,
  phone: hostel.phone,
  isActive: hostel.isActive,
};

const allocationCols = {
  id: allocation.id,
  campusId: allocation.campusId,
  hostelId: allocation.hostelId,
  bedId: allocation.bedId,
  studentId: allocation.studentId,
  enrolmentId: allocation.enrolmentId,
  validFrom: allocation.validFrom,
  validTo: allocation.validTo,
  mealPlan: allocation.mealPlan,
  monthlyFeePaisa: allocation.monthlyFeePaisa,
  mealFeePaisa: allocation.mealFeePaisa,
};

const outpassCols = {
  id: outpass.id,
  campusId: outpass.campusId,
  hostelId: outpass.hostelId,
  studentId: outpass.studentId,
  kind: outpass.kind,
  destination: outpass.destination,
  reason: outpass.reason,
  escortName: outpass.escortName,
  escortPhone: outpass.escortPhone,
  outFrom: outpass.outFrom,
  returnBy: outpass.returnBy,
  requestedBy: outpass.requestedBy,
  requestedByType: outpass.requestedByType,
  status: outpass.status,
  decidedAt: outpass.decidedAt,
  decisionNote: outpass.decisionNote,
  checkedOutAt: outpass.checkedOutAt,
  checkedInAt: outpass.checkedInAt,
  overdueNotifiedAt: outpass.overdueNotifiedAt,
};

const visitorCols = {
  id: visitorLog.id,
  hostelId: visitorLog.hostelId,
  studentId: visitorLog.studentId,
  visitorName: visitorLog.visitorName,
  relation: visitorLog.relation,
  phone: visitorLog.phone,
  purpose: visitorLog.purpose,
  inAt: visitorLog.inAt,
  outAt: visitorLog.outAt,
};

/** Allocation valid on a date (valid_to inclusive). */
const allocatedOn = (onDate: string): SQL =>
  and(lte(allocation.validFrom, onDate), or(isNull(allocation.validTo), gte(allocation.validTo, onDate)))!;

export class DrizzleHstRepository implements HstRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async hostel(id: string): Promise<HostelRow | null> {
    const [r] = await this.tx.select(hostelCols).from(hostel).where(eq(hostel.id, id));
    return r ?? null;
  }

  async hostels(campusId?: string): Promise<HostelRow[]> {
    return this.tx
      .select(hostelCols)
      .from(hostel)
      .where(campusId ? eq(hostel.campusId, campusId) : undefined)
      .orderBy(asc(hostel.code));
  }

  async insertRoom(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(room)
      .values(values as typeof room.$inferInsert)
      .returning({ id: room.id });
    return r!.id;
  }

  async insertBeds(rows: Array<Record<string, unknown>>): Promise<number> {
    if (!rows.length) return 0;
    const out = await this.tx
      .insert(bed)
      .values(rows as Array<typeof bed.$inferInsert>)
      .onConflictDoNothing()
      .returning({ id: bed.id });
    return out.length;
  }

  async room(id: string) {
    const [r] = await this.tx
      .select({ id: room.id, hostelId: room.hostelId, campusId: room.campusId, code: room.code })
      .from(room)
      .where(eq(room.id, id));
    return r ?? null;
  }

  async bed(id: string): Promise<BedRow | null> {
    const [r] = await this.tx
      .select({
        id: bed.id,
        code: bed.code,
        isActive: bed.isActive,
        roomId: room.id,
        roomCode: room.code,
        roomType: room.roomType,
        monthlyFeePaisa: room.monthlyFeePaisa,
        roomActive: room.isActive,
        hostelId: room.hostelId,
        campusId: bed.campusId,
      })
      .from(bed)
      .innerJoin(room, eq(room.id, bed.roomId))
      .where(eq(bed.id, id));
    return r ?? null;
  }

  async occupancy(hostelId: string, onDate: string): Promise<OccupancyRoom[]> {
    const rows = await this.tx
      .select({
        roomId: room.id,
        roomCode: room.code,
        floor: room.floor,
        roomType: room.roomType,
        monthlyFeePaisa: room.monthlyFeePaisa,
        bedId: bed.id,
        bedCode: bed.code,
        bedActive: bed.isActive,
        studentId: allocation.studentId,
        allocationId: allocation.id,
      })
      .from(room)
      .leftJoin(bed, eq(bed.roomId, room.id))
      .leftJoin(allocation, and(eq(allocation.bedId, bed.id), allocatedOn(onDate)))
      .where(and(eq(room.hostelId, hostelId), eq(room.isActive, true)))
      .orderBy(asc(room.floor), asc(room.code), asc(bed.code));
    const out = new Map<string, OccupancyRoom>();
    for (const r of rows) {
      const entry =
        out.get(r.roomId) ??
        out
          .set(r.roomId, {
            roomId: r.roomId,
            code: r.roomCode,
            floor: r.floor,
            roomType: r.roomType,
            monthlyFeePaisa: r.monthlyFeePaisa,
            beds: [],
          })
          .get(r.roomId)!;
      if (r.bedId)
        entry.beds.push({
          bedId: r.bedId,
          code: r.bedCode!,
          isActive: r.bedActive!,
          studentId: r.studentId,
          allocationId: r.allocationId,
        });
    }
    return [...out.values()];
  }

  // ---------------- allocations ----------------
  async activeAllocationOf(studentId: string, onDate: string): Promise<AllocationRow | null> {
    const [r] = await this.tx
      .select(allocationCols)
      .from(allocation)
      .where(and(eq(allocation.studentId, studentId), allocatedOn(onDate)));
    return r ?? null;
  }

  async allocation(id: string, forUpdate: boolean): Promise<AllocationRow | null> {
    const q = this.tx.select(allocationCols).from(allocation).where(eq(allocation.id, id));
    const [r] = forUpdate ? await q.for('update') : await q;
    return r ?? null;
  }

  async insertAllocation(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(allocation)
      .values(values as typeof allocation.$inferInsert)
      .returning({ id: allocation.id });
    return r!.id;
  }

  async endAllocation(id: string, validTo: string, reason: string): Promise<void> {
    await this.tx.update(allocation).set({ validTo, endReason: reason }).where(eq(allocation.id, id));
  }

  async residents(hostelId: string, onDate: string): Promise<ResidentRow[]> {
    return this.tx
      .select({
        allocationId: allocation.id,
        studentId: allocation.studentId,
        mealPlan: allocation.mealPlan,
        diet: allocation.diet,
        dietNote: allocation.dietNote,
        bedId: bed.id,
        bedCode: bed.code,
        roomId: room.id,
        roomCode: room.code,
        floor: room.floor,
        validFrom: allocation.validFrom,
      })
      .from(allocation)
      .innerJoin(bed, eq(bed.id, allocation.bedId))
      .innerJoin(room, eq(room.id, bed.roomId))
      .where(and(eq(allocation.hostelId, hostelId), allocatedOn(onDate)))
      .orderBy(asc(room.floor), asc(room.code), asc(bed.code));
  }

  // ---------------- roll call ----------------
  async rollCall(hostelId: string, date: string, session: 'morning' | 'night'): Promise<RollRow[]> {
    return this.tx
      .select({
        studentId: rollCall.studentId,
        status: rollCall.status,
        note: rollCall.note,
        markedAt: rollCall.markedAt,
      })
      .from(rollCall)
      .where(and(eq(rollCall.hostelId, hostelId), eq(rollCall.rollDate, date), eq(rollCall.session, session)));
  }

  async upsertRollCall(rows: Array<Record<string, unknown>>): Promise<void> {
    if (!rows.length) return;
    await this.tx
      .insert(rollCall)
      .values(rows as Array<typeof rollCall.$inferInsert>)
      .onConflictDoUpdate({
        target: [rollCall.studentId, rollCall.rollDate, rollCall.session],
        set: {
          status: sql`excluded.status`,
          note: sql`excluded.note`,
          markedBy: sql`excluded.marked_by`,
          markedAt: sql`excluded.marked_at`,
        },
      });
  }

  // ---------------- out-passes ----------------
  async insertOutpass(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(outpass)
      .values(values as typeof outpass.$inferInsert)
      .returning({ id: outpass.id });
    return r!.id;
  }

  async outpass(id: string, forUpdate: boolean): Promise<OutpassRow | null> {
    const q = this.tx.select(outpassCols).from(outpass).where(eq(outpass.id, id));
    const [r] = forUpdate ? await q.for('update') : await q;
    return r ?? null;
  }

  async updateOutpass(id: string, patch: Record<string, unknown>): Promise<void> {
    await this.tx.update(outpass).set(patch).where(eq(outpass.id, id));
  }

  async outpasses(f: { hostelId?: string; studentId?: string; status?: string; limit: number }): Promise<OutpassRow[]> {
    const where: SQL[] = [];
    if (f.hostelId) where.push(eq(outpass.hostelId, f.hostelId));
    if (f.studentId) where.push(eq(outpass.studentId, f.studentId));
    if (f.status) where.push(eq(outpass.status, f.status as OutpassRow['status']));
    return this.tx
      .select(outpassCols)
      .from(outpass)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(outpass.outFrom))
      .limit(f.limit);
  }

  async overlappingOutpass(studentId: string, from: Date, to: Date): Promise<boolean> {
    const [r] = await this.tx
      .select({ id: outpass.id })
      .from(outpass)
      .where(
        and(
          eq(outpass.studentId, studentId),
          inArray(outpass.status, ['pending', 'approved', 'out']),
          lt(outpass.outFrom, to),
          sql`${outpass.returnBy} > ${from}`,
        ),
      )
      .limit(1);
    return !!r;
  }

  async studentsOut(hostelId: string): Promise<string[]> {
    const rows = await this.tx
      .select({ studentId: outpass.studentId })
      .from(outpass)
      .where(and(eq(outpass.hostelId, hostelId), eq(outpass.status, 'out')));
    return rows.map((r) => r.studentId);
  }

  async overdueOutpasses(now: Date, limit: number): Promise<OutpassRow[]> {
    const locked = await this.tx
      .select({ id: outpass.id })
      .from(outpass)
      .where(and(eq(outpass.status, 'out'), lt(outpass.returnBy, now), isNull(outpass.overdueNotifiedAt)))
      .orderBy(asc(outpass.returnBy))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (!locked.length) return [];
    return this.tx
      .select(outpassCols)
      .from(outpass)
      .where(
        inArray(
          outpass.id,
          locked.map((l) => l.id),
        ),
      );
  }

  // ---------------- visitors ----------------
  async insertVisitor(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(visitorLog)
      .values(values as typeof visitorLog.$inferInsert)
      .returning({ id: visitorLog.id });
    return r!.id;
  }

  async visitor(id: string): Promise<VisitorRow | null> {
    const [r] = await this.tx.select(visitorCols).from(visitorLog).where(eq(visitorLog.id, id));
    return r ?? null;
  }

  async setVisitorOut(id: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(visitorLog)
      .set({ outAt: at })
      .where(and(eq(visitorLog.id, id), isNull(visitorLog.outAt)))
      .returning({ id: visitorLog.id });
    return rows.length > 0;
  }

  async visitors(f: {
    hostelId?: string;
    studentId?: string;
    from?: Date;
    to?: Date;
    limit: number;
  }): Promise<VisitorRow[]> {
    const where: SQL[] = [];
    if (f.hostelId) where.push(eq(visitorLog.hostelId, f.hostelId));
    if (f.studentId) where.push(eq(visitorLog.studentId, f.studentId));
    if (f.from) where.push(gte(visitorLog.inAt, f.from));
    if (f.to) where.push(lte(visitorLog.inAt, f.to));
    return this.tx
      .select(visitorCols)
      .from(visitorLog)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(visitorLog.inAt))
      .limit(f.limit);
  }
}
