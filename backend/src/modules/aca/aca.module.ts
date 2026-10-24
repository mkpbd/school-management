import { asClass, Lifetime, type AwilixContainer } from 'awilix';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleDefinition } from '../../shared/module.js';
import {
  AssignTeacher,
  EndTeacher,
  GenerateSectionTeachingGroups,
  GetTimetableView,
  ListGroupMembers,
  ListGroupTeachers,
  PublishTimetable,
  SaveTimetableSlots,
  SetGroupMembers,
  TeacherLoadReport,
} from './application/TeachingUseCases.js';
import { AcaModuleApiImpl } from './infrastructure/AcaModuleApiImpl.js';
import { DrizzleAcaRepository } from './infrastructure/DrizzleAcaRepository.js';
import { AcaController } from './presentation/AcaController.js';

/** ACA: programmes, sections, subjects, teaching groups, bell schedule, timetable. */
export class AcaModule implements ModuleDefinition {
  readonly name = 'aca';

  register(container: AwilixContainer): void {
    const scoped = { lifetime: Lifetime.SCOPED };
    container.register({
      acaApi: asClass(AcaModuleApiImpl, scoped),
      acaRepo: asClass(DrizzleAcaRepository, scoped),
      generateSectionTeachingGroups: asClass(GenerateSectionTeachingGroups, scoped),
      assignTeacher: asClass(AssignTeacher, scoped),
      endTeacher: asClass(EndTeacher, scoped),
      listGroupTeachers: asClass(ListGroupTeachers, scoped),
      setGroupMembers: asClass(SetGroupMembers, scoped),
      listGroupMembers: asClass(ListGroupMembers, scoped),
      saveTimetableSlots: asClass(SaveTimetableSlots, scoped),
      publishTimetable: asClass(PublishTimetable, scoped),
      getTimetableView: asClass(GetTimetableView, scoped),
      teacherLoadReport: asClass(TeacherLoadReport, scoped),
    });
  }

  controllers(): BaseController[] {
    return [new AcaController()];
  }
}
