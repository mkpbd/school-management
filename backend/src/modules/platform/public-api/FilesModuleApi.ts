export interface FileInfo {
  id: string;
  purpose: string;
  scanStatus: 'pending' | 'clean' | 'infected' | 'failed' | 'skipped';
  uploadedBy: string | null;
  mimeType: string;
  originalName: string | null;
}

/** Lets modules attach uploaded files (sys.stored_file) to their records after checking purpose and scan state. */
export interface FilesModuleApi {
  getFile(fileId: string): Promise<FileInfo | null>;
  /** Throws unless the file exists, has the purpose and passed the virus scan (or scanning is disabled). */
  requireUsable(fileId: string, purpose: string): Promise<FileInfo>;
  /**
   * Short-lived download link of a usable file. The caller has already decided the user may read it (e.g. a notice
   * recipient reading its attachment); the purpose guards against handing out unrelated files.
   */
  downloadUrl(fileId: string, purpose: string): Promise<{ url: string; expiresInSec: number; fileName: string | null }>;
}
