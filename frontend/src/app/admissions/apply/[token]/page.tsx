import type { Metadata } from "next";
import { Suspense } from "react";
import { ResumeApplication } from "@/components/admissions-public/application-pages";
import { Loading } from "@/components/page";

/** The URL holds the secret resume token: keep it out of search engines and Referer headers. */
export const metadata: Metadata = {
  title: "Continue your application",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ResumeApplicationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Continue your application</h1>
        <p className="text-muted-foreground">আবেদন চালিয়ে যান</p>
      </div>
      <Suspense fallback={<Loading />}>
        <ResumeApplication />
      </Suspense>
    </div>
  );
}
