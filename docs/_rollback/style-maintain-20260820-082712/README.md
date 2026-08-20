# Rollback Style Maintain
Copy-Item $dir\*.tsx,$dir\styles.css into app\src then rebuild app and restart Studio (3199 only).
Remove app\src\StyleMaintainPanel.tsx and server\src\style-maintain.ts if present.
