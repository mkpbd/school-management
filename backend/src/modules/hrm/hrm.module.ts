import { asClass, Lifetime, type AwilixContainer } from 'awilix';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleDefinition } from '../../shared/module.js';
import {
  BankAdvice,
  CancelPayrollRun,
  ComputePayroll,
  CreateContract,
  CreatePayrollRun,
  DecidePayroll,
  GetPayrollSheet,
  GetPayslip,
  GrantLoan,
  ListContracts,
  ListLoans,
  ListPayrollRuns,
  ListTaxYears,
  LockPayroll,
  MarkPayrollPaid,
  MyPayslips,
  PullAttendanceInputs,
  ReviseContract,
  RenderPayslipPdf,
  RenderRunPayslipsPdf,
  SaveTaxYear,
  SetBankAccount,
  SetPayrollInputs,
  SetTaxProfile,
  SubmitPayroll,
  VerifyTaxYear,
} from './application/PayrollUseCases.js';
import {
  CancelCpdSession,
  ListCpdRegistrations,
  CompleteCpdSession,
  CpdSummary,
  GetStaffCpd,
  ListCpdSessions,
  ListPendingCpd,
  LogExternalCpd,
  MarkCpdAttendance,
  RegisterForCpdSession,
  RenderCpdCertificate,
  ScheduleCpdSession,
  VerifyCpdRecord,
} from './application/CpdUseCases.js';
import { CreateStaff, CreateStaffAccount, GetStaff, SearchStaff, UpdateStaff } from './application/StaffUseCases.js';
import { DrizzleCpdRepository } from './infrastructure/DrizzleCpdRepository.js';
import { PdfkitCpdCertificateRenderer } from './infrastructure/PdfkitCpdCertificateRenderer.js';
import { CpdController } from './presentation/CpdController.js';
import { DrizzlePayrollRepository } from './infrastructure/DrizzlePayrollRepository.js';
import { DrizzleStaffRepository } from './infrastructure/DrizzleStaffRepository.js';
import { PdfkitPayslipRenderer } from './infrastructure/PdfkitPayslipRenderer.js';
import { PayrollController } from './presentation/PayrollController.js';
import { StaffController } from './presentation/StaffController.js';

/** HRM: staff master and payroll (contracts, loans, monthly runs with maker-checker). Recruitment / appraisal follow. */
export class HrmModule implements ModuleDefinition {
  readonly name = 'hrm';

  register(container: AwilixContainer): void {
    const scoped = { lifetime: Lifetime.SCOPED };
    container.register({
      staffRepo: asClass(DrizzleStaffRepository, scoped),
      hrmApi: asClass(DrizzleStaffRepository, scoped),
      createStaff: asClass(CreateStaff, scoped),
      updateStaff: asClass(UpdateStaff, scoped),
      getStaff: asClass(GetStaff, scoped),
      searchStaff: asClass(SearchStaff, scoped),
      createStaffAccount: asClass(CreateStaffAccount, scoped),
      // payroll
      payrollRepo: asClass(DrizzlePayrollRepository, scoped),
      createContract: asClass(CreateContract, scoped),
      reviseContract: asClass(ReviseContract, scoped),
      listContracts: asClass(ListContracts, scoped),
      setBankAccount: asClass(SetBankAccount, scoped),
      grantStaffLoan: asClass(GrantLoan, scoped),
      listStaffLoans: asClass(ListLoans, scoped),
      createPayrollRun: asClass(CreatePayrollRun, scoped),
      setPayrollInputs: asClass(SetPayrollInputs, scoped),
      pullAttendanceInputs: asClass(PullAttendanceInputs, scoped),
      computePayroll: asClass(ComputePayroll, scoped),
      submitPayroll: asClass(SubmitPayroll, scoped),
      decidePayroll: asClass(DecidePayroll, scoped),
      lockPayroll: asClass(LockPayroll, scoped),
      markPayrollPaid: asClass(MarkPayrollPaid, scoped),
      cancelPayrollRun: asClass(CancelPayrollRun, scoped),
      listPayrollRuns: asClass(ListPayrollRuns, scoped),
      getPayrollSheet: asClass(GetPayrollSheet, scoped),
      getPayslip: asClass(GetPayslip, scoped),
      myPayslips: asClass(MyPayslips, scoped),
      bankAdvice: asClass(BankAdvice, scoped),
      payslipPdf: asClass(PdfkitPayslipRenderer, { lifetime: Lifetime.SINGLETON }),
      renderPayslipPdf: asClass(RenderPayslipPdf, scoped),
      renderRunPayslipsPdf: asClass(RenderRunPayslipsPdf, scoped),
      listTaxYears: asClass(ListTaxYears, scoped),
      saveTaxYear: asClass(SaveTaxYear, scoped),
      verifyTaxYear: asClass(VerifyTaxYear, scoped),
      setTaxProfile: asClass(SetTaxProfile, scoped),
      // CPD
      cpdRepo: asClass(DrizzleCpdRepository, scoped),
      cpdCertificates: asClass(PdfkitCpdCertificateRenderer, { lifetime: Lifetime.SINGLETON }),
      scheduleCpdSession: asClass(ScheduleCpdSession, scoped),
      listCpdSessions: asClass(ListCpdSessions, scoped),
      registerForCpdSession: asClass(RegisterForCpdSession, scoped),
      markCpdAttendance: asClass(MarkCpdAttendance, scoped),
      completeCpdSession: asClass(CompleteCpdSession, scoped),
      cancelCpdSession: asClass(CancelCpdSession, scoped),
      listCpdRegistrations: asClass(ListCpdRegistrations, scoped),
      logExternalCpd: asClass(LogExternalCpd, scoped),
      verifyCpdRecord: asClass(VerifyCpdRecord, scoped),
      listPendingCpd: asClass(ListPendingCpd, scoped),
      getStaffCpd: asClass(GetStaffCpd, scoped),
      cpdSummary: asClass(CpdSummary, scoped),
      renderCpdCertificate: asClass(RenderCpdCertificate, scoped),
    });
  }

  controllers(): BaseController[] {
    return [new StaffController(), new PayrollController(), new CpdController()];
  }
}
