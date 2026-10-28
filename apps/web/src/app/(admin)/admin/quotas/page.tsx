import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminQuotas } from "@/components/admin/pages/quotas";

export const metadata: Metadata = { title: "Quotas" };

export default function Page() {
  return (
    <Suspense>
      <AdminQuotas />
    </Suspense>
  );
}
