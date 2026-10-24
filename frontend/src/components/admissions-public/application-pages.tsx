"use client";

import { useQuery } from "@tanstack/react-query";
import { LinkIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loading } from "@/components/page";
import { Button } from "@/components/ui/button";
import { api, isApiError } from "@/lib/api";
import {
  ApplicationWizard,
  draftValues,
  newApplication,
} from "./application-form";
import { ErrorBanner, formatLongDate, problemMessage, useFormSetup } from "./common";

/** /admissions/apply: a new application. */
export function NewApplication() {
  const setup = useFormSetup("application");
  if (setup.isError)
    return <ErrorBanner>{problemMessage(setup.error)}</ErrorBanner>;
  if (!setup.data) return <Loading label="Loading the form… / ফর্ম লোড হচ্ছে…" />;
  return (
    <ApplicationWizard
      setup={setup.data}
      tracking={setup.tracking}
      initial={newApplication(setup.data)}
    />
  );
}

/** /admissions/apply/<token>: continue a saved draft from its secret link. */
export function ResumeApplication() {
  const { token } = useParams<{ token: string }>();
  const valid = /^[\w-]{20,64}$/.test(token ?? "");
  const setup = useFormSetup("application", false);
  const draft = useQuery({
    queryKey: ["adm-public-draft", token],
    queryFn: () => api.adm.publicForm.draft(token).then((r) => r.data),
    enabled: valid,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!valid || (isApiError(draft.error) && draft.error.status === 404))
    return <LinkExpired />;
  const error = draft.error ?? setup.error;
  if (error) return <ErrorBanner>{problemMessage(error)}</ErrorBanner>;
  if (!draft.data || !setup.data)
    return <Loading label="Opening your application… / আবেদন খোলা হচ্ছে…" />;

  return (
    <div className="space-y-4">
      <div className="alert alert-info alert-soft text-sm">
        <LinkIcon className="size-4" />
        <span>
          You are continuing a saved application
          {draft.data.resumeExpiresAt
            ? ` (this link works until ${formatLongDate(draft.data.resumeExpiresAt)})`
            : ""}
          . Save again or submit when you are ready.
        </span>
      </div>
      <ApplicationWizard
        setup={setup.data}
        initial={draftValues(draft.data, setup.data)}
        resume={{ token, expiresAt: draft.data.resumeExpiresAt }}
      />
    </div>
  );
}

function LinkExpired() {
  return (
    <div className="space-y-4">
      <ErrorBanner>
        This application link is invalid or has expired, or the application
        has already been submitted. / লিংকটি সঠিক নয় বা মেয়াদ শেষ হয়ে গেছে।
      </ErrorBanner>
      <p className="text-sm text-muted-foreground">
        Saved links work for 30 days. If you already submitted, the admissions
        office has your application. Otherwise, please start a new one.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          render={<Link href="/admissions/apply" />}
          nativeButton={false}
          className="h-10"
        >
          Start a new application
        </Button>
        <Button
          render={<Link href="/admissions/enquire" />}
          nativeButton={false}
          variant="outline"
          className="h-10"
        >
          Contact admissions
        </Button>
      </div>
    </div>
  );
}
