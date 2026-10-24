import { asClass, Lifetime, type AwilixContainer } from 'awilix';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleContext, ModuleDefinition } from '../../shared/module.js';
import {
  CreateJournal,
  GetJournal,
  GetLedger,
  GetTrialBalance,
  ListJournals,
  ListPeriods,
  PostPayrollJournal,
  PostPayrollPayment,
  ReverseJournal,
  SetPeriodStatus,
} from './application/AccountingUseCases.js';
import {
  BudgetVsActual,
  CreateBudget,
  CreateCostCentre,
  DecideBudget,
  GetBudget,
  ListBudgets,
  ListCostCentres,
  SetBudgetLines,
  SubmitBudget,
} from './application/BudgetUseCases.js';
import {
  AddQuotation,
  CancelPurchaseOrder,
  CancelRequisition,
  CreateRequisition,
  CreateVendor,
  DecideRequisition,
  GetPurchaseOrder,
  GetRequisition,
  GetSupplierBill,
  GetVendor,
  IssuePurchaseOrder,
  ListPurchaseOrders,
  ListRequisitions,
  ListSupplierBills,
  ListVendors,
  PayablesAging,
  PaySupplierBill,
  ReceiveGoods,
  RenderPurchaseOrder,
  RecordSupplierBill,
  SelectQuotation,
  SubmitRequisition,
  UpdateVendor,
} from './application/ProcurementUseCases.js';
import { DrizzleAccRepository } from './infrastructure/DrizzleAccRepository.js';
import { DrizzleProcurementRepository } from './infrastructure/DrizzleProcurementRepository.js';
import { PdfkitPurchaseOrderRenderer } from './infrastructure/PdfkitPurchaseOrderRenderer.js';
import { AccController } from './presentation/AccController.js';
import { ProcurementController } from './presentation/ProcurementController.js';
import { OnPayrollLocked, OnPayrollPaid } from './presentation/subscriptions.js';

/**
 * ACC: chart of accounts, double-entry journals, trial balance, ledger, periods; auto-posts payroll; budgets vs
 * actual; procurement (requisition, quotations, PO, goods receipt, supplier bill with VAT / TDS, payment); vendors.
 */
export class AccModule implements ModuleDefinition {
  readonly name = 'acc';

  register(container: AwilixContainer, mc: ModuleContext): void {
    const scoped = { lifetime: Lifetime.SCOPED };
    container.register({
      accRepo: asClass(DrizzleAccRepository, scoped),
      // budgets and procurement (ACC-03..05)
      procRepo: asClass(DrizzleProcurementRepository, scoped),
      listCostCentres: asClass(ListCostCentres, scoped),
      createCostCentre: asClass(CreateCostCentre, scoped),
      createBudget: asClass(CreateBudget, scoped),
      setBudgetLines: asClass(SetBudgetLines, scoped),
      submitBudget: asClass(SubmitBudget, scoped),
      decideBudget: asClass(DecideBudget, scoped),
      listBudgets: asClass(ListBudgets, scoped),
      getBudget: asClass(GetBudget, scoped),
      budgetVsActual: asClass(BudgetVsActual, scoped),
      createVendor: asClass(CreateVendor, scoped),
      updateVendor: asClass(UpdateVendor, scoped),
      listVendors: asClass(ListVendors, scoped),
      getVendor: asClass(GetVendor, scoped),
      createRequisition: asClass(CreateRequisition, scoped),
      submitRequisition: asClass(SubmitRequisition, scoped),
      decideRequisition: asClass(DecideRequisition, scoped),
      cancelRequisition: asClass(CancelRequisition, scoped),
      listRequisitions: asClass(ListRequisitions, scoped),
      getRequisition: asClass(GetRequisition, scoped),
      addQuotation: asClass(AddQuotation, scoped),
      selectQuotation: asClass(SelectQuotation, scoped),
      issuePurchaseOrder: asClass(IssuePurchaseOrder, scoped),
      cancelPurchaseOrder: asClass(CancelPurchaseOrder, scoped),
      receiveGoods: asClass(ReceiveGoods, scoped),
      recordSupplierBill: asClass(RecordSupplierBill, scoped),
      paySupplierBill: asClass(PaySupplierBill, scoped),
      listPurchaseOrders: asClass(ListPurchaseOrders, scoped),
      getPurchaseOrder: asClass(GetPurchaseOrder, scoped),
      listSupplierBills: asClass(ListSupplierBills, scoped),
      getSupplierBill: asClass(GetSupplierBill, scoped),
      payablesAging: asClass(PayablesAging, scoped),
      renderPurchaseOrder: asClass(RenderPurchaseOrder, scoped),
      poPdf: asClass(PdfkitPurchaseOrderRenderer, { lifetime: Lifetime.SINGLETON }),
      createJournal: asClass(CreateJournal, scoped),
      reverseJournal: asClass(ReverseJournal, scoped),
      getJournal: asClass(GetJournal, scoped),
      listJournals: asClass(ListJournals, scoped),
      getTrialBalance: asClass(GetTrialBalance, scoped),
      getLedger: asClass(GetLedger, scoped),
      listPeriods: asClass(ListPeriods, scoped),
      setPeriodStatus: asClass(SetPeriodStatus, scoped),
      postPayrollJournal: asClass(PostPayrollJournal, scoped),
      postPayrollPayment: asClass(PostPayrollPayment, scoped),
    });
    mc.subscriptions.add({
      eventType: 'hrm.payroll_locked.v1',
      consumer: 'acc.payroll_journal',
      handler: OnPayrollLocked as never,
    });
    mc.subscriptions.add({
      eventType: 'hrm.payroll_paid.v1',
      consumer: 'acc.payroll_payment',
      handler: OnPayrollPaid as never,
    });
  }

  controllers(): BaseController[] {
    return [new AccController(), new ProcurementController()];
  }
}
