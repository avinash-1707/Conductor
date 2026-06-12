import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";

export default function LoginPage() {
  // useSearchParams (inside AuthCard) requires a Suspense boundary.
  return (
    <Suspense>
      <AuthCard initialMode="login" />
    </Suspense>
  );
}
