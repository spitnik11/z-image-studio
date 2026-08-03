$ErrorActionPreference = "Stop"
$projectRoot = "Z:\codex app"
$comfyRoot = Join-Path $projectRoot "ComfyUI"
$logRoot = Join-Path $projectRoot "logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Test-LocalPort([int]$Port) {
    return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

if (-not (Test-LocalPort 8188)) {
    $comfyPython = Join-Path $comfyRoot ".venv\Scripts\python.exe"
    $comfyArgs = @(
        "main.py",
        "--listen", "127.0.0.1",
        "--port", "8188",
        "--disable-auto-launch",
        "--fast", "fp16_accumulation",
        "--extra-model-paths-config", "extra_model_paths.yaml"
    )
    Start-Process -FilePath $comfyPython -ArgumentList $comfyArgs -WorkingDirectory $comfyRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logRoot "comfyui.log") `
        -RedirectStandardError (Join-Path $logRoot "comfyui-error.log")
}

if (-not (Test-LocalPort 3199)) {
    Start-Process -FilePath "node.exe" -ArgumentList "server/dist/index.js" -WorkingDirectory $projectRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logRoot "studio.log") `
        -RedirectStandardError (Join-Path $logRoot "studio-error.log")
}

$deadline = (Get-Date).AddMinutes(2)
while ((Get-Date) -lt $deadline) {
    if ((Test-LocalPort 8188) -and (Test-LocalPort 3199)) {
        Start-Process "http://127.0.0.1:3199"
        exit 0
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
