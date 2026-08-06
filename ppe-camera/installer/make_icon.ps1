<#
    Builds installer\branding\ppe.ico from the console's icon-192.png.

    Windows shortcuts and Add/Remove Programs need a real .ico; a PNG cannot be
    used for either. Without one the desktop shortcut inherits the default
    browser icon, which is what makes an installed product look like a
    bookmark.

    A multi-size icon is not decoration: Windows picks 16px for the taskbar and
    256px for large tiles, and an icon carrying only one size gets scaled by the
    shell into something visibly soft.
#>
[CmdletBinding()]
param(
    [string]$Source = "",
    [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

if (-not $Source) {
    $Source = Join-Path (Split-Path -Parent $PSScriptRoot) "..\Project-brain\public\icon-192.png"
    if (-not (Test-Path $Source)) {
        $Source = Join-Path $PSScriptRoot "build\payload\console\public\icon-192.png"
    }
}
if (-not (Test-Path $Source)) { throw "no source image at $Source" }

if (-not $OutFile) {
    $OutFile = Join-Path $PSScriptRoot "branding\ppe.ico"
}
# .NET's current directory is not PowerShell's location, so [IO.File]::Create
# on a relative path writes somewhere other than where the caller meant.
if (-not [System.IO.Path]::IsPathRooted($OutFile)) {
    $OutFile = Join-Path $PSScriptRoot $OutFile
}
$OutFile = [System.IO.Path]::GetFullPath($OutFile)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutFile) | Out-Null

# Vista and later accept PNG-compressed frames inside an .ico, which keeps the
# 256px frame from bloating the file to a megabyte of raw BGRA.
$sizes = @(16, 24, 32, 48, 64, 128, 256)

$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
$frames = @()
try {
    foreach ($s in $sizes) {
        $bmp = New-Object System.Drawing.Bitmap ($s, $s)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.DrawImage($src, 0, 0, $s, $s)
        } finally { $g.Dispose() }

        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $frames += , @{ Size = $s; Bytes = $ms.ToArray() }
        $ms.Dispose(); $bmp.Dispose()
    }
} finally { $src.Dispose() }

$fs = [System.IO.File]::Create($OutFile)
$bw = New-Object System.IO.BinaryWriter $fs
try {
    $bw.Write([UInt16]0)                 # reserved
    $bw.Write([UInt16]1)                 # type: icon
    $bw.Write([UInt16]$frames.Count)

    # Directory entries come first, so every image offset has to account for
    # the whole directory being written before any pixel data.
    $offset = 6 + (16 * $frames.Count)
    foreach ($f in $frames) {
        # 256 is stored as 0: the field is a single byte.
        $dim = if ($f.Size -ge 256) { 0 } else { $f.Size }
        $bw.Write([Byte]$dim)            # width
        $bw.Write([Byte]$dim)            # height
        $bw.Write([Byte]0)               # palette count
        $bw.Write([Byte]0)               # reserved
        $bw.Write([UInt16]1)             # colour planes
        $bw.Write([UInt16]32)            # bits per pixel
        $bw.Write([UInt32]$f.Bytes.Length)
        $bw.Write([UInt32]$offset)
        $offset += $f.Bytes.Length
    }
    foreach ($f in $frames) { $bw.Write($f.Bytes) }
} finally { $bw.Dispose(); $fs.Dispose() }

Write-Host ("-- wrote {0} ({1:N0} bytes, {2} sizes: {3})" -f `
    $OutFile, (Get-Item $OutFile).Length, $frames.Count, ($sizes -join ", "))
