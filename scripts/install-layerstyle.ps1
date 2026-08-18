# Install ComfyUI_LayerStyle (+ Advance) into this project's ComfyUI custom_nodes.
# Modular / reversible: only clones packs and pip-installs into ComfyUI\.venv.
# Does not change MultiGPU settings, extra_model_paths, or Studio source.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File "Z:\codex app\scripts\install-layerstyle.ps1"
# Optional:
#   -SkipAdvance   install core LayerStyle only
#   -SkipPip       clone only (deps already installed)

param(
    [switch]$SkipAdvance,
    [switch]$SkipPip
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$comfyRoot = Join-Path $projectRoot "ComfyUI"
$nodesRoot = Join-Path $comfyRoot "custom_nodes"
$python = Join-Path $comfyRoot ".venv\Scripts\python.exe"

function Test-LocalPort([int]$Port) {
    return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

if (-not (Test-Path $nodesRoot)) {
    throw "ComfyUI custom_nodes not found: $nodesRoot"
}
if (-not (Test-Path $python)) {
    throw "ComfyUI venv python not found: $python"
}

# Freeze / DLL-lock guard: pip against a live Comfy venv often locks onnxruntime and hangs Windows.
if (-not $SkipPip -and (Test-LocalPort 8188)) {
    throw "ComfyUI is listening on 8188. Stop it first (scripts\restart-comfy.ps1 kill path, or close Comfy), then re-run this installer. Pip while Comfy is live can freeze on locked DLLs."
}

function Install-NodePack {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$RepoUrl
    )

    $dest = Join-Path $nodesRoot $Name
    $gitDir = Join-Path $dest ".git"

    if (Test-Path $gitDir) {
        Write-Host "Updating $Name ..."
        git -C $dest pull --ff-only
    }
    elseif (Test-Path $dest) {
        Write-Host "Folder exists without .git - skipping clone for $Name ($dest)"
    }
    else {
        Write-Host "Cloning $Name ..."
        git clone --depth 1 $RepoUrl $dest
    }

    if (-not $SkipPip) {
        $req = Join-Path $dest "requirements.txt"
        if (Test-Path $req) {
            Write-Host "Installing requirements for $Name ..."
            & $python -s -m pip install -r $req
            if ($LASTEXITCODE -ne 0) {
                throw "pip failed for $Name (exit $LASTEXITCODE)"
            }
        }
    }

    return $dest
}

$core = Install-NodePack -Name "ComfyUI_LayerStyle" -RepoUrl "https://github.com/chflame163/ComfyUI_LayerStyle.git"

if (-not $SkipAdvance) {
    [void](Install-NodePack -Name "ComfyUI_LayerStyle_Advance" -RepoUrl "https://github.com/chflame163/ComfyUI_LayerStyle_Advance.git")
}

if (-not $SkipPip) {
    $repairList = Join-Path $core "repair_dependency_list.txt"
    if (Test-Path $repairList) {
        Write-Host "Ensuring opencv-contrib-python for GuidedFilter ..."
        & $python -s -m pip uninstall -y opencv-python opencv-python-headless 2>$null
        & $python -s -m pip install --force-reinstall opencv-contrib-python
    }
}

Write-Host ""
Write-Host "LayerStyle install finished."
Write-Host "Next: restart ComfyUI (scripts\restart-comfy.ps1), then check Studio diagnostics for capability transparent-asset."
Write-Host "Studio toggle stays OFF by default - existing gens are unchanged until you enable Transparent PNG asset."
Write-Host "First transparent gen may download RMBG weights into ComfyUI\models."
