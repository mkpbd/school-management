import { asClass, Lifetime, type AwilixContainer } from 'awilix';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleContext, ModuleDefinition } from '../../shared/module.js';
import {
  AssignRole,
  CheckAccess,
  CreateRole,
  DeleteRole,
  GetRole,
  GetUserAccess,
  ListPermissions,
  ListRoles,
  ListUsers,
  RevokeAssignment,
  RoleMatrix,
  SetRolePermissions,
  SetUserStatus,
  UpdateRole,
} from './application/AccessControlUseCases.js';
import { GetMe } from './application/GetMe.js';
import { LoginWithPassword } from './application/LoginWithPassword.js';
import { RequestOtp, VerifyOtp } from './application/OtpLogin.js';
import { Logout, RefreshSession } from './application/RefreshSession.js';
import { SessionIssuer } from './application/SessionIssuer.js';
import { VerifyMfa } from './application/VerifyMfa.js';
import { DrizzleAccessRepository } from './infrastructure/DrizzleAccessRepository.js';
import { DrizzleIamRepository } from './infrastructure/DrizzleIamRepository.js';
import { IamIdentityProvider } from './infrastructure/IamIdentityProvider.js';
import { IamModuleApiImpl } from './infrastructure/IamModuleApiImpl.js';
import { OtplibTotpVerifier } from './infrastructure/OtplibTotpVerifier.js';
import { AccessController } from './presentation/AccessController.js';
import { AuthController } from './presentation/AuthController.js';
import { MeController } from './presentation/MeController.js';

/** IAM: authentication, sessions, identity + grants (docs/backend/modules.md#iam). */
export class IamModule implements ModuleDefinition {
  readonly name = 'iam';
  private config!: ModuleContext['config'];

  register(container: AwilixContainer, mc: ModuleContext): void {
    this.config = mc.config;
    const scoped = { lifetime: Lifetime.SCOPED };
    container.register({
      identityProvider: asClass(IamIdentityProvider, { lifetime: Lifetime.SINGLETON }),
      totp: asClass(OtplibTotpVerifier, { lifetime: Lifetime.SINGLETON }),
      iamRepo: asClass(DrizzleIamRepository, scoped),
      iamApi: asClass(IamModuleApiImpl, scoped),
      sessionIssuer: asClass(SessionIssuer, scoped),
      loginWithPassword: asClass(LoginWithPassword, scoped),
      verifyMfa: asClass(VerifyMfa, scoped),
      requestOtp: asClass(RequestOtp, scoped),
      verifyOtp: asClass(VerifyOtp, scoped),
      refreshSession: asClass(RefreshSession, scoped),
      logout: asClass(Logout, scoped),
      getMe: asClass(GetMe, scoped),
      // access control administration
      accessRepo: asClass(DrizzleAccessRepository, scoped),
      listPermissions: asClass(ListPermissions, scoped),
      listRoles: asClass(ListRoles, scoped),
      roleMatrix: asClass(RoleMatrix, scoped),
      getRole: asClass(GetRole, scoped),
      createRole: asClass(CreateRole, scoped),
      updateRole: asClass(UpdateRole, scoped),
      setRolePermissions: asClass(SetRolePermissions, scoped),
      deleteRole: asClass(DeleteRole, scoped),
      listUsers: asClass(ListUsers, scoped),
      getUserAccess: asClass(GetUserAccess, scoped),
      checkAccess: asClass(CheckAccess, scoped),
      assignRoleToUser: asClass(AssignRole, scoped),
      revokeAssignment: asClass(RevokeAssignment, scoped),
      setUserStatus: asClass(SetUserStatus, scoped),
    });
  }

  controllers(): BaseController[] {
    return [new AuthController(this.config), new MeController(), new AccessController()];
  }
}
