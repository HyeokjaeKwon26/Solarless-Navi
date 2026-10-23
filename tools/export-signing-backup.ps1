param(
    [Parameter(Mandatory = $true)][string]$Destination,
    [Security.SecureString]$BackupPassword,
    [string]$SigningDirectory = (Join-Path $env:LOCALAPPDATA 'SolarLessNavi/signing/release-20261023')
)
$ErrorActionPreference = 'Stop'
$destinationFile = [IO.Path]::GetFullPath($Destination)
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\') + '\'
if ($destinationFile.StartsWith($repositoryRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Store signing backups outside the repository.' }
if (Test-Path -LiteralPath $destinationFile) { throw 'Destination already exists; refusing to overwrite.' }
if (!(Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($destinationFile)))) { throw 'Destination directory must exist.' }
if (!$BackupPassword) {
    $BackupPassword = Read-Host 'Choose a backup password (save it in your password manager)' -AsSecureString
    $confirmation = Read-Host 'Confirm the backup password' -AsSecureString
    if ([PSCredential]::new('backup', $BackupPassword).GetNetworkCredential().Password -cne
        [PSCredential]::new('backup', $confirmation).GetNetworkCredential().Password) { throw 'Passwords do not match.' }
}
if ($BackupPassword.Length -lt 16) { throw 'Use a backup password of at least 16 characters.' }
$credential = Import-Clixml -LiteralPath (Join-Path $SigningDirectory 'release-credential.xml')
$keytool = Join-Path $env:LOCALAPPDATA 'SolarLessNavi/tools/jdk-17.0.20.1+1/bin/keytool.exe'
try {
    $env:SOLARLESS_SOURCE_PASSWORD = $credential.GetNetworkCredential().Password
    $env:SOLARLESS_BACKUP_PASSWORD = [PSCredential]::new('backup', $BackupPassword).GetNetworkCredential().Password
    & $keytool -importkeystore -srckeystore (Join-Path $SigningDirectory 'solarless-release.keystore') -srcstoretype PKCS12 -srcalias $credential.UserName -srcstorepass:env SOLARLESS_SOURCE_PASSWORD -srckeypass:env SOLARLESS_SOURCE_PASSWORD -destkeystore $destinationFile -deststoretype PKCS12 -destalias $credential.UserName -deststorepass:env SOLARLESS_BACKUP_PASSWORD -destkeypass:env SOLARLESS_BACKUP_PASSWORD -noprompt
    if ($LASTEXITCODE -ne 0) { throw 'Backup export failed.' }
    Write-Output "Encrypted portable signing backup saved: $destinationFile"
    Write-Output 'Keep this file and its password in separate safe locations. Do not publish either.'
} finally {
    Remove-Item Env:SOLARLESS_SOURCE_PASSWORD,Env:SOLARLESS_BACKUP_PASSWORD -ErrorAction SilentlyContinue
    $credential = $null
}
