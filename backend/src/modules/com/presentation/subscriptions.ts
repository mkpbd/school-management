import type { Notifier } from '../../../shared/application/ports.js';
import type { PublishedEvent } from '../../../shared/domain/DomainEvent.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import type { HrmModuleApi } from '../../hrm/public-api/HrmModuleApi.js';
import type { IamModuleApi } from '../../iam/public-api/IamModuleApi.js';
import type { SisModuleApi } from '../../sis/public-api/SisModuleApi.js';

interface Deps {
  notifier: Notifier;
  sisApi: SisModuleApi;
  coreApi: CoreModuleApi;
  hrmApi: HrmModuleApi;
  config: { WEB_BASE_URL: string };
}

async function schoolName(core: CoreModuleApi, campusId: string | undefined): Promise<string> {
  const campus = campusId ? await core.getCampus(campusId) : null;
  return campus?.nameEn ?? 'School';
}

/** ATT-03: absent/late -> primary guardian (SMS + push), once per student, day and status. */
export class OnStudentAttendanceAlert {
  constructor(private readonly d: Deps) {}

  async handle(
    e: PublishedEvent<{
      studentId: string;
      studentName: string;
      studentNameBn: string | null;
      date: string;
      status: 'absent' | 'late';
      sectionName: string;
      arrivedAt: string | null;
    }>,
  ): Promise<void> {
    const contact = (await this.d.sisApi.primaryContacts([e.payload.studentId])).get(e.payload.studentId);
    if (!contact) return;
    const time = e.payload.arrivedAt
      ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit' }).format(
          new Date(e.payload.arrivedAt),
        )
      : '';
    await this.d.notifier.dispatch({
      eventCode: e.payload.status === 'late' ? 'att.late' : 'att.absent',
      recipients: [{ userId: contact.userId, phone: contact.phone, email: contact.email, locale: contact.locale }],
      data: {
        student_name:
          contact.locale === 'bn' && e.payload.studentNameBn ? e.payload.studentNameBn : e.payload.studentName,
        class: e.payload.sectionName,
        date: e.payload.date,
        time,
        school: await schoolName(this.d.coreApi, e.campusId),
      },
      dedupeKey: `att.${e.payload.status}:${e.payload.studentId}:${e.payload.date}`,
      campusId: e.campusId ?? null,
      priority: 'high',
    });
  }
}

/** Absent from a lesson while marked in school that day -> primary guardian, once per lesson. */
export class OnStudentMissedPeriod {
  constructor(private readonly d: Deps) {}

  async handle(
    e: PublishedEvent<{
      studentId: string;
      studentName: string;
      studentNameBn: string | null;
      date: string;
      periodDefinitionId: string;
      periodLabel: string;
      groupName: string;
      sectionName: string;
    }>,
  ): Promise<void> {
    const contact = (await this.d.sisApi.primaryContacts([e.payload.studentId])).get(e.payload.studentId);
    if (!contact) return;
    await this.d.notifier.dispatch({
      eventCode: 'att.period_missed',
      recipients: [{ userId: contact.userId, phone: contact.phone, email: contact.email, locale: contact.locale }],
      data: {
        student_name:
          contact.locale === 'bn' && e.payload.studentNameBn ? e.payload.studentNameBn : e.payload.studentName,
        class: e.payload.sectionName,
        period: e.payload.periodLabel,
        subject_group: e.payload.groupName,
        date: e.payload.date,
        school: await schoolName(this.d.coreApi, e.campusId),
      },
      dedupeKey: `att.period_missed:${e.payload.studentId}:${e.payload.date}:${e.payload.periodDefinitionId}`,
      campusId: e.campusId ?? null,
      priority: 'high',
    });
  }
}

/** ATT-04: leave decision -> the guardian who applied (push / in-app). */
export class OnLeaveDecided {
  constructor(private readonly d: Deps) {}

