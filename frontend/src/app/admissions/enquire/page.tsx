import type { Metadata } from "next";
import { EnquiryForm } from "@/components/admissions-public/enquiry-form";

export const metadata: Metadata = { title: "Admission enquiry" };

export default function EnquirePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admission enquiry</h1>
        <p className="text-muted-foreground">ভর্তি সংক্রান্ত জিজ্ঞাসা</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Tell us about your child and we will get in touch. It takes about a
          minute.
        </p>
      </div>
      <EnquiryForm />
    </div>
  );
}
