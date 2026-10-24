import { asClass, Lifetime, type AwilixContainer } from 'awilix';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleDefinition } from '../../shared/module.js';
import {
  ActivateFeeStructure,
  CloseCashSession,
  CreateAdhocInvoice,
  CreateFeeStructure,
  DecideConcession,
  GetFamilyStatement,
  GetFeeStructure,
  GetInvoice,
  GrantConcession,
  ListInvoices,
  OpenCashSession,
  PostBillingRun,
  PreviewBilling,
  RaiseCharge,
  RecordCounterPayment,
  VoidInvoice,
} from './application/FeeUseCases.js';
import { DrizzleFeeRepository } from './infrastructure/DrizzleFeeRepository.js';
import { FeeModuleApiImpl } from './infrastructure/FeeModuleApiImpl.js';
import { FeeController } from './presentation/FeeController.js';

/** FEE: structures, concessions, billing, invoices, counter payments, receipts, cash sessions, statements. */
export class FeeModule implements ModuleDefinition {
  readonly name = 'fee';

  register(container: AwilixContainer): void {
    const scoped = { lifetime: Lifetime.SCOPED };
    container.register({
      feeRepo: asClass(DrizzleFeeRepository, scoped),
      feeApi: asClass(FeeModuleApiImpl, scoped),
      createFeeStructure: asClass(CreateFeeStructure, scoped),
      activateFeeStructure: asClass(ActivateFeeStructure, scoped),
      getFeeStructure: asClass(GetFeeStructure, scoped),
      grantConcession: asClass(GrantConcession, scoped),
      decideConcession: asClass(DecideConcession, scoped),
      previewBilling: asClass(PreviewBilling, scoped),
      postBillingRun: asClass(PostBillingRun, scoped),
      createAdhocInvoice: asClass(CreateAdhocInvoice, scoped),
      voidInvoice: asClass(VoidInvoice, scoped),
      getInvoice: asClass(GetInvoice, scoped),
      listInvoices: asClass(ListInvoices, scoped),
      recordCounterPayment: asClass(RecordCounterPayment, scoped),
      openCashSession: asClass(OpenCashSession, scoped),
      closeCashSession: asClass(CloseCashSession, scoped),
      getFamilyStatement: asClass(GetFamilyStatement, scoped),
      raiseCharge: asClass(RaiseCharge, scoped),
    });
  }

  controllers(): BaseController[] {
    return [new FeeController()];
  }
}
