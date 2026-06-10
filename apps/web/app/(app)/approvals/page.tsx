import { CheckSquare } from "lucide-react";
import { EmptyState } from "@/components/app/view-state";

export default function ApprovalsPage() {
  return (
    <EmptyState
      icon={CheckSquare}
      message="Nothing is waiting on you. Approvals from your runs will appear here."
    />
  );
}
