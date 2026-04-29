import { MonitoringDashboard } from "@/components/monitoring-dashboard";
import { buildMonitoringSnapshot } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
  const snapshot = await buildMonitoringSnapshot();

  return <MonitoringDashboard snapshot={snapshot} />;
}
