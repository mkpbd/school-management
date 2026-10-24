import {
  CancelMealOptOut,
  GetMealHeadcount,
  GetMessMenu,
  GetStudentMeals,
  MessMonthReport,
  OptOutOfMeals,
  RecordMealService,
  SetMessMenu,
  SetResidentDiet,
} from './application/MessUseCases.js';
import { DrizzleMessRepository } from './infrastructure/DrizzleMessRepository.js';
import { MessController } from './presentation/MessController.js';
import { asClass, Lifetime, type AwilixContainer } from 'awilix';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleContext, ModuleDefinition } from '../../shared/module.js';
import {
  AddBeds,
  AlertOverdueOutpasses,
  AllocateBed,
  CancelOutpass,
  CheckInAtGate,
  CheckOutAtGate,
  CreateRoom,
  DecideOutpass,
  GetOccupancy,
  GetRollCall,
  GetStudentHostel,
  ListOutpasses,
  ListResidents,
  ListVisitors,
  LogVisitorIn,
  LogVisitorOut,
  MarkRollCall,
  RequestOutpass,
  TransferBed,
  VacateBed,
} from './application/HostelUseCases.js';
import { DrizzleHstRepository } from './infrastructure/DrizzleHstRepository.js';
import { HstController } from './presentation/HstController.js';
import { HST_QUEUE, OverdueOutpassJob } from './presentation/jobs.js';

/** HST: hostels, rooms, beds, allocations (rent / meals via FEE), roll call, out-passes, gate, visitors. */
export class HstModule implements ModuleDefinition {
  readonly name = 'hst';

  register(container: AwilixContainer, mc: ModuleContext): void {
    const scoped = { lifetime: Lifetime.SCOPED };
    container.register({
      hstRepo: asClass(DrizzleHstRepository, scoped),
      createRoom: asClass(CreateRoom, scoped),
      addBeds: asClass(AddBeds, scoped),
      getOccupancy: asClass(GetOccupancy, scoped),
      allocateBed: asClass(AllocateBed, scoped),
      transferBed: asClass(TransferBed, scoped),
      vacateBed: asClass(VacateBed, scoped),
      listResidents: asClass(ListResidents, scoped),
      getRollCall: asClass(GetRollCall, scoped),
      markRollCall: asClass(MarkRollCall, scoped),
      requestOutpass: asClass(RequestOutpass, scoped),
      decideOutpass: asClass(DecideOutpass, scoped),
      cancelOutpass: asClass(CancelOutpass, scoped),
      checkOutAtGate: asClass(CheckOutAtGate, scoped),
      checkInAtGate: asClass(CheckInAtGate, scoped),
      listOutpasses: asClass(ListOutpasses, scoped),
      alertOverdueOutpasses: asClass(AlertOverdueOutpasses, scoped),
      logVisitorIn: asClass(LogVisitorIn, scoped),
      logVisitorOut: asClass(LogVisitorOut, scoped),
      listVisitors: asClass(ListVisitors, scoped),
      getStudentHostel: asClass(GetStudentHostel, scoped),
      // mess
      messRepo: asClass(DrizzleMessRepository, scoped),
      getMessMenu: asClass(GetMessMenu, scoped),
      setMessMenu: asClass(SetMessMenu, scoped),
      setResidentDiet: asClass(SetResidentDiet, scoped),
      getMealHeadcount: asClass(GetMealHeadcount, scoped),
      recordMealService: asClass(RecordMealService, scoped),
      optOutOfMeals: asClass(OptOutOfMeals, scoped),
      cancelMealOptOut: asClass(CancelMealOptOut, scoped),
      getStudentMeals: asClass(GetStudentMeals, scoped),
      messMonthReport: asClass(MessMonthReport, scoped),
    });
    mc.jobs.add({ queue: HST_QUEUE, name: 'overdue-outpasses', handler: OverdueOutpassJob as never });
    mc.jobs.schedules.push({
      id: 'hst-overdue-outpasses',
      queue: HST_QUEUE,
      name: 'overdue-outpasses',
      everyMs: 10 * 60_000,
    });
  }

  controllers(): BaseController[] {
    return [new HstController(), new MessController()];
  }
}
