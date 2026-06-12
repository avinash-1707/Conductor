import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";

export default function SignupPage() {
  // useSearchParams (inside AuthCard) requires a Suspense boundary.
  return (
    <Suspense>
      <AuthCard initialMode="signup" />
    </Suspense>
  );
}