  async handle(
    e: PublishedEvent<{
      leaveId: string;
      studentId: string;
      decision: string;
      fromDate: string;
      toDate: string;
      requestedByUser: string;
    }>,
  ): Promise<void> {
    const brief = (await this.d.sisApi.studentBriefs([e.payload.studentId])).get(e.payload.studentId);
    await this.d.notifier.dispatch({
      eventCode: 'att.leave_decided',
      recipients: [{ userId: e.payload.requestedByUser }],
      channels: ['push', 'in_app'],
      data: {
        message: `Leave for ${brief?.fullNameEn ?? 'your child'} (${e.payload.fromDate} to ${e.payload.toDate}) was ${e.payload.decision}.`,
      },
      dedupeKey: `att.leave_decided:${e.payload.leaveId}`,
      campusId: e.campusId ?? null,
    });
  }
}

/** FEE-06: payment received -> fee payers (SMS receipt line + push). */
export class OnPaymentReceived {
  constructor(private readonly d: Deps) {}

  async handle(
    e: PublishedEvent<{ paymentId: string; familyId: string; receiptNo: string; amountPaisa: number }>,
  ): Promise<void> {
    const payers = await this.d.sisApi.feePayers(e.payload.familyId);
    if (!payers.length) return;
    const amount = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(e.payload.amountPaisa / 100);
    await this.d.notifier.dispatch({
      eventCode: 'fee.payment_received',
      recipients: payers.map((p) => ({ userId: p.userId, phone: p.phone, email: p.email, locale: p.locale })),
      data: { amount, receipt_no: e.payload.receiptNo, school: await schoolName(this.d.coreApi, e.campusId) },
      dedupeKey: `fee.payment_received:${e.payload.paymentId}`,
      campusId: e.campusId ?? null,
    });
  }
}

/** FEE-03: invoice issued -> fee payers with a pay link (quiet hours respected). */
export class OnInvoiceIssued {
  constructor(private readonly d: Deps) {}

  async handle(
    e: PublishedEvent<{
      invoiceId: string;
      invoiceNo: string;
      familyId: string;
      studentId: string | null;
      netPaisa: number;
      dueDate: string;
      payToken: string | null;
    }>,
  ): Promise<void> {
    if (e.payload.netPaisa <= 0) return;
    const payers = await this.d.sisApi.feePayers(e.payload.familyId);
    if (!payers.length) return;
    const student = e.payload.studentId
      ? (await this.d.sisApi.studentBriefs([e.payload.studentId])).get(e.payload.studentId)
      : undefined;
    await this.d.notifier.dispatch({
      eventCode: 'fee.invoice_issued',
      recipients: payers.map((p) => ({ userId: p.userId, phone: p.phone, email: p.email, locale: p.locale })),
      data: {
        invoice_no: e.payload.invoiceNo,
        amount: new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(e.payload.netPaisa / 100),
        student_name: student?.fullNameEn ?? '',
        due_date: e.payload.dueDate,
        pay_link: e.payload.payToken
          ? `${this.d.config.WEB_BASE_URL}/pay/${e.payload.payToken}`
          : this.d.config.WEB_BASE_URL,
      },
      dedupeKey: `fee.invoice_issued:${e.payload.invoiceId}`,
      campusId: e.campusId ?? null,
    });
  }
}

interface LibraryRecipient {
  recipient: { userId: string | null; phone?: string; email?: string | null; locale?: 'en' | 'bn' };
  name: string;
}

/** Library messages go to a student's primary guardian, or to the staff member themself. */
async function libraryRecipient(d: Deps, type: 'student' | 'staff', id: string): Promise<LibraryRecipient | null> {
  if (type === 'staff') {
    const s = await d.hrmApi.staffSummary(id);
    return s ? { recipient: { userId: s.userId, phone: s.phone }, name: s.fullNameEn } : null;
  }
  const contact = (await d.sisApi.primaryContacts([id])).get(id);
  const brief = (await d.sisApi.studentBriefs([id])).get(id);
  if (!contact || !brief) return null;
  return {
    recipient: { userId: contact.userId, phone: contact.phone, email: contact.email, locale: contact.locale },
    name: brief.fullNameEn,
  };
}

/** LIB-02: overdue book reminder on the configured days late (one message per loan and stage). */
export class OnLoanOverdue {
  constructor(private readonly d: Deps) {}

