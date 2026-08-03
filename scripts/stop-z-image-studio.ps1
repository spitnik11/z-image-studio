$ports = 3199, 8188
foreach ($port in $ports) {
    Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
        ForEach-Object {
            $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.OwningProcess)"
            $isStudio = $port -eq 3199 -and
                $process.Name -eq "node.exe" -and
                $process.CommandLine -like "*server/dist/index.js*"
            $isComfy = $port -eq 8188 -and
                $process.Name -match "^python(w)?\.exe$" -and
                ($process.ExecutablePath -like "Z:\codex app\ComfyUI\*" -or $process.CommandLine -like "*main.py*--port*8188*")
            if ($isStudio -or $isComfy) {
                Stop-Process -Id $_.OwningProcess
            }
        }
}
