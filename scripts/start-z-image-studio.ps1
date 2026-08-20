$ErrorActionPreference = "Stop"
$projectRoot = "Z:\codex app"
$comfyRoot = Join-Path $projectRoot "ComfyUI"
$logRoot = Join-Path $projectRoot "logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Test-LocalPort([int]$Port) {
    return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Write-LogBanner([string]$Path, [string]$Label) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $Path -Value "`n===== $Label start $stamp =====`n" -ErrorAction SilentlyContinue
}

# Soften MultiGPU CPU thrash on this single-GPU box (see ComfyUI-MultiGPU model_management_mgpu.py)
if (-not $env:MGPU_CPU_MEMORY_THRESHOLD_PERCENT) {
    $env:MGPU_CPU_MEMORY_THRESHOLD_PERCENT = "95"
}
$env:PYTHONUNBUFFERED = "1"

if (-not (Test-LocalPort 8188)) {
    $comfyPython = Join-Path $comfyRoot ".venv\Scripts\python.exe"
    if (-not (Test-Path $comfyPython)) {
        throw "ComfyUI venv python not found: $comfyPython"
    }
    $comfyOut = Join-Path $logRoot "comfyui.log"
    $comfyErr = Join-Path $logRoot "comfyui-error.log"
    Write-LogBanner $comfyOut "ComfyUI"
    Write-LogBanner $comfyErr "ComfyUI stderr"
    # --reserve-vram leaves headroom so large model swaps (Krea ~12GB staged on 12GB card)
    # are less likely to hard-kill the process after a gen or two.
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
}

if (-not (Test-LocalPort 3199)) {
    $studioOut = Join-Path $logRoot "studio.log"
    $studioErr = Join-Path $logRoot "studio-error.log"
    Write-LogBanner $studioOut "Studio"
    Write-LogBanner $studioErr "Studio stderr"
    Start-Process -FilePath "node.exe" -ArgumentList "server/dist/index.js" -WorkingDirectory $projectRoot -WindowStyle Hidden `
        -RedirectStandardOutput $studioOut `
        -RedirectStandardError $studioErr
}

$deadline = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $deadline) {
    if ((Test-LocalPort 8188) -and (Test-LocalPort 3199)) {
        # Health probe: Comfy must answer, not just bind the port
        try {
            Invoke-RestMethod "http://127.0.0.1:8188/system_stats" -TimeoutSec 5 | Out-Null
            Invoke-RestMethod "http://127.0.0.1:3199/api/diagnostics" -TimeoutSec 10 | Out-Null
            Start-Process "http://127.0.0.1:3199"
            exit 0
        } catch {
            # still booting
        }
    }
    Start-Sleep -Milliseconds 750
}

Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show(
    "Z-Image Studio did not finish starting. Check Z:\codex app\logs for details.",
    "Z-Image Studio",
    "OK",
    "Error"
) | Out-Null
exit 1