  async handle(
    e: PublishedEvent<{
      loanId: string;
      borrowerType: 'student' | 'staff';
      borrowerId: string;
      title: string;
      dueOn: string;
      daysOverdue: number;
    }>,
  ): Promise<void> {
    const to = await libraryRecipient(this.d, e.payload.borrowerType, e.payload.borrowerId);
    if (!to) return;
    await this.d.notifier.dispatch({
      eventCode: 'lib.loan_overdue',
      recipients: [to.recipient],
      data: {
        borrower_name: to.name,
        title: e.payload.title,
        due_date: e.payload.dueOn,
        days: String(e.payload.daysOverdue),
        school: await schoolName(this.d.coreApi, e.campusId),
      },
      dedupeKey: `lib.loan_overdue:${e.payload.loanId}:${e.payload.daysOverdue}`,
      campusId: e.campusId ?? null,
    });
  }
}

/** LIB-04: a reserved title is waiting at the desk. */
export class OnReservationReady {
  constructor(private readonly d: Deps) {}

  async handle(
    e: PublishedEvent<{
      reservationId: string;
      title: string;
      borrowerType: 'student' | 'staff';
      borrowerId: string;
      expiresAt: string;
    }>,
  ): Promise<void> {
    const to = await libraryRecipient(this.d, e.payload.borrowerType, e.payload.borrowerId);
    if (!to) return;
    await this.d.notifier.dispatch({
      eventCode: 'lib.reservation_ready',
      recipients: [to.recipient],
      data: {
        borrower_name: to.name,
        title: e.payload.title,
        expires: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium' }).format(
          new Date(e.payload.expiresAt),
        ),
        school: await schoolName(this.d.coreApi, e.campusId),
      },
      dedupeKey: `lib.reservation_ready:${e.payload.reservationId}`,
      campusId: e.campusId ?? null,
    });
  }
}

/** TRN-04: the bus is near the stop -> guardians of the students who get on / off there (once per trip and stop). */
export class OnBusNearStop {
  constructor(private readonly d: Deps) {}

  async handle(
    e: PublishedEvent<{
      tripId: string;
      stopId: string;
      stopName: string;
      routeName: string;
      vehicleRegNo: string;
      direction: 'pickup' | 'drop';
      etaMinutes: number;
      studentIds: string[];
    }>,
  ): Promise<void> {
    const contacts = await this.d.sisApi.primaryContacts(e.payload.studentIds);
    if (!contacts.size) return;
    await this.d.notifier.dispatch({
      eventCode: e.payload.direction === 'pickup' ? 'trn.bus_near_pickup' : 'trn.bus_near_drop',
      recipients: [...contacts.values()].map((c) => ({
        userId: c.userId,
        phone: c.phone,
        email: c.email,
        locale: c.locale,
      })),
      data: {
        vehicle: e.payload.vehicleRegNo,
        route: e.payload.routeName,
        stop: e.payload.stopName,
        minutes: String(e.payload.etaMinutes),
        school: await schoolName(this.d.coreApi, e.campusId),
      },
      dedupeKey: `trn.bus_near:${e.payload.tripId}:${e.payload.stopId}`,
      campusId: e.campusId ?? null,
      priority: 'high',
    });
  }
}

/** HRM-04: payroll locked -> each staff member: salary processed, payslip in the app (no amounts in the SMS). */
export class OnPayrollLocked {
  constructor(private readonly d: Deps) {}

