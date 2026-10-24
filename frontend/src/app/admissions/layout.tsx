import { GraduationCapIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: { default: "Admissions", template: "%s · Admissions" },
  description: "Admission enquiry and online application",
};

/** Public admissions pages (no login): enquiry, online application, continue a saved application. */
export default function AdmissionsLayout({
  children,
}: LayoutProps<"/admissions">) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Link
            href="/admissions"
            className="flex items-center gap-2 font-semibold"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <GraduationCapIcon className="size-4" />
            </span>
            <span className="leading-tight">
              Admissions
              <span className="block text-xs font-normal text-muted-foreground">
                ভর্তি
              </span>
            </span>
          </Link>
          <nav
            aria-label="Admissions"
            className="ml-auto flex items-center gap-1 text-sm"
          >
            <Link
              href="/admissions/enquire"
              className="rounded-md px-2.5 py-1.5 hover:bg-muted"
            >
              Enquire
            </Link>
            <Link
              href="/admissions/apply"
              className="rounded-md px-2.5 py-1.5 hover:bg-muted"
            >
              Apply
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-10">
        {children}
      </main>
      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            Your details are used only to process your admission enquiry or
            application. / আপনার তথ্য শুধু ভর্তি প্রক্রিয়ার জন্য ব্যবহৃত হবে।
          </p>
          <Link href="/login" className="shrink-0 underline-offset-4 hover:underline">
            Staff sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
