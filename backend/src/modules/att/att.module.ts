import { asClass, Lifetime, type AwilixContainer } from 'awilix';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleDefinition } from '../../shared/module.js';
import {
  ApplyStudentLeave,
  DecideStudentLeave,
  GetRegisterSheet,
  GetStudentAttendanceSummary,
  ListStudentLeaves,
  MarkDailyAttendance,
} from './application/AttendanceUseCases.js';
import {
  CancelAttendanceCorrection,
  DecideAttendanceCorrection,
  GetMarkHistory,
  GetMyRegisters,
  GetPeriodRegister,
  GetSectionDay,
  ListAttendanceCorrections,
  MarkPeriodAttendance,
  RequestAttendanceCorrection,
} from './application/PeriodAttendanceUseCases.js';
import {
  ApplyStaffLeave,
  CancelStaffLeave,
  DecideStaffLeave,
  GetLeaveBalances,
  GetStaffDailySheet,
  GetStaffMonth,
  ListLeaveTypes,
  ListStaffLeaves,
  MarkStaffDaily,
  StaffCheckIn,
  StaffCheckOut,
} from './application/StaffAttendanceUseCases.js';
import { AttModuleApiImpl } from './infrastructure/AttModuleApiImpl.js';
import { DrizzleAttRepository } from './infrastructure/DrizzleAttRepository.js';
import { DrizzlePeriodAttRepository } from './infrastructure/DrizzlePeriodAttRepository.js';
import { DrizzleStaffAttRepository } from './infrastructure/DrizzleStaffAttRepository.js';
import { AttController } from './presentation/AttController.js';
import { StaffAttController } from './presentation/StaffAttController.js';

/** ATT: student daily and period-wise attendance, corrections with audit, leave; staff attendance (register, check-in / out) and leave with balances. */
export class AttModule implements ModuleDefinition {
  readonly name = 'att';

  register(container: AwilixContainer): void {
    const scoped = { lifetime: Lifetime.SCOPED };
    container.register({
      attRepo: asClass(DrizzleAttRepository, scoped),
      getRegisterSheet: asClass(GetRegisterSheet, scoped),
      markDailyAttendance: asClass(MarkDailyAttendance, scoped),
      getStudentAttendanceSummary: asClass(GetStudentAttendanceSummary, scoped),
      applyStudentLeave: asClass(ApplyStudentLeave, scoped),
      decideStudentLeave: asClass(DecideStudentLeave, scoped),
      listStudentLeaves: asClass(ListStudentLeaves, scoped),
      // period-wise, corrections, history
      periodAttRepo: asClass(DrizzlePeriodAttRepository, scoped),
      getMyRegisters: asClass(GetMyRegisters, scoped),
      getPeriodRegister: asClass(GetPeriodRegister, scoped),
      markPeriodAttendance: asClass(MarkPeriodAttendance, scoped),
      getSectionDay: asClass(GetSectionDay, scoped),
      requestAttendanceCorrection: asClass(RequestAttendanceCorrection, scoped),
      decideAttendanceCorrection: asClass(DecideAttendanceCorrection, scoped),
      cancelAttendanceCorrection: asClass(CancelAttendanceCorrection, scoped),
      listAttendanceCorrections: asClass(ListAttendanceCorrections, scoped),
      getMarkHistory: asClass(GetMarkHistory, scoped),
      // staff
      staffAttRepo: asClass(DrizzleStaffAttRepository, scoped),
      attApi: asClass(AttModuleApiImpl, scoped),
      listLeaveTypes: asClass(ListLeaveTypes, scoped),
      getLeaveBalances: asClass(GetLeaveBalances, scoped),
      applyStaffLeave: asClass(ApplyStaffLeave, scoped),
      decideStaffLeave: asClass(DecideStaffLeave, scoped),
      cancelStaffLeave: asClass(CancelStaffLeave, scoped),
      listStaffLeaves: asClass(ListStaffLeaves, scoped),
      getStaffDailySheet: asClass(GetStaffDailySheet, scoped),
      markStaffDaily: asClass(MarkStaffDaily, scoped),
      staffCheckIn: asClass(StaffCheckIn, scoped),
      staffCheckOut: asClass(StaffCheckOut, scoped),
      getStaffMonth: asClass(GetStaffMonth, scoped),
    });
  }

  controllers(): BaseController[] {
    return [new AttController(), new StaffAttController()];
  }
}