  async handle(e: PublishedEvent<{ runId: string; month: string; staffIds: string[] }>): Promise<void> {
    const staff = await this.d.hrmApi.staffSummaries(e.payload.staffIds);
    if (!staff.size) return;
    const month = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${e.payload.month}-01T00:00:00Z`),
    );
    await this.d.notifier.dispatch({
      eventCode: 'hrm.payslip_ready',
      recipients: [...staff.values()].map((s) => ({ userId: s.userId, phone: s.phone })),
      data: { month, school: await schoolName(this.d.coreApi, e.campusId) },
      dedupeKey: `hrm.payslip_ready:${e.payload.runId}`,
      campusId: e.campusId ?? null,
    });
  }
}

const DECISION_WORDS = {
  approved: { en: 'approved', bn: 'অনুমোদিত' },
  rejected: { en: 'rejected', bn: 'প্রত্যাখ্যাত' },
};

/**
 * A decision on someone's own request -> that person (push, e-mail, in-app): attendance corrections, purchase
 * requisitions, budgets. One notification per request and decision.
 */
export class OnRequestDecided {
  constructor(private readonly d: Deps & { iamApi: IamModuleApi }) {}

  async handle(e: PublishedEvent<Record<string, string | boolean | null>>): Promise<void> {
    const p = e.payload;
    const spec = (() => {
      switch (e.type) {
        case 'att.correction_decided.v1':
          return {
            code: 'att.correction_decided',
            userId: p.requestedBy as string,
            id: p.correctionId as string,
            data: { student_name: p.studentName, date: p.date, new_status: p.newStatus, register: p.kind },
          };
        case 'acc.requisition_decided.v1':
          return {
            code: 'acc.requisition_decided',
            userId: p.requestedBy as string,
            id: p.requisitionId as string,
            data: { pr_no: p.prNo, title: p.title },
          };
        case 'acc.budget_decided.v1':
          return {
            code: 'acc.budget_decided',
            userId: p.submittedBy as string,
            id: p.budgetId as string,
            data: { budget_name: p.name },
          };
        default:
          return null;
      }
    })();
    if (!spec?.userId) return;
    const contact = (await this.d.iamApi.contacts([spec.userId])).get(spec.userId);
    if (!contact) return;
    const decision = p.decision === 'approved' ? 'approved' : 'rejected';
    await this.d.notifier.dispatch({
      eventCode: spec.code,
      recipients: [{ userId: contact.userId, phone: contact.phone, email: contact.email, locale: contact.locale }],
      data: {
        ...spec.data,
        decision: DECISION_WORDS[decision][contact.locale],
        note: p.note ?? '',
        school: await schoolName(this.d.coreApi, e.campusId),
      },
      dedupeKey: `${spec.code}:${spec.id}:${decision}`,
      campusId: e.campusId ?? null,
    });
  }
}

/** ADM: website enquiry received / application submitted -> the family (SMS, e-mail); no account needed. */
export class OnAdmissionReceived {
  constructor(private readonly d: Deps) {}

  async handle(
    e: PublishedEvent<{
      enquiryId?: string;
      enquiryNo?: string;
      applicationId?: string;
      applicationNo?: string;
      childName: string;
      guardianName: string | null;
      phone: string | null;
      email: string | null;
      locale: 'en' | 'bn';
    }>,
  ): Promise<void> {
    const p = e.payload;
    if (!p.phone && !p.email) return;
    const application = e.type === 'adm.application_submitted.v1';
    await this.d.notifier.dispatch({
      eventCode: application ? 'adm.application_submitted' : 'adm.enquiry_received',
      recipients: [{ phone: p.phone, email: p.email, locale: p.locale }],
      data: {
        child_name: p.childName,
        guardian_name: p.guardianName ?? '',
        reference: (application ? p.applicationNo : p.enquiryNo) ?? '',
        school: await schoolName(this.d.coreApi, e.campusId),
      },
      dedupeKey: application ? `adm.application_submitted:${p.applicationId}` : `adm.enquiry_received:${p.enquiryId}`,
      campusId: e.campusId ?? null,
    });
  }
}

/** HRM-06: a CPD session was cancelled -> every staff member who had registered. */
export class OnCpdSessionCancelled {
  constructor(private readonly d: Deps) {}

  async handle(
    e: PublishedEvent<{ sessionId: string; title: string; startsAt: string; reason: string; staffIds: string[] }>,
  ): Promise<void> {
    const staff = await this.d.hrmApi.staffSummaries(e.payload.staffIds);
    if (!staff.size) return;
    const when = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(e.payload.startsAt));
    await this.d.notifier.dispatch({
      eventCode: 'hrm.cpd_session_cancelled',
      recipients: [...staff.values()].map((s) => ({ userId: s.userId, phone: s.phone })),
      data: {
        title: e.payload.title,
        when,
        reason: e.payload.reason,
        school: await schoolName(this.d.coreApi, e.campusId),
      },
      dedupeKey: `hrm.cpd_session_cancelled:${e.payload.sessionId}`,
      campusId: e.campusId ?? null,
    });
  }
}

/** ATT: staff leave approved / rejected -> the staff member. */
export class OnStaffLeaveDecided {
  constructor(private readonly d: Deps) {}

  async handle(
    e: PublishedEvent<{
      leaveId: string;
      staffId: string;
      leaveCode: string;
      fromDate: string;
      toDate: string;
      days: number;
      decision: 'approved' | 'rejected';
    }>,
  ): Promise<void> {
    const s = await this.d.hrmApi.staffSummary(e.payload.staffId);
    if (!s) return;
    await this.d.notifier.dispatch({
      eventCode: 'att.staff_leave_decided',
      recipients: [{ userId: s.userId, phone: s.phone }],
      data: {
        leave: e.payload.leaveCode,
        from: e.payload.fromDate,
        to: e.payload.toDate,
        days: String(e.payload.days),
        decision: e.payload.decision,
        school: await schoolName(this.d.coreApi, e.campusId),
      },
      dedupeKey: `att.staff_leave_decided:${e.payload.leaveId}`,
      campusId: e.campusId ?? null,
    });
  }
}

const dhakaTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

/**
 * HST -> primary guardian: roll-call absence, out-pass decision, left / returned at the gate, not back in time
 * (the overdue alert also goes to the warden). Absence and overdue are high priority (night roll call).
 */
export class OnHostelEvent {
  constructor(private readonly d: Deps) {}

  async handle(e: PublishedEvent<Record<string, unknown> & { studentId: string; hostelName?: string }>): Promise<void> {
    const p = e.payload;
    const contact = (await this.d.sisApi.primaryContacts([p.studentId])).get(p.studentId);
    const student = (await this.d.sisApi.studentBriefs([p.studentId])).get(p.studentId);
    if (!contact || !student) return;
    const recipients: Array<{ userId: string | null; phone?: string; email?: string | null; locale?: 'en' | 'bn' }> = [
      { userId: contact.userId, phone: contact.phone, email: contact.email, locale: contact.locale },
    ];
    const base = {
      student_name: student.fullNameEn,
      hostel: String(p.hostelName ?? ''),
      school: await schoolName(this.d.coreApi, e.campusId),
    };
    let eventCode: string;
    let data: Record<string, string>;
    let dedupe: string;
    let priority: 'high' | 'normal' = 'normal';
    switch (e.type) {
      case 'hst.roll_call_absent.v1':
        eventCode = 'hst.absent';
        data = { ...base, date: String(p.date), session: String(p.session) };
        dedupe = `hst.absent:${p.studentId}:${String(p.date)}:${String(p.session)}`;
        priority = 'high';
        break;
      case 'hst.outpass_decided.v1':
        eventCode = 'hst.outpass_decided';
        data = {
          ...base,
          from: dhakaTime(String(p.outFrom)),
          to: dhakaTime(String(p.returnBy)),
          decision: String(p.decision),
        };
        dedupe = `hst.outpass_decided:${String(p.outpassId)}`;
        break;
      case 'hst.student_left.v1':
        eventCode = 'hst.left';
        data = { ...base, time: dhakaTime(String(p.at)), return_by: dhakaTime(String(p.returnBy)) };
        dedupe = `hst.left:${String(p.outpassId)}`;
        break;
      case 'hst.student_returned.v1':
        eventCode = 'hst.returned';
        data = { ...base, time: dhakaTime(String(p.at)) };
        dedupe = `hst.returned:${String(p.outpassId)}`;
        break;
      case 'hst.outpass_overdue.v1': {
        eventCode = 'hst.overdue';
        data = { ...base, return_by: dhakaTime(String(p.returnBy)) };
        dedupe = `hst.overdue:${String(p.outpassId)}`;
        priority = 'high';
        const warden = p.wardenStaffId ? await this.d.hrmApi.staffSummary(String(p.wardenStaffId)) : null;
        if (warden) recipients.push({ userId: warden.userId, phone: warden.phone });
        break;
      }
      default:
        return;
    }
    await this.d.notifier.dispatch({
      eventCode,
      recipients,
      data,
      dedupeKey: dedupe,
      campusId: e.campusId ?? null,
      priority,
    });
  }
}

/** COM-01: a published notice is delivered (push; SMS / e-mail for urgent ones) in batches. */
export class OnNoticePublished {
  constructor(private readonly d: { deliverNotice: { execute(i: { noticeId: string }): Promise<unknown> } }) {}

  async handle(e: PublishedEvent<{ noticeId: string }>): Promise<void> {
    await this.d.deliverNotice.execute({ noticeId: e.payload.noticeId });
  }
}
