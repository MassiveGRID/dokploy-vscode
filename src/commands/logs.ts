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

  // ── View Live Logs ────────────────────────────────────────────────
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

          channel.appendLine(`── Live Status (polling every 5s — use Ctrl+F to search) ──`);
          channel.appendLine(``);

          let lastRawStatus = "";
          let lastDeploymentCount = deployments?.length || 0;

          const poller = setInterval(async () => {
            try {
              const newDeployments =
                serviceType === "application"
                  ? await client.getDeployments(serviceId)
                  : await client.getDeploymentsByCompose(serviceId);

              if (!newDeployments?.length) return;

              const latest = newDeployments[0];

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

              // Log status changes (fixed: track raw status separately)
              if (latest.status !== lastRawStatus) {
                const now = new Date().toLocaleTimeString();
                channel!.appendLine(
                  `  [${now}] Status: ${getStatusIcon(latest.status)} ${latest.status}`
                );

                // Notify on terminal states (but not on the very first poll)
                if (lastRawStatus !== "") {
                  if (latest.status === "done") {
                    vscode.window.showInformationMessage(
                      `${serviceName} deployment completed!`,
                      "View Full Log"
                    ).then((action) => {
                      if (action === "View Full Log") {
                        vscode.commands.executeCommand("dokploy.viewDeploymentLog", item);
                      }
                    });
                  } else if (latest.status === "error") {
                    vscode.window.showErrorMessage(
                      `${serviceName} deployment failed!`,
                      "View Full Log"
                    ).then((action) => {
                      if (action === "View Full Log") {
                        vscode.commands.executeCommand("dokploy.viewDeploymentLog", item);
                      }
                    });
                  }
                }

                lastRawStatus = latest.status;
              }
            } catch {
              // Silently ignore polling errors
            }
          }, 5000);

          activePollers.set(serviceId, poller);

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

  // ── View Full Deployment Log ──────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.viewDeploymentLog",
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
          // Pick service, then deployment
          const projects = await client.getProjects();
          const services: { label: string; id: string; type: "application" | "compose" }[] = [];
          for (const p of projects) {
            try {
              const full = await client.getProject(p.projectId);
              const environments = (full as any).environments || [];
              for (const env of environments) {
                for (const app of env.applications || []) {
                  services.push({ label: app.name, id: app.applicationId, type: "application" });
                }
                for (const comp of env.compose || []) {
                  services.push({ label: comp.name, id: comp.composeId, type: "compose" });
                }
              }
            } catch {}
          }
          if (services.length === 0) {
            vscode.window.showInformationMessage("No services found.");
            return;
          }
          const pickedService = await vscode.window.showQuickPick(services, {
            placeHolder: "Select service",
          });
          if (!pickedService) return;
          serviceId = pickedService.id;
          serviceName = pickedService.label;
          serviceType = pickedService.type;
        }

        // Fetch deployment list
        let deployments;
        try {
          deployments =
            serviceType === "application"
              ? await client.getDeployments(serviceId)
              : await client.getDeploymentsByCompose(serviceId);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to fetch deployments: ${err.message}`);
          return;
        }

        if (!deployments?.length) {
          vscode.window.showInformationMessage(`No deployments found for ${serviceName}.`);
          return;
        }

        const deploymentItems = deployments.slice(0, 20).map((d) => ({
          label: `${getStatusIcon(d.status)} ${d.title || "Deployment"}`,
          description: `${d.status} — ${new Date(d.createdAt).toLocaleString()}`,
          deploymentId: d.deploymentId,
        }));

        const picked = await vscode.window.showQuickPick(deploymentItems, {
          placeHolder: `Select deployment to view log for ${serviceName}`,
        });
        if (!picked) return;

        const statusMsg = vscode.window.setStatusBarMessage("$(loading~spin) Loading deployment log...");

        const logContent = await client.getDeploymentLog(picked.deploymentId);
        statusMsg.dispose();

        if (!logContent) {
          vscode.window.showInformationMessage("No log content available for this deployment.");
          return;
        }

        const doc = await vscode.workspace.openTextDocument({
          content: logContent,
          language: "log",
        });
        await vscode.window.showTextDocument(doc, { preview: true });
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
