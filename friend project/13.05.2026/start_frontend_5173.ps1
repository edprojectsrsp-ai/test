$frontendDir = "D:\Python\Project Brain\project-brain-web\frontend"
$npm = "C:\Program Files\nodejs\npm.cmd"

Set-Location $frontendDir
& $npm run dev -- --port 5173
