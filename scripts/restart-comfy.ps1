# Restart only ComfyUI (keep Studio up). Safe after OOM / disconnects.
$ErrorActionPreference = "Stop"
$projectRoot = "Z:\codex app"
$comfyRoot = Join-Path $projectRoot "ComfyUI"
$logRoot = Join-Path $projectRoot "logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Test-LocalPort([int]$Port) {
    return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

# Kill Comfy listeners on 8188 and any main.py in the ComfyUI tree
Get-NetTCPConnection -State Listen -LocalPort 8188 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.CommandLine -and
        ($_.CommandLine -like "*ComfyUI*main.py*" -or $_.CommandLine -like "*\ComfyUI\main.py*")
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 2

if (-not $env:MGPU_CPU_MEMORY_THRESHOLD_PERCENT) { $env:MGPU_CPU_MEMORY_THRESHOLD_PERCENT = "95" }
$env:PYTHONUNBUFFERED = "1"

$comfyPython = Join-Path $comfyRoot ".venv\Scripts\python.exe"
$comfyOut = Join-Path $logRoot "comfyui.log"
$comfyErr = Join-Path $logRoot "comfyui-error.log"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content $comfyOut "`n===== ComfyUI restart $stamp =====`n"
Add-Content $comfyErr "`n===== ComfyUI restart stderr $stamp =====`n"

$comfyArgs = @(
    "main.py",
    "--listen", "127.0.0.1",
    "--port", "8188",
    "--disable-auto-launch",
    "--fast", "fp16_accumulation",
    "--reserve-vram", "0.8",
    "--extra-model-paths-config", "extra_model_paths.yaml"
)
Start-Process -FilePath $comfyPython -ArgumentList $comfyArgs -WorkingDirectory $comfyRoot -WindowStyle Hidden `
    -RedirectStandardOutput $comfyOut `
    -RedirectStandardError $comfyErr

$deadline = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $deadline) {
    if (Test-LocalPort 8188) {
        try {
            $stats = Invoke-RestMethod "http://127.0.0.1:8188/system_stats" -TimeoutSec 5
            Write-Host "ComfyUI healthy at http://127.0.0.1:8188 (comfy $($stats.system.comfyui_version))"
            exit 0
        } catch { }
    }
    Start-Sleep -Milliseconds 750
}
Write-Host "ComfyUI failed to become healthy. Check logs\comfyui-error.log"
exit 1
