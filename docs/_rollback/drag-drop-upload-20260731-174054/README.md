# Rollback snapshot 20260731-174054

Pre-implementation copies of files that will be modified for drag-drop library upload.

## Restore (PowerShell)

```powershell
Set-Location "Z:\codex app"
$src = "docs\_rollback\drag-drop-upload-20260731-174054"
Copy-Item "$src\index.ts" "server\src\index.ts" -Force
Copy-Item "$src\main.tsx" "app\src\main.tsx" -Force
Copy-Item "$src\styles.css" "app\src\styles.css" -Force
# Remove additive files only if present:
Remove-Item "server\src\library-upload.ts","server\src\library-upload.test.ts","app\src\LibraryUpload.tsx" -ErrorAction SilentlyContinue
npm test
npm run build
```

Also delete any files only created under `data\library-upload-staging` (staging temps). Never delete user models in `lora/`, root `.safetensors`, or `checkpoints/` unless you intentionally uploaded them during testing.
