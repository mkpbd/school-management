import type { PermissionCode } from '../../../shared/application/RequestContext.js';

/**
 * Upload policy per purpose (docs/backend/cross-cutting.md §13): allowed types, size limit, who may upload/read,
 * and the data classification stored in sys.stored_file.
 */
export interface FilePolicy {
  mimeTypes: string[];
  maxBytes: number;
  /** null = any signed-in user (e.g. guardians attaching a leave certificate) */
  uploadPermission: PermissionCode | null;
  /** besides the uploader, users with this permission may download */
  readPermission: PermissionCode | null;
  classification: 'public' | 'internal' | 'confidential' | 'restricted';
}

const MB = 1024 * 1024;
const DOCS = ['application/pdf', 'image/jpeg', 'image/png'];
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];

export const FILE_POLICIES: Record<string, FilePolicy> = {
  student_document: {
    mimeTypes: DOCS,
    maxBytes: 10 * MB,
    uploadPermission: 'sis.document.create',
    readPermission: 'sis.document.view',
    classification: 'confidential',
  },
  student_photo: {
    mimeTypes: IMAGES,
    maxBytes: 5 * MB,
    uploadPermission: 'sis.student.edit',
    readPermission: 'sis.student.view',
    classification: 'internal',
  },
  application_document: {
    mimeTypes: DOCS,
    maxBytes: 10 * MB,
    uploadPermission: null,
    readPermission: 'adm.application.view',
    classification: 'confidential',
  },
  leave_attachment: {
    mimeTypes: DOCS,
    maxBytes: 5 * MB,
    uploadPermission: null,
    readPermission: 'att.student_leave.approve',
    classification: 'confidential',
  },
  homework_submission: {
    mimeTypes: [...DOCS, 'image/webp'],
    maxBytes: 20 * MB,
    uploadPermission: null,
    readPermission: 'lrn.homework.view',
    classification: 'internal',
  },
  notice_attachment: {
    mimeTypes: DOCS,
    maxBytes: 10 * MB,
    uploadPermission: 'com.notice.create',
    readPermission: null,
    classification: 'internal',
  },
  import: {
    mimeTypes: ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    maxBytes: 20 * MB,
    uploadPermission: 'core.import.create',
    readPermission: 'core.import.view',
    classification: 'confidential',
  },
  library_cover: {
    mimeTypes: IMAGES,
    maxBytes: 2 * MB,
    uploadPermission: 'lib.catalogue.edit',
    readPermission: null,
    classification: 'public',
  },
  library_digital: {
    mimeTypes: [...DOCS, 'application/epub+zip', 'video/mp4', 'audio/mpeg'],
    maxBytes: 200 * MB,
    uploadPermission: 'lib.digital.create',
    readPermission: 'lib.digital.view',
    classification: 'internal',
  },
  cpd_certificate: {
    mimeTypes: DOCS,
    maxBytes: 10 * MB,
    uploadPermission: null,
    readPermission: 'hrm.cpd.view',
    classification: 'internal',
  },
  staff_document: {
    mimeTypes: DOCS,
    maxBytes: 10 * MB,
    uploadPermission: 'hrm.staff.edit',
    readPermission: 'hrm.staff.view',
    classification: 'restricted',
  },
};
