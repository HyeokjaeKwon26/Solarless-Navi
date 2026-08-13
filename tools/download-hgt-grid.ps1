param(
    [string]$OutputDir,
    [int]$South,
    [int]$North,
    [int]$West,
    [int]$East,
    [ValidateSet('N', 'S')]
    [string]$LatitudeHemisphere = 'N',
    [ValidateSet('W', 'E')]
    [string]$LongitudeHemisphere = 'W'
)

$ErrorActionPreference = 'Stop'
Write-Host "bounds south=$South north=$North west=$West east=$East latitudeHemisphere=$LatitudeHemisphere longitudeHemisphere=$LongitudeHemisphere"
New-Item -ItemType Directory -Force $OutputDir | Out-Null
for ($lat = $South; $lat -le $North; $lat++) {
    Write-Host "latitude $lat"
    # PowerShell variable names are case-insensitive, so do not reuse the
    # $West parameter name for the inner-loop cursor.
    for ($longitude = $West; $longitude -le $East; $longitude++) {
        $name = '{0}{1:D2}{2}{3:D3}' -f $LatitudeHemisphere, $lat, $LongitudeHemisphere, $longitude
        $target = Join-Path $OutputDir "$name.hgt.gz"
        if (Test-Path -LiteralPath $target) { continue }
        $latitudeBand = '{0}{1:D2}' -f $LatitudeHemisphere, $lat
        $url = "https://s3.amazonaws.com/elevation-tiles-prod/skadi/$latitudeBand/$name.hgt.gz"
        Write-Host "downloading $name"
        curl.exe -L --fail --retry 2 --silent --show-error --output $target $url
        if ($LASTEXITCODE -ne 0) {
            Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
            Write-Warning "missing $name"
        }
    }
}
Get-ChildItem -LiteralPath $OutputDir -File | Measure-Object Length -Sum
