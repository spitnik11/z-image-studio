# Rollback: LayerStyle transparent asset

Restore Studio source files (does not remove ComfyUI custom_nodes installs):

```powershell
$src = 'Z:\codex app\docs\_rollback\layerstyle-transparent-20260818-025330'
Copy-Item "$src\workflow.ts" 'Z:\codex app\server\src\workflow.ts' -Force
Copy-Item "$src\index.ts" 'Z:\codex app\server\src\index.ts' -Force
Copy-Item "$src\diagnostics.ts" 'Z:\codex app\server\src\diagnostics.ts' -Force
Copy-Item "$src\main.tsx" 'Z:\codex app\app\src\main.tsx' -Force
Copy-Item "$src\styles.css" 'Z:\codex app\app\src\styles.css' -Force
# Also delete new files if present:
#   server\src\layerstyle-postprocess.ts
#   server\src\layerstyle-postprocess.test.ts
#   scripts\install-layerstyle.ps1
npm run build
```

To uninstall Comfy packs (optional):
Remove-Item -Recurse -Force 'Z:\codex app\ComfyUI\custom_nodes\ComfyUI_LayerStyle'
Remove-Item -Recurse -Force 'Z:\codex app\ComfyUI\custom_nodes\ComfyUI_LayerStyle_Advance'
