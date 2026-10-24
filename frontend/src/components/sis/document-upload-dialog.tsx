"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { RefSelect } from "@/components/crud/fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { lookups, retryWhileScanning, uploadFile } from "./shared";

const ACCEPT = "application/pdf,image/jpeg,image/png";
const MAX_BYTES = 10 * 1024 * 1024;

type Step = "idle" | "uploading" | "scanning" | "attaching";
const STEP_LABEL: Record<Step, string> = {
  idle: "",
  uploading: "Uploading…",
  scanning: "Waiting for the virus scan…",
  attaching: "Attaching…",
};

/** Upload (purpose student_document) -> scan -> attach to the student's vault. */
export function DocumentUploadDialog({
  studentId,
  open,
  onOpenChange,
  onDone,
}: {
  studentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  // keep the uploaded file id so a failed attach can be retried without uploading again
  const [fileId, setFileId] = useState<string | null>(null);

  function close() {
    setFile(null);
    setDocType("");
    setExpiresOn("");
    setFileId(null);
    setError(null);
    onOpenChange(false);
  }

  function onDialogChange(next: boolean) {
    if (next) onOpenChange(true);
    else if (step === "idle") close(); // do not close mid-upload
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file && !fileId) return;
    if (file && file.size > MAX_BYTES) {
      setError("File is larger than 10 MB.");
      return;
    }
    setError(null);
    try {
      let id = fileId;
      if (!id) {
        setStep("uploading");
        id = await uploadFile(file!, "student_document");
        setFileId(id);
      }
      setStep("scanning");
      await retryWhileScanning(async () => {
        setStep("attaching");
        try {
          return await api.sis.students.attachDocument(studentId, {
            docType,
            fileId: id!,
            ...(expiresOn ? { expiresOn } : {}),
          });
        } finally {
          setStep("scanning");
        }
      });
      toast.success("Document attached");
      setStep("idle");
      onDone();
      close();
    } catch (err) {
      setStep("idle");
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  const busy = step !== "idle";

  return (
    <Dialog open={open} onOpenChange={onDialogChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Upload document</DialogTitle>
            <DialogDescription>
              PDF, JPEG or PNG up to 10 MB. Files are virus-scanned before use.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div role="alert" className="alert alert-error alert-soft text-sm">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="doc-type">
              Document type<span className="text-destructive">*</span>
            </Label>
            <RefSelect
              id="doc-type"
              source={lookups.docTypes}
              value={docType}
              onChange={setDocType}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-file">
              File<span className="text-destructive">*</span>
            </Label>
            <input
              id="doc-file"
              type="file"
              accept={ACCEPT}
              required={!fileId}
              disabled={busy || Boolean(fileId)}
              className="file-input file-input-sm w-full"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {fileId && (
              <p className="text-xs text-muted-foreground">
                Uploaded; retry will only attach it.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-expires">Expires on</Label>
            <Input
              id="doc-expires"
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !docType}>
              {busy && <span className="loading loading-spinner loading-xs" />}
              {busy ? STEP_LABEL[step] : fileId ? "Retry attach" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
