import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type CpuSnapshot = { idle: number; total: number };
let previousCpu = cpuSnapshot();

function cpuSnapshot(): CpuSnapshot {
  return os.cpus().reduce((result, cpu) => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    return { idle: result.idle + cpu.times.idle, total: result.total + total };
  }, { idle: 0, total: 0 });
}

function cpuPercent() {
  const current = cpuSnapshot();
  const idle = current.idle - previousCpu.idle;
  const total = current.total - previousCpu.total;
  previousCpu = current;
  return total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100))) : null;
}

function durationSeconds(value?: string) {
  if (!value) return null;
  const parts = value.trim().split(":").map(Number);
  if (!parts.length || parts.some(part => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function parseTrainingProgress(text: string, configuredSteps?: number) {
  const cleaned = text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  const matches = [...cleaned.matchAll(/(\d+)\s*\/\s*(\d+)\s*\[([^\]]+)\]/g)];
  const latest = matches.at(-1);
  if (!latest) return null;
  const detail = latest[3];
  const timing = detail.match(/^\s*([^<,]+)(?:<([^,]+))?/);
  const seconds = detail.match(/([\d.]+)\s*s\/it/);
  const currentStep = Number(latest[1]);
  const totalSteps = Number(configuredSteps) || Number(latest[2]);
  return {
    currentStep,
    totalSteps,
    elapsedSeconds: durationSeconds(timing?.[1]),
    etaSeconds: durationSeconds(timing?.[2]),
    secondsPerIteration: seconds ? Number(seconds[1]) : null,
    percent: totalSteps > 0 ? Math.min(100, Math.round((currentStep / totalSteps) * 100)) : 0
  };
}

function readLogTail(jobDirectory: string, maxBytes = 64 * 1024) {
  const logFile = path.join(jobDirectory, "training.log");
  if (!fs.existsSync(logFile)) return "";
  const size = fs.statSync(logFile).size;
  const length = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(length);
  const handle = fs.openSync(logFile, "r");
  try { fs.readSync(handle, buffer, 0, length, Math.max(0, size - length)); }
  finally { fs.closeSync(handle); }
  return buffer.toString("utf8");
}

async function gpuTelemetry() {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
      "--format=csv,noheader,nounits"
    ], { windowsHide: true, timeout: 3000 });
    const values = stdout.trim().split(/\s*,\s*/).map(Number);
    if (values.length < 5 || values.some(value => !Number.isFinite(value))) return null;
    return {
      utilizationPercent: values[0],
      memoryUsedMb: values[1],
      memoryTotalMb: values[2],
      temperatureC: values[3],
      powerWatts: values[4]
    };
  } catch {
    return null;
  }
}

export async function trainingTelemetry(record: Record<string, any>) {
  const progress = record.jobDirectory
    ? parseTrainingProgress(readLogTail(String(record.jobDirectory)), Number(record.steps))
    : null;
  return {
    sampledAt: new Date().toISOString(),
    cpuPercent: cpuPercent(),
    gpu: await gpuTelemetry(),
    progress,
    elapsedSeconds: progress?.elapsedSeconds ?? Math.max(0, Math.round((Date.now() - Number(record.started || Date.now())) / 1000)),
    etaSeconds: progress?.etaSeconds ?? null,
    secondsPerIteration: progress?.secondsPerIteration ?? null
  };
}
