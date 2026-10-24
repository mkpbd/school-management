import { asClass, asFunction, Lifetime, type AwilixContainer } from 'awilix';
import type { Logger } from 'pino';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleContext, ModuleDefinition } from '../../shared/module.js';
import { ProviderRegistry } from './application/ports.js';
import {
  ConsoleEmailProvider,
  ConsolePushProvider,
  ConsoleSmsProvider,
  ConsoleWhatsAppProvider,
} from './infrastructure/ConsoleProviders.js';
import { FcmPushProvider } from './infrastructure/FcmPushProvider.js';
import { NOTIFY_QUEUE, NotificationService } from './infrastructure/NotificationService.js';
import { SmtpEmailProvider } from './infrastructure/SmtpEmailProvider.js';
import { SendMessageJob } from './presentation/SendMessageJob.js';
import {
  CreateNotice,
  DeliverNotice,
  GetNotice,
  GetReadReceipts,
  ListNotices,
  GetNoticeAttachmentUrl,
  MarkNoticeRead,
  MyNotices,
  PublishDueNotices,
  PublishNotice,
  UpdateNotice,
  WebsiteNotices,
  WithdrawNotice,
} from './application/NoticeUseCases.js';
import { DrizzleNoticeRepository } from './infrastructure/DrizzleNoticeRepository.js';
import { DrizzleMessagingRepository } from './infrastructure/DrizzleMessagingRepository.js';
import {
  ActivateTemplate,
  CreateTemplateVersion,
  GetMyPreferences,
  ListMyDevices,
  ListTemplates,
  MyInbox,
  PreviewTemplate,
  RegisterPushDevice,
  RevokePushDevice,
  RevokePushDeviceById,
  UpdateMyPreferences,
} from './application/MessagingUseCases.js';
import { MessagingController } from './presentation/MessagingController.js';
import { NoticeController } from './presentation/NoticeController.js';
import { COM_QUEUE, PublishDueNoticesJob } from './presentation/jobs.js';
import {
  OnInvoiceIssued,
  OnLeaveDecided,
  OnLoanOverdue,
  OnPaymentReceived,
  OnReservationReady,
  OnBusNearStop,
  OnHostelEvent,
  OnNoticePublished,
  OnPayrollLocked,
  OnStaffLeaveDecided,
  OnAdmissionReceived,
  OnCpdSessionCancelled,
  OnRequestDecided,
  OnStudentAttendanceAlert,
  OnStudentMissedPeriod,
} from './presentation/subscriptions.js';

/** COM (notification hub part): docs/backend/cross-cutting.md §12. Notices, messaging etc. come with the COM feature work. */
export class ComModule implements ModuleDefinition {
  readonly name = 'com';

