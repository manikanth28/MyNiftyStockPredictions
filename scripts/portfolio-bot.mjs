import { spawn } from "node:child_process";

const DEFAULT_BOT_URL = "http://localhost:3000/api/portfolio-bot";
const botUrl = process.env.PORTFOLIO_BOT_URL || DEFAULT_BOT_URL;
const intervalSeconds = parsePositiveInteger(process.env.PORTFOLIO_BOT_INTERVAL_SECONDS, 60);
const args = new Set(process.argv.slice(2));
const loop = args.has("--loop");
const reportOnly = args.has("--report");

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeStructuredLog(level, event, message, fields = {}) {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    message,
    ...fields
  });

  if (level === "error") {
    console.error(payload);
    return;
  }

  if (level === "warn") {
    console.warn(payload);
    return;
  }

  console.log(payload);
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function postBot(action = "tick") {
  writeStructuredLog("info", "portfolio_bot.request.started", "Posting portfolio bot action.", {
    action,
    botUrl
  });

  const response = await fetch(botUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      action
    })
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Portfolio bot failed with HTTP ${response.status}.`);
  }

  writeStructuredLog("info", "portfolio_bot.request.completed", "Portfolio bot action completed.", {
    action,
    actions: Array.isArray(payload.actions) ? payload.actions.length : 0,
    reportWritten: payload.reportWritten === true,
    openPositions: payload.wallet?.openPositions?.length ?? null
  });

  if (payload.reportWritten) {
    notifyReport(payload.report?.reportDate ?? "today");
  }

  return payload;
}

function notifyReport(reportDate) {
  const title = "Stock bot report created";
  const message = `Daily trading report for ${reportDate} was written.`;
  const safeTitle = title.replaceAll("'", "''");
  const safeMessage = message.replaceAll("'", "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms;
Add-Type -AssemblyName System.Drawing;
$notification = New-Object System.Windows.Forms.NotifyIcon;
$notification.Icon = [System.Drawing.SystemIcons]::Information;
$notification.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info;
$notification.BalloonTipTitle = '${safeTitle}';
$notification.BalloonTipText = '${safeMessage}';
$notification.Visible = $true;
$notification.ShowBalloonTip(7000);
Start-Sleep -Seconds 8;
$notification.Dispose();
`;

  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
    stdio: "ignore"
  });

  child.on("error", (error) => {
    writeStructuredLog("warn", "portfolio_bot.notification.failed", "Windows notification failed.", {
      error: error instanceof Error ? error.message : String(error)
    });
  });
}

function marketClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    weekday: read("weekday").toLowerCase(),
    date: `${read("year")}-${read("month")}-${read("day")}`,
    minute: (Number.parseInt(read("hour"), 10) || 0) * 60 + (Number.parseInt(read("minute"), 10) || 0)
  };
}

function shouldWriteDailyReport(lastReportDate) {
  const parts = marketClockParts();
  const isWeekend = parts.weekday.startsWith("sat") || parts.weekday.startsWith("sun");
  const reportMinute = 15 * 60 + 35;

  return !isWeekend && parts.minute >= reportMinute && lastReportDate !== parts.date;
}

async function runOnce() {
  if (reportOnly) {
    return postBot("report");
  }

  return postBot("tick");
}

async function main() {
  if (!loop) {
    await runOnce();
    return;
  }

  let lastReportDate = null;

  while (true) {
    try {
      const action = shouldWriteDailyReport(lastReportDate) ? "report" : "tick";
      const payload = await postBot(action);

      if (action === "report" && payload.report?.reportDate) {
        lastReportDate = payload.report.reportDate;
      }
    } catch (error) {
      writeStructuredLog("error", "portfolio_bot.loop.failed", "Portfolio bot loop failed.", {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    await sleep(intervalSeconds * 1000);
  }
}

main().catch((error) => {
  writeStructuredLog("error", "portfolio_bot.failed", "Portfolio bot process failed.", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
