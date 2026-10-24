import type { Metadata } from "next";
import { NewApplication } from "@/components/admissions-public/application-pages";

export const metadata: Metadata = { title: "Online application" };

export default function ApplyPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Online application</h1>
        <p className="text-muted-foreground">অনলাইন ভর্তি আবেদন</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Five short steps. You can save and continue later — you will get a
          private link to come back to your application.
        </p>
      </div>
      <NewApplication />
    </div>
  );
}
