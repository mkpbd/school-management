import { createHash } from 'node:crypto';
import { asClass, asFunction, Lifetime, type AwilixContainer } from 'awilix';
import type { AppConfig } from '../../bootstrap/config.js';
import type { Clock } from '../../shared/domain/Clock.js';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleDefinition } from '../../shared/module.js';
import {
  AddEnquiryActivity,
  CreateCampaign,
  CreateEnquiry,
  GetAdmissionForm,
  GetAdmissionFunnel,
  GetApplication,
  GetDraftApplication,
  GetEnquiry,
  ListApplications,
  ListCampaigns,
  ListEnquiries,
  MarkApplicationSpam,
  MarkEnquirySpam,
  SetApplicationStatus,
  StartApplication,
  SubmitEnquiry,
  UpdateCampaign,
  UpdateDraftApplication,
  UpdateEnquiry,
} from './application/AdmissionUseCases.js';
import { DrizzleAdmRepository } from './infrastructure/DrizzleAdmRepository.js';
import { HmacFormTokens, NoCaptcha, TurnstileCaptcha } from './infrastructure/webFormSecurity.js';
import { AdmissionController } from './presentation/AdmissionController.js';

/** Key of the public form tokens: FORM_TOKEN_SECRET, else derived from the blind-index key (dev: a fixed key). */
function formTokenKey(config: AppConfig): Buffer {
  const base = config.FORM_TOKEN_SECRET ?? config.BLIND_INDEX_KEY ?? 'school-dev-form-token';
  return createHash('sha256').update(`adm-form-token:${base}`).digest();
}

/** ADM: website enquiry / application forms (spam protection, campaign tracking), enquiry pipeline, applications. */
export class AdmModule implements ModuleDefinition {
  readonly name = 'adm';

  register(container: AwilixContainer): void {
    const scoped = { lifetime: Lifetime.SCOPED };
    container.register({
      admRepo: asClass(DrizzleAdmRepository, scoped),
      formTokens: asFunction(
        ({ config, clock }: { config: AppConfig; clock: Clock }) => new HmacFormTokens(formTokenKey(config), clock),
        { lifetime: Lifetime.SINGLETON },
      ),
      captcha: asFunction(
        ({ config }: { config: AppConfig }) =>
          config.TURNSTILE_SITE_KEY && config.TURNSTILE_SECRET
            ? new TurnstileCaptcha(config.TURNSTILE_SITE_KEY, config.TURNSTILE_SECRET)
            : new NoCaptcha(),
        { lifetime: Lifetime.SINGLETON },
      ),
      getAdmissionForm: asClass(GetAdmissionForm, scoped),
      submitEnquiry: asClass(SubmitEnquiry, scoped),
      startApplication: asClass(StartApplication, scoped),
      getDraftApplication: asClass(GetDraftApplication, scoped),
      updateDraftApplication: asClass(UpdateDraftApplication, scoped),
      listEnquiries: asClass(ListEnquiries, scoped),
      getEnquiry: asClass(GetEnquiry, scoped),
      createEnquiry: asClass(CreateEnquiry, scoped),
      updateEnquiry: asClass(UpdateEnquiry, scoped),
      addEnquiryActivity: asClass(AddEnquiryActivity, scoped),
      markEnquirySpam: asClass(MarkEnquirySpam, scoped),
      listApplications: asClass(ListApplications, scoped),
      getApplication: asClass(GetApplication, scoped),
      setApplicationStatus: asClass(SetApplicationStatus, scoped),
      markApplicationSpam: asClass(MarkApplicationSpam, scoped),
      listCampaigns: asClass(ListCampaigns, scoped),
      createCampaign: asClass(CreateCampaign, scoped),
      updateCampaign: asClass(UpdateCampaign, scoped),
      getAdmissionFunnel: asClass(GetAdmissionFunnel, scoped),
    });
  }

  controllers(): BaseController[] {
    return [new AdmissionController()];
  }
}
