import { renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { BrowserWindow } from "electron";

function atomicWrite(target: string, data: string | Buffer): void {
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, target);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/** Writes the report as a standalone HTML file or renders it to an A4 PDF through a hidden window. */
export async function exportReport(html: string, targetPath: string, format: "html" | "pdf"): Promise<void> {
  const target = path.resolve(targetPath);
  if (format === "html") {
    atomicWrite(target, html);
    return;
  }
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: "A4" });
    atomicWrite(target, pdf);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
