import { Workflow } from "lucide-react";
import { EmptyState } from "@/components/app/view-state";

export default function WorkflowsPage() {
  return (
    <EmptyState
      icon={Workflow}
      message="The Workflow Library is on its way. Curated pipeline templates will live here."
    />
  );
}
