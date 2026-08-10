param(
    [string]$OutputDir,
    [int]$South,
    [int]$North,
    [int]$West,
    [int]$East
)

$ErrorActionPreference = 'Stop'
Write-Host "bounds south=$South north=$North west=$West east=$East"
New-Item -ItemType Directory -Force $OutputDir | Out-Null
for ($lat = $South; $lat -le $North; $lat++) {
    Write-Host "latitude $lat"
    # PowerShell variable names are case-insensitive, so do not reuse the
    # $West parameter name for the inner-loop cursor.
    for ($longitude = $West; $longitude -le $East; $longitude++) {
        $name = 'N{0:D2}W{1:D3}' -f $lat, $longitude
        $target = Join-Path $OutputDir "$name.hgt.gz"
        if (Test-Path -LiteralPath $target) { continue }
        $url = "https://s3.amazonaws.com/elevation-tiles-prod/skadi/N$('{0:D2}' -f $lat)/$name.hgt.gz"
        Write-Host "downloading $name"
        curl.exe -L --fail --retry 2 --silent --show-error --output $target $url
        if ($LASTEXITCODE -ne 0) {
            Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
            Write-Warning "missing $name"
        }
    }
}
Get-ChildItem -LiteralPath $OutputDir -File | Measure-Object Length -Sum
