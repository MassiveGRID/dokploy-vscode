import * as vscode from "vscode";
import { DokployClient } from "../api/client";

/**
 * Starts a background poller that watches for a deployment to complete and
 * shows a VS Code notification with the result. Fire-and-forget — does not
 * block the caller.
 */
export function watchDeployment(
  client: DokployClient,
  serviceId: string,
  serviceType: "application" | "compose",
  serviceName: string,
  refreshTree: () => void
): void {
  (async () => {
    // Brief delay so the deployment record exists before first poll
    await new Promise<void>((r) => setTimeout(r, 2500));

    const statusMsg = vscode.window.setStatusBarMessage(
      `$(loading~spin) Deploying ${serviceName}...`
    );

    let watchedId: string | undefined;
    let lastRawStatus = "";
    let polls = 0;
    const maxPolls = 120; // 10 minutes at 5-second intervals

    const interval = setInterval(async () => {
      if (++polls > maxPolls) {
        clearInterval(interval);
        statusMsg.dispose();
        return;
      }

      try {
        const deployments =
          serviceType === "application"
            ? await client.getDeployments(serviceId)
            : await client.getDeploymentsByCompose(serviceId);

        if (!deployments?.length) return;

        const latest = deployments[0];

        // Always watch the most recent deployment
        if (latest.deploymentId !== watchedId) {
          watchedId = latest.deploymentId;
          lastRawStatus = "";
        }

        if (latest.status === lastRawStatus) return;
        lastRawStatus = latest.status;

        if (latest.status === "done") {
          clearInterval(interval);
          statusMsg.dispose();
          vscode.window
            .showInformationMessage(
              `$(check) ${serviceName} deployed successfully!`,
              "View Logs"
            )
            .then((action) => {
              if (action === "View Logs") {
                vscode.commands.executeCommand("dokploy.viewLogs");
              }
            });
          refreshTree();
        } else if (latest.status === "error") {
          clearInterval(interval);
          statusMsg.dispose();
          vscode.window
            .showErrorMessage(
              `$(error) ${serviceName} deployment failed!`,
              "View Logs"
            )
            .then((action) => {
              if (action === "View Logs") {
                vscode.commands.executeCommand("dokploy.viewLogs");
              }
            });
          refreshTree();
        }
      } catch {
        // Silently ignore transient polling errors
      }
    }, 5000);
  })();
}
