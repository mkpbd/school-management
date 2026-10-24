import { asClass, Lifetime, type AwilixContainer } from 'awilix';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleContext, ModuleDefinition } from '../../shared/module.js';
import {
  OwnChildrenResolver,
  OwnClassesResolver,
  OwnSubjectsResolver,
  SectionResolver,
  SisScopes,
} from './application/SisScopes.js';
import {
  AddGuardian,
  AttachStudentDocument,
  EnrolStudent,
  GetSectionRoster,
  GetStudent,
  RegisterStudent,
  SearchStudents,
  TransferStudent,
  UpdateStudent,
  VerifyStudentDocument,
} from './application/StudentUseCases.js';
import { DrizzleSisRepository } from './infrastructure/DrizzleSisRepository.js';
import { SisModuleApiImpl } from './infrastructure/SisModuleApiImpl.js';
import { SisController } from './presentation/SisController.js';

/** SIS: students, families, guardians, enrolment history, documents + relational scope resolvers. */
export class SisModule implements ModuleDefinition {
  readonly name = 'sis';

  register(container: AwilixContainer, mc: ModuleContext): void {
    const scoped = { lifetime: Lifetime.SCOPED };
    container.register({
      sisRepo: asClass(DrizzleSisRepository, scoped),
      sisApi: asClass(SisModuleApiImpl, scoped),
      sisScopes: asClass(SisScopes, scoped),
      scopeOwnChildren: asClass(OwnChildrenResolver, scoped),
      scopeOwnClasses: asClass(OwnClassesResolver, scoped),
      scopeOwnSubjects: asClass(OwnSubjectsResolver, scoped),
      scopeSection: asClass(SectionResolver, scoped),
      registerStudent: asClass(RegisterStudent, scoped),
      enrolStudent: asClass(EnrolStudent, scoped),
      transferStudent: asClass(TransferStudent, scoped),
      updateStudent: asClass(UpdateStudent, scoped),
      getStudent: asClass(GetStudent, scoped),
      searchStudents: asClass(SearchStudents, scoped),
      attachStudentDocument: asClass(AttachStudentDocument, scoped),
      verifyStudentDocument: asClass(VerifyStudentDocument, scoped),
      addGuardian: asClass(AddGuardian, scoped),
      getSectionRoster: asClass(GetSectionRoster, scoped),
    });
    for (const name of ['scopeOwnChildren', 'scopeOwnClasses', 'scopeOwnSubjects', 'scopeSection'])
      mc.scopeResolvers.add(name);
  }

  controllers(): BaseController[] {
    return [new SisController()];
  }
}
