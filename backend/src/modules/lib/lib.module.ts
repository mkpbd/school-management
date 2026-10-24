import { asClass, Lifetime, type AwilixContainer } from 'awilix';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleContext, ModuleDefinition } from '../../shared/module.js';
import {
  AddCopies,
  CancelReservation,
  ChangeCopyStatus,
  CompleteStockTake,
  CreateDigitalItem,
  ExpireReservations,
  GetBorrowerAccount,
  GetStockTakeReport,
  GetTitle,
  IssueBook,
  ListDigitalItems,
  ListLoans,
  ListPolicies,
  ListReservations,
  RenewLoan,
  ReserveTitle,
  ReturnBook,
  SavePolicy,
  ScanCopies,
  SearchCatalogue,
  SendOverdueReminders,
  SetTitleCover,
  StartStockTake,
} from './application/LibraryUseCases.js';
import { DrizzleLibRepository } from './infrastructure/DrizzleLibRepository.js';
import { LibModuleApiImpl } from './infrastructure/LibModuleApiImpl.js';
import { LibController } from './presentation/LibController.js';
import { ExpireReservationsJob, LIB_QUEUE, OverdueRemindersJob } from './presentation/jobs.js';

/** LIB: catalogue, circulation, fines (billed through FEE), reservations, stock-take, e-library. */
export class LibModule implements ModuleDefinition {
  readonly name = 'lib';

  register(container: AwilixContainer, mc: ModuleContext): void {
    const scoped = { lifetime: Lifetime.SCOPED };
    container.register({
      libRepo: asClass(DrizzleLibRepository, scoped),
      libApi: asClass(LibModuleApiImpl, scoped),
      searchCatalogue: asClass(SearchCatalogue, scoped),
      getTitle: asClass(GetTitle, scoped),
      setTitleCover: asClass(SetTitleCover, scoped),
      addCopies: asClass(AddCopies, scoped),
      changeCopyStatus: asClass(ChangeCopyStatus, scoped),
      issueBook: asClass(IssueBook, scoped),
      returnBook: asClass(ReturnBook, scoped),
      renewLoan: asClass(RenewLoan, scoped),
      listLoans: asClass(ListLoans, scoped),
      getBorrowerAccount: asClass(GetBorrowerAccount, scoped),
      reserveTitle: asClass(ReserveTitle, scoped),
      cancelReservation: asClass(CancelReservation, scoped),
      listReservations: asClass(ListReservations, scoped),
      expireReservations: asClass(ExpireReservations, scoped),
      sendOverdueReminders: asClass(SendOverdueReminders, scoped),
      startStockTake: asClass(StartStockTake, scoped),
      scanCopies: asClass(ScanCopies, scoped),
      getStockTakeReport: asClass(GetStockTakeReport, scoped),
      completeStockTake: asClass(CompleteStockTake, scoped),
      listPolicies: asClass(ListPolicies, scoped),
      savePolicy: asClass(SavePolicy, scoped),
      createDigitalItem: asClass(CreateDigitalItem, scoped),
      listDigitalItems: asClass(ListDigitalItems, scoped),
    });
    mc.jobs.add({ queue: LIB_QUEUE, name: 'overdue-reminders', handler: OverdueRemindersJob as never });
    mc.jobs.add({ queue: LIB_QUEUE, name: 'expire-reservations', handler: ExpireReservationsJob as never });
    mc.jobs.schedules.push(
      { id: 'lib-overdue-reminders', queue: LIB_QUEUE, name: 'overdue-reminders', cron: '0 8 * * *' },
      { id: 'lib-expire-reservations', queue: LIB_QUEUE, name: 'expire-reservations', cron: '15 * * * *' },
    );
  }

  controllers(): BaseController[] {
    return [new LibController()];
  }
}