  register(container: AwilixContainer, mc: ModuleContext): void {
    container.register({
      providers: asFunction(
        ({ logger, config }: { logger: Logger; config: ModuleContext['config'] }) =>
          // real adapters when configured (SMTP_URL, FCM_*); console adapters for development / tests
          new ProviderRegistry([
            new ConsoleSmsProvider(logger),
            config.SMTP_URL
              ? new SmtpEmailProvider(config.SMTP_URL, config.MAIL_FROM)
              : new ConsoleEmailProvider(logger),
            config.FCM_PROJECT_ID && config.FCM_CLIENT_EMAIL && config.FCM_PRIVATE_KEY
              ? new FcmPushProvider({
                  projectId: config.FCM_PROJECT_ID,
                  clientEmail: config.FCM_CLIENT_EMAIL,
                  privateKey: config.FCM_PRIVATE_KEY,
                })
              : new ConsolePushProvider(logger),
            new ConsoleWhatsAppProvider(logger),
          ]),
        { lifetime: Lifetime.SINGLETON },
      ),
      notifier: asClass(NotificationService, { lifetime: Lifetime.SCOPED }),
      noticeRepo: asClass(DrizzleNoticeRepository, { lifetime: Lifetime.SCOPED }),
      createNotice: asClass(CreateNotice, { lifetime: Lifetime.SCOPED }),
      updateNotice: asClass(UpdateNotice, { lifetime: Lifetime.SCOPED }),
      publishNotice: asClass(PublishNotice, { lifetime: Lifetime.SCOPED }),
      deliverNotice: asClass(DeliverNotice, { lifetime: Lifetime.SCOPED }),
      withdrawNotice: asClass(WithdrawNotice, { lifetime: Lifetime.SCOPED }),
      publishDueNotices: asClass(PublishDueNotices, { lifetime: Lifetime.SCOPED }),
      listNotices: asClass(ListNotices, { lifetime: Lifetime.SCOPED }),
      myNotices: asClass(MyNotices, { lifetime: Lifetime.SCOPED }),
      getNotice: asClass(GetNotice, { lifetime: Lifetime.SCOPED }),
      markNoticeRead: asClass(MarkNoticeRead, { lifetime: Lifetime.SCOPED }),
      getNoticeAttachmentUrl: asClass(GetNoticeAttachmentUrl, { lifetime: Lifetime.SCOPED }),
      getReadReceipts: asClass(GetReadReceipts, { lifetime: Lifetime.SCOPED }),
      websiteNotices: asClass(WebsiteNotices, { lifetime: Lifetime.SCOPED }),
      messagingRepo: asClass(DrizzleMessagingRepository, { lifetime: Lifetime.SCOPED }),
      getMyPreferences: asClass(GetMyPreferences, { lifetime: Lifetime.SCOPED }),
      updateMyPreferences: asClass(UpdateMyPreferences, { lifetime: Lifetime.SCOPED }),
      registerPushDevice: asClass(RegisterPushDevice, { lifetime: Lifetime.SCOPED }),
      listMyDevices: asClass(ListMyDevices, { lifetime: Lifetime.SCOPED }),
      revokePushDevice: asClass(RevokePushDevice, { lifetime: Lifetime.SCOPED }),
      revokePushDeviceById: asClass(RevokePushDeviceById, { lifetime: Lifetime.SCOPED }),
      myInbox: asClass(MyInbox, { lifetime: Lifetime.SCOPED }),
      listTemplates: asClass(ListTemplates, { lifetime: Lifetime.SCOPED }),
      createTemplateVersion: asClass(CreateTemplateVersion, { lifetime: Lifetime.SCOPED }),
      activateTemplate: asClass(ActivateTemplate, { lifetime: Lifetime.SCOPED }),
      previewTemplate: asClass(PreviewTemplate, { lifetime: Lifetime.SCOPED }),
    });
    mc.subscriptions.add({
      eventType: 'com.notice_published.v1',
      consumer: 'com.notice_delivery',
      handler: OnNoticePublished as never,
    });
    mc.jobs.add({ queue: COM_QUEUE, name: 'publish-due-notices', handler: PublishDueNoticesJob as never });
    mc.jobs.schedules.push({
      id: 'com-publish-due-notices',
      queue: COM_QUEUE,
      name: 'publish-due-notices',
      everyMs: 60_000,
    });
    mc.subscriptions.add({
      eventType: 'att.student_marked_absent.v1',
      consumer: 'com.att_absent_alert',
      handler: OnStudentAttendanceAlert as never,
    });
    mc.subscriptions.add({
      eventType: 'att.student_marked_late.v1',
      consumer: 'com.att_late_alert',
      handler: OnStudentAttendanceAlert as never,
    });
    mc.subscriptions.add({
      eventType: 'att.student_missed_period.v1',
      consumer: 'com.att_period_missed',
      handler: OnStudentMissedPeriod as never,
    });
    for (const [eventType, consumer] of [
      ['att.correction_decided.v1', 'com.att_correction_decided'],
      ['acc.requisition_decided.v1', 'com.acc_requisition_decided'],
      ['acc.budget_decided.v1', 'com.acc_budget_decided'],
    ] as const)
      mc.subscriptions.add({ eventType, consumer, handler: OnRequestDecided as never });
    for (const [eventType, consumer] of [
      ['adm.enquiry_received.v1', 'com.adm_enquiry_received'],
      ['adm.application_submitted.v1', 'com.adm_application_submitted'],
    ] as const)
      mc.subscriptions.add({ eventType, consumer, handler: OnAdmissionReceived as never });
    mc.subscriptions.add({
      eventType: 'hrm.cpd_session_cancelled.v1',
      consumer: 'com.hrm_cpd_session_cancelled',
      handler: OnCpdSessionCancelled as never,
    });
    mc.subscriptions.add({
      eventType: 'att.leave_decided.v1',
      consumer: 'com.att_leave_decided',
      handler: OnLeaveDecided as never,
    });
    mc.subscriptions.add({
      eventType: 'fee.payment_received.v1',
      consumer: 'com.fee_payment_receipt',
      handler: OnPaymentReceived as never,
    });
    mc.subscriptions.add({
      eventType: 'fee.invoice_issued.v1',
      consumer: 'com.fee_invoice_issued',
      handler: OnInvoiceIssued as never,
    });
    for (const [eventType, consumer] of [
      ['hst.roll_call_absent.v1', 'com.hst_absent'],
      ['hst.outpass_decided.v1', 'com.hst_outpass_decided'],
      ['hst.student_left.v1', 'com.hst_left'],
      ['hst.student_returned.v1', 'com.hst_returned'],
      ['hst.outpass_overdue.v1', 'com.hst_overdue'],
    ] as const)
      mc.subscriptions.add({ eventType, consumer, handler: OnHostelEvent as never });
    mc.subscriptions.add({
      eventType: 'att.staff_leave_decided.v1',
      consumer: 'com.att_staff_leave_decided',
      handler: OnStaffLeaveDecided as never,
    });
    mc.subscriptions.add({
      eventType: 'hrm.payroll_locked.v1',
      consumer: 'com.hrm_payslip_ready',
      handler: OnPayrollLocked as never,
    });
    mc.subscriptions.add({
      eventType: 'trn.bus_near_stop.v1',
      consumer: 'com.trn_bus_near_stop',
      handler: OnBusNearStop as never,
    });
    mc.subscriptions.add({
      eventType: 'lib.loan_overdue.v1',
      consumer: 'com.lib_loan_overdue',
      handler: OnLoanOverdue as never,
    });
    mc.subscriptions.add({
      eventType: 'lib.reservation_ready.v1',
      consumer: 'com.lib_reservation_ready',
      handler: OnReservationReady as never,
    });
    for (const channel of ['sms', 'email', 'push', 'whatsapp']) {
      mc.jobs.add({ queue: NOTIFY_QUEUE, name: channel, handler: SendMessageJob as never, concurrency: 20 });
    }
  }

  controllers(): BaseController[] {
    return [new NoticeController(), new MessagingController()];
  }
}
