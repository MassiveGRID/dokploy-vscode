import * as vscode from "vscode";
import { ServerManager } from "./api/serverManager";
import { ServersTreeProvider } from "./views/serversTree";
import { ProjectsTreeProvider } from "./views/projectsTree";
import { DashboardPanel } from "./views/dashboard";
import { AppDetailPanel } from "./views/appDetail";
import { ComposeDetailPanel } from "./views/composeDetail";
import { registerDeployCommands } from "./commands/deploy";
import { registerProjectCommands } from "./commands/projects";
import { registerEnvAndDomainCommands } from "./commands/envAndDomains";
import { registerLogCommands } from "./commands/logs";
import { registerPushDeployCommands } from "./commands/pushDeploy";
import { registerComposeCommands } from "./commands/compose";
import { registerTemplateCommands } from "./commands/templates";
import { registerDatabaseCommands } from "./commands/database";

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  console.log("Dokploy extension activating...");

  // ── Server Manager ──────────────────────────────────────────────
  const serverManager = new ServerManager(context);
  context.subscriptions.push({
    dispose: () => serverManager.dispose(),
  });

  // ── Tree Views ──────────────────────────────────────────────────
  const serversTree = new ServersTreeProvider(serverManager);
  const projectsTree = new ProjectsTreeProvider(serverManager);

  vscode.window.registerTreeDataProvider("dokploy.servers", serversTree);
  vscode.window.registerTreeDataProvider("dokploy.projects", projectsTree);

  const refreshTree = () => {
    serversTree.refresh();
    projectsTree.refresh();
  };

  // ── Server Commands ─────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("dokploy.addServer", async () => {
      await serverManager.addServer();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.removeServer",
      async (item: any) => {
        if (item?.server?.name) {
          await serverManager.removeServer(item.server.name);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.setActiveServer",
      (name: string) => {
        serverManager.setActiveServer(name);
        vscode.window.showInformationMessage(
          `Active server: ${name}`
        );
        updateStatusBar(serverManager);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dokploy.refreshProjects", () => {
      refreshTree();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.openDashboard",
      (item: any) => {
        // If called from server tree item, open external dashboard
        if (item?.server) {
          const dashboardUrl = item.server.url.replace(/\/api\/?$/, "");
          vscode.env.openExternal(vscode.Uri.parse(dashboardUrl));
          return;
        }
        // Otherwise open the built-in webview dashboard
        DashboardPanel.show(context, serverManager);
      }
    )
  );

  // ── App Detail Panel ────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.openAppDetail",
      (item: any) => {
        const app = item?.application;
        if (!app) return;
        AppDetailPanel.show(context, serverManager, app.applicationId, app.name);
      }
    )
  );

  // ── Compose Detail Panel ─────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.openComposeDetail",
      (item: any) => {
        const compose = item?.compose;
        if (!compose) return;
        ComposeDetailPanel.show(context, serverManager, compose.composeId, compose.name);
      }
    )
  );

  // ── Register All Command Groups ─────────────────────────────────
  registerDeployCommands(context, serverManager, refreshTree);
  registerProjectCommands(context, serverManager, refreshTree);
  registerEnvAndDomainCommands(context, serverManager, refreshTree);
  registerLogCommands(context, serverManager);
  registerPushDeployCommands(context, serverManager, refreshTree);
  registerComposeCommands(context, serverManager, refreshTree);
  registerTemplateCommands(context, serverManager, refreshTree);
  registerDatabaseCommands(context, serverManager, refreshTree);

  // ── Status Bar ──────────────────────────────────────────────────
  const showStatusBar = vscode.workspace
    .getConfiguration("dokploy")
    .get<boolean>("showStatusBar", true);

  if (showStatusBar) {
    statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    statusBarItem.command = "dokploy.quickDeploy";
    context.subscriptions.push(statusBarItem);
    updateStatusBar(serverManager);
    statusBarItem.show();

    serverManager.onDidChangeServers(() => {
      updateStatusBar(serverManager);
    });
  }

  console.log("Dokploy extension activated!");
}

function updateStatusBar(serverManager: ServerManager): void {
  if (!statusBarItem) return;
  const active = serverManager.getActiveServer();
  if (active) {
    statusBarItem.text = `$(cloud-upload) Dokploy: ${active.name}`;
    statusBarItem.tooltip = `Deploy to ${active.name} (${active.url}).\nClick to quick deploy.`;
  } else {
    statusBarItem.text = "$(cloud-upload) Dokploy";
    statusBarItem.tooltip = "Click to set up Dokploy";
  }
}

export function deactivate() {
  // cleanup handled by disposables
}
