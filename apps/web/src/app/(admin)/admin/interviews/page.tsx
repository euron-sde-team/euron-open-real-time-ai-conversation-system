import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminInterviews } from "@/components/admin/pages/interviews";

export const metadata: Metadata = { title: "Interviews" };

export default function Page() {
  return (
    <Suspense>
      <AdminInterviews />
    </Suspense>
  );
}
