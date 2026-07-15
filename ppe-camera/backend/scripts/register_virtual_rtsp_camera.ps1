param(
    [string]$ApiBase = "http://127.0.0.1:8004",
    [string]$CameraId = "virtual-cam1",
    [string]$RtspUrl = "rtsp://127.0.0.1:8554/cam1",
    [string[]]$RequiredPpe = @("helmet", "vest")
)

$ErrorActionPreference = "Stop"

$payload = @{
    camera_id = $CameraId
    source_kind = "rtsp"
    source_kwargs = @{
        url = $RtspUrl
    }
    required_ppe = $RequiredPpe
    fps_limit = 6.0
    restricted_zones = @()
    hazards_enabled = $true
} | ConvertTo-Json -Depth 6

try {
    Invoke-RestMethod `
        -Method Post `
        -Uri "$ApiBase/api/cameras" `
        -ContentType "application/json" `
        -Body $payload | Out-Null
    Write-Host "Registered camera $CameraId"
}
catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 409) {
        throw
    }
    Write-Host "Camera $CameraId already exists; continuing."
}

$started = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/cameras/$CameraId/start"
Write-Host "Camera started:"
$started | ConvertTo-Json -Depth 6
