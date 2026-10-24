import { aca } from "./services/aca";
import { acc } from "./services/acc";
import { adm } from "./services/adm";
import { att } from "./services/att";
import { auth } from "./services/auth";
import { cca } from "./services/cca";
import { com } from "./services/com";
import { core } from "./services/core";
import { fee } from "./services/fee";
import { hrm } from "./services/hrm";
import { hst } from "./services/hst";
import { iam } from "./services/iam";
import { inv } from "./services/inv";
import { lib } from "./services/lib";
import { sis } from "./services/sis";
import { files, system } from "./services/system";
import { trn } from "./services/trn";

/**
 * Every backend endpoint, grouped by module. Request bodies and query params are typed from the OpenAPI
 * contract (`npm run api:sync` regenerates src/lib/api/schema.d.ts after backend changes).
 *
 *   const { data, meta } = await api.sis.students.search({ q: "rahim", limit: 20 });
 */
export const api = {
  auth,
  system,
  files,
  core,
  hrm,
  aca,
  sis,
  att,
  fee,
  lib,
  trn,
  inv,
  acc,
  hst,
  com,
  iam,
  cca,
  adm,
};

export {
  client,
  deliverFile,
  getActiveCampus,
  onSessionExpired,
  refreshSession,
  setActiveCampus,
} from "./client";
export type { DownloadedFile } from "./client";
export { isMfaChallenge } from "./services/auth";
export { ApiError, isApiError } from "./errors";
export type * from "./types";
