import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { BrowserWindow } from "electron";

const LOAD_TIMEOUT_MS = 30_000;

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

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Writes the report as a standalone HTML file or renders it to an A4 PDF through a hidden window. */
export async function exportReport(html: string, targetPath: string, format: "html" | "pdf"): Promise<void> {
  const target = path.resolve(targetPath);
  if (format === "html") {
    atomicWrite(target, html);
    return;
  }
  // Loaded from a temp file: a data: URL is capped (~2 MB) by Chromium and large reports would fail.
  const dir = mkdtempSync(path.join(os.tmpdir(), "skill-recorder-report-"));
  const htmlFile = path.join(dir, "report.html");
  let win: BrowserWindow | undefined;
  try {
    writeFileSync(htmlFile, html);
    win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    });
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const w = win;
    const pdf = await withTimeout(
      (async () => {
        await w.loadFile(htmlFile);
        return w.webContents.printToPDF({ printBackground: true, pageSize: "A4" });
      })(),
      LOAD_TIMEOUT_MS,
      "Tempo esgotado ao gerar o PDF do relatório (30 s).",
    );
    atomicWrite(target, pdf);
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
}
