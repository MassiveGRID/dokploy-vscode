import * as vscode from "vscode";
import { ServerManager } from "../api/serverManager";
import { DatabaseTreeItem } from "../views/projectsTree";

export function registerDatabaseCommands(
  context: vscode.ExtensionContext,
  serverManager: ServerManager,
  refreshTree: () => void
) {
  // ── Copy Connection String ────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.copyDbConnectionString",
      async (item?: DatabaseTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof DatabaseTreeItem)) return;

        const statusMsg = vscode.window.setStatusBarMessage(
          "$(loading~spin) Fetching database info..."
        );

        try {
          const db = await client.getDatabase(item.dbType, item.dbId);
          statusMsg.dispose();

          const connStr = buildConnectionString(item.dbType, db);

          if (!connStr) {
            vscode.window.showWarningMessage(
              `Could not build a connection string for ${item.dbType}.`
            );
            return;
          }

          await vscode.env.clipboard.writeText(connStr);
          vscode.window.showInformationMessage(
            `Connection string for ${item.label} copied to clipboard!`
          );
        } catch (err: any) {
          statusMsg.dispose();
          vscode.window.showErrorMessage(
            `Failed to get database info: ${err.message}`
          );
        }
      }
    )
  );

  // ── Start Database ────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.startDatabase",
      async (item?: DatabaseTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof DatabaseTreeItem)) return;

        try {
          await client.startDatabase(item.dbType, item.dbId);
          vscode.window.showInformationMessage(
            `${item.label} started!`
          );
          refreshTree();
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Failed to start database: ${err.message}`
          );
        }
      }
    )
  );

  // ── Stop Database ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.stopDatabase",
      async (item?: DatabaseTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof DatabaseTreeItem)) return;

        const confirm = await vscode.window.showWarningMessage(
          `Stop ${item.label}?`,
          "Stop"
        );
        if (confirm !== "Stop") return;

        try {
          await client.stopDatabase(item.dbType, item.dbId);
          vscode.window.showInformationMessage(`${item.label} stopped.`);
          refreshTree();
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Failed to stop database: ${err.message}`
          );
        }
      }
    )
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function buildConnectionString(dbType: string, db: any): string | undefined {
  const host = db.internalHost || db.externalHost || "localhost";
  const port = db.externalPort;
  const user = db.databaseUser || db.username || "";
  const pass = db.databasePassword || db.password || "";
  const name = db.databaseName || db.name || "";
  const enc = encodeURIComponent;

  switch (dbType) {
    case "postgres":
      return `postgresql://${enc(user)}:${enc(pass)}@${host}:${port || 5432}/${name}`;
    case "mysql":
    case "mariadb":
      return `mysql://${enc(user)}:${enc(pass)}@${host}:${port || 3306}/${name}`;
    case "mongo":
      return `mongodb://${enc(user)}:${enc(pass)}@${host}:${port || 27017}/${name}`;
    case "redis":
      return pass
        ? `redis://:${enc(pass)}@${host}:${port || 6379}`
        : `redis://${host}:${port || 6379}`;
    default:
      return undefined;
  }
}
