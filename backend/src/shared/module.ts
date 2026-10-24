import type { AwilixContainer } from 'awilix';
import type { AppConfig } from '../bootstrap/config.js';
import type { BaseController } from './http/BaseController.js';
import type { SubscriptionRegistry } from './infrastructure/events/EventSubscription.js';
import type { JobRegistry } from './infrastructure/queue/jobs.js';

/** Registration names of ScopeResolver implementations (see ScopePolicy). */
export class ScopeResolverRegistry {
  readonly names: string[] = [];
  add(registrationName: string): void {
    this.names.push(registrationName);
  }
}

export interface ModuleContext {
  config: AppConfig;
  jobs: JobRegistry;
  subscriptions: SubscriptionRegistry;
  scopeResolvers: ScopeResolverRegistry;
}

/**
 * Contract every module implements (docs/backend/README.md §4). A module registers its use cases, repositories
 * and adapters in DI, and contributes controllers, jobs, schedules, event subscriptions and scope resolvers.
 */
export interface ModuleDefinition {
  readonly name: string;
  register(container: AwilixContainer, mc: ModuleContext): void;
  controllers?(): BaseController[];
}
