import * as vscode from "vscode";
import { ServerManager } from "../api/serverManager";
import { ApplicationTreeItem, ComposeTreeItem } from "../views/projectsTree";

// Track active polling intervals so we can stop them
const activePollers = new Map<string, NodeJS.Timeout>();

export function registerLogCommands(
  context: vscode.ExtensionContext,
  serverManager: ServerManager
) {
  const outputChannels = new Map<string, vscode.OutputChannel>();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.viewLogs",
      async (item?: ApplicationTreeItem | ComposeTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client) {
          vscode.window.showErrorMessage("No Dokploy server configured.");
          return;
        }

        let serviceId: string;
        let serviceName: string;
        let serviceType: "application" | "compose";

        if (item instanceof ApplicationTreeItem) {
          serviceId = item.application.applicationId;
          serviceName = item.application.name;
          serviceType = "application";
        } else if (item instanceof ComposeTreeItem) {
          serviceId = item.compose.composeId;
          serviceName = item.compose.name;
          serviceType = "compose";
        } else {
          // Pick from list
          const projects = await client.getProjects();
          const services: { label: string; description: string; id: string; type: "application" | "compose" }[] = [];

          for (const p of projects) {
            try {
              const full = await client.getProject(p.projectId);
              const environments = (full as any).environments || [];
              for (const env of environments) {
                for (const app of env.applications || []) {
                  services.push({
                    label: app.name,
                    description: `${p.name} · application`,
                    id: app.applicationId,
                    type: "application",
                  });
                }
                for (const comp of env.compose || []) {
                  services.push({
                    label: comp.name,
                    description: `${p.name} · compose`,
                    id: comp.composeId,
                    type: "compose",
                  });
                }
              }
            } catch {}
          }

          if (services.length === 0) {
            vscode.window.showInformationMessage("No services found.");
            return;
          }

          const picked = await vscode.window.showQuickPick(services, {
            placeHolder: "Select service to view logs",
          });
          if (!picked) return;
          serviceId = picked.id;
          serviceName = picked.label;
          serviceType = picked.type;
        }

        const channelName = `Dokploy: ${serviceName}`;

        // Reuse or create output channel
        let channel = outputChannels.get(serviceId);
        if (!channel) {
          channel = vscode.window.createOutputChannel(channelName);
          outputChannels.set(serviceId, channel);
          context.subscriptions.push(channel);
        }

        channel.clear();
        channel.show(true);

        // Stop any existing poller for this service
        const existingPoller = activePollers.get(serviceId);
        if (existingPoller) {
          clearInterval(existingPoller);
          activePollers.delete(serviceId);
        }

        channel.appendLine(`╔══════════════════════════════════════════════╗`);
        channel.appendLine(`║  ${serviceName}`);
        channel.appendLine(`║  Type: ${serviceType}`);
        channel.appendLine(`╚══════════════════════════════════════════════╝`);
        channel.appendLine(``);

        // Fetch deployment history
        try {
          channel.appendLine(`── Deployment History ──────────────────────────`);
          channel.appendLine(``);

          const deployments =
            serviceType === "application"
              ? await client.getDeployments(serviceId)
              : await client.getDeploymentsByCompose(serviceId);

          if (!deployments || deployments.length === 0) {
            channel.appendLine(`  No deployments yet.`);
          } else {
            // Show last 10 deployments
            const recent = deployments.slice(0, 10);
            for (const dep of recent) {
              const date = new Date(dep.createdAt).toLocaleString();
              const statusIcon = getStatusIcon(dep.status);
              const title = dep.title || "Deployment";
              channel.appendLine(
                `  ${statusIcon} ${title} — ${dep.status} — ${date}`
              );
              if (dep.description) {
                channel.appendLine(`     ${dep.description}`);
              }
            }

            if (deployments.length > 10) {
              channel.appendLine(
                `  ... and ${deployments.length - 10} more`
              );
            }
          }

          channel.appendLine(``);

          // Show current application details
          if (serviceType === "application") {
            const app = await client.getApplication(serviceId);
            channel.appendLine(`── Application Info ────────────────────────────`);
            channel.appendLine(``);
            channel.appendLine(`  Name:       ${app.name}`);
            channel.appendLine(`  App Name:   ${app.appName}`);
            channel.appendLine(`  Status:     ${app.applicationStatus || "unknown"}`);
            channel.appendLine(`  Build Type: ${app.buildType || "nixpacks"}`);
            channel.appendLine(`  Source:     ${app.sourceType || "N/A"}`);
            if (app.repository) {
              channel.appendLine(`  Repository: ${app.repository}`);
            }
            if (app.branch) {
              channel.appendLine(`  Branch:     ${app.branch}`);
            }
            channel.appendLine(``);
          }

          // Start polling for live updates
          channel.appendLine(`── Live Status (polling every 5s) ──────────────`);
          channel.appendLine(``);

          let lastDeploymentCount = deployments?.length || 0;
          let lastStatus = "";

          const poller = setInterval(async () => {
            try {
              const newDeployments =
                serviceType === "application"
                  ? await client.getDeployments(serviceId)
                  : await client.getDeploymentsByCompose(serviceId);

              if (newDeployments && newDeployments.length > 0) {
                const latest = newDeployments[0];
                const statusLine = `${getStatusIcon(latest.status)} ${latest.status}`;

                // Log new deployments
                if (newDeployments.length > lastDeploymentCount) {
                  const newOnes = newDeployments.slice(
                    0,
                    newDeployments.length - lastDeploymentCount
                  );
                  for (const dep of newOnes.reverse()) {
                    const date = new Date(dep.createdAt).toLocaleString();
                    channel!.appendLine(
                      `  [NEW] ${getStatusIcon(dep.status)} ${dep.title || "Deployment"} — ${dep.status} — ${date}`
                    );
                  }
                  lastDeploymentCount = newDeployments.length;
                }

                // Log status changes
                if (statusLine !== lastStatus) {
                  const now = new Date().toLocaleTimeString();
                  channel!.appendLine(
                    `  [${now}] Status: ${statusLine}`
                  );
                  lastStatus = statusLine;

                  // If deployment is done or errored, show a notification
                  if (
                    latest.status === "done" &&
                    lastStatus.includes("running")
                  ) {
                    vscode.window.showInformationMessage(
                      `${serviceName} deployment completed!`
                    );
                  } else if (latest.status === "error") {
                    vscode.window.showErrorMessage(
                      `${serviceName} deployment failed!`
                    );
                  }
                }
              }
            } catch {
              // Silently ignore polling errors
            }
          }, 5000);

          activePollers.set(serviceId, poller);

          // Stop polling when the channel is disposed
          context.subscriptions.push({
            dispose: () => {
              clearInterval(poller);
              activePollers.delete(serviceId);
            },
          });
        } catch (err: any) {
          channel.appendLine(`Error fetching logs: ${err.message}`);
        }
      }
    )
  );
}

function getStatusIcon(status: string): string {
  switch (status?.toLowerCase()) {
    case "done":
      return "✅";
    case "running":
      return "🔄";
    case "error":
      return "❌";
    case "queued":
      return "⏳";
    case "idle":
      return "⚪";
    default:
      return "○";
  }
}
