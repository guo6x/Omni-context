param(
    [Parameter(Mandatory = $true)]
    [string]$MsiPath,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedExePath,
    [Parameter(Mandatory = $true)]
    [string]$EvidencePath,
    [Parameter(Mandatory = $true)]
    [string]$InstallerLogPath
)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:GITHUB_WORKSPACE -or -not $env:RUNNER_TEMP) {
    throw 'MSI installation is restricted to a disposable GitHub-hosted runner.'
}

function Test-ChildPath([string]$Parent, [string]$Target) {
    $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    $targetFull = [System.IO.Path]::GetFullPath($Target)
    return $targetFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-FileSha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Convert-DisplayIconToPath([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    $trimmed = $Value.Trim()
    if ($trimmed -match '^"(?<path>[^"]+)"(?:,\d+)?$') { return $Matches.path }
    return ($trimmed -replace ',\d+$', '').Trim('"')
}

function Get-MsiProperty($Database, [string]$Name) {
    $query = 'SELECT `Value` FROM `Property` WHERE `Property` = ''' + $Name + ''''
    $view = $Database.OpenView($query)
    $view.Execute()
    $record = $view.Fetch()
    $view.Close()
    if (-not $record) { throw "The MSI is missing required property $Name." }
    return ([string]$record.StringData(1)).Trim()
}

$workspaceRoot = [System.IO.Path]::GetFullPath($env:GITHUB_WORKSPACE)
$runnerTemp = [System.IO.Path]::GetFullPath($env:RUNNER_TEMP)
$MsiPath = [System.IO.Path]::GetFullPath($MsiPath)
$ExpectedExePath = [System.IO.Path]::GetFullPath($ExpectedExePath)
$EvidencePath = [System.IO.Path]::GetFullPath($EvidencePath)
$InstallerLogPath = [System.IO.Path]::GetFullPath($InstallerLogPath)

if (-not (Test-ChildPath $workspaceRoot $MsiPath) -or [System.IO.Path]::GetExtension($MsiPath) -ne '.msi') {
    throw 'The MSI must be a .msi file produced inside the checked-out workspace.'
}
if (-not (Test-ChildPath $workspaceRoot $ExpectedExePath) -or [System.IO.Path]::GetFileName($ExpectedExePath) -ne 'Omni-Context.exe') {
    throw 'The expected executable must be the Omni-Context build output inside the checked-out workspace.'
}
if (-not (Test-ChildPath $runnerTemp $EvidencePath) -or -not (Test-ChildPath $runnerTemp $InstallerLogPath)) {
    throw 'Registry evidence and installer logs must remain below the disposable RUNNER_TEMP directory.'
}
if (-not (Test-Path -LiteralPath $MsiPath -PathType Leaf) -or -not (Test-Path -LiteralPath $ExpectedExePath -PathType Leaf)) {
    throw 'The MSI or expected build executable does not exist.'
}
if (Test-Path -LiteralPath $EvidencePath) { throw 'Refusing to overwrite existing MSI evidence.' }
if (Test-Path -LiteralPath $InstallerLogPath) { throw 'Refusing to overwrite an existing MSI installer log.' }

$msiHash = Get-FileSha256 $MsiPath
$buildExeHash = Get-FileSha256 $ExpectedExePath
$windowsInstaller = New-Object -ComObject WindowsInstaller.Installer
$msiDatabase = $windowsInstaller.OpenDatabase($MsiPath, 0)
$msiProductName = Get-MsiProperty $msiDatabase 'ProductName'
$msiProductVersion = Get-MsiProperty $msiDatabase 'ProductVersion'
$msiProductCode = Get-MsiProperty $msiDatabase 'ProductCode'
if ($msiProductName -ne 'Omni-Context' -or $msiProductCode -notmatch '^\{[0-9A-Fa-f-]{36}\}$') {
    throw "The exact MSI does not identify the expected Omni-Context Windows Installer product (ProductName='$msiProductName', ProductCode='$msiProductCode')."
}
$msiexec = Join-Path $env:WINDIR 'System32\msiexec.exe'
$arguments = '/i "' + $MsiPath + '" /qn /norestart /l*v "' + $InstallerLogPath + '"'
$installProcess = Start-Process -FilePath $msiexec -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
if ($installProcess.ExitCode -ne 0) {
    throw "MSI installation returned exit code $($installProcess.ExitCode); no reboot or automatic retry will be attempted."
}

$uninstallRoots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
)
$deadline = [DateTime]::UtcNow.AddSeconds(30)
$registryMatches = @()
while ([DateTime]::UtcNow -lt $deadline) {
    $registryMatches = @(
        foreach ($root in $uninstallRoots) {
            if (-not (Test-Path -LiteralPath $root)) { continue }
            foreach ($subKey in (Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
                $item = Get-ItemProperty -LiteralPath $subKey.PSPath -ErrorAction SilentlyContinue
                if (($item.DisplayName -like 'Omni-Context*') -and
                    ($item.WindowsInstaller -eq 1) -and
                    ($subKey.PSChildName -ieq $msiProductCode)) {
                    [pscustomobject]@{
                        root = $root
                        key = $subKey.PSChildName
                        item = $item
                    }
                }
            }
        }
    )
    if ($registryMatches.Count -gt 0) { break }
    Start-Sleep -Milliseconds 250
}
if ($registryMatches.Count -ne 1) {
    throw "Expected exactly one Windows Installer uninstall record for Omni-Context; found $($registryMatches.Count)."
}

$entry = $registryMatches[0]
if ($entry.root -notlike 'HKLM:*' -or $entry.key -notmatch '^\{[0-9A-Fa-f-]{36}\}$') {
    throw 'The installed product is not represented by a machine-scoped Windows Installer product code.'
}
if ($entry.key -ine $msiProductCode) {
    throw 'The installed registry product code does not match the exact MSI ProductCode.'
}
$iconPath = Convert-DisplayIconToPath ([string]$entry.item.DisplayIcon)
$iconPath = if ($iconPath) { [System.IO.Path]::GetFullPath($iconPath) } else { $null }
$installDir = if (-not [string]::IsNullOrWhiteSpace([string]$entry.item.InstallLocation)) {
    [System.IO.Path]::GetFullPath(([string]$entry.item.InstallLocation).Trim('"'))
} elseif ($iconPath -and [System.IO.Path]::GetExtension($iconPath) -ieq '.exe') {
    [System.IO.Path]::GetDirectoryName($iconPath)
} else {
    throw 'The MSI registry record does not identify an install directory or executable icon path.'
}
$installedExe = [System.IO.Path]::GetFullPath((Join-Path $installDir 'Omni-Context.exe'))
$programFilesRoots = @(
    [Environment]::GetEnvironmentVariable('ProgramFiles'),
    [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
if (-not ($programFilesRoots | Where-Object { Test-ChildPath $_ $installDir })) {
    throw 'The MSI did not install into a machine Program Files directory.'
}
if ($iconPath -and [System.IO.Path]::GetExtension($iconPath) -ieq '.exe' -and $iconPath -ne $installedExe) {
    throw 'Windows Installer DisplayIcon and InstallLocation do not identify the same Omni-Context executable.'
}
if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
    throw 'The Windows Installer registry path does not contain Omni-Context.exe.'
}

$installedExeHash = Get-FileSha256 $installedExe
if ($installedExeHash -ne $buildExeHash) {
    throw 'The installed executable bytes do not match the executable produced by this CI build.'
}

$registryPath = ($entry.root -replace '^HKLM:', 'HKLM') + '\' + $entry.key
$evidence = [ordered]@{
    evidence_kind = 'UNSIGNED_PR_MSI_INSTALLED_WINDOWS_FIXTURE_ACCEPTANCE'
    source_commit = $env:GITHUB_SHA
    pull_request_head_sha = $env:OMNI_E2E_PR_HEAD_SHA
    scope = 'disposable_github_hosted_windows_runner'
    installer_signature = 'unsigned_ci_candidate_not_release'
    msi_name = [System.IO.Path]::GetFileName($MsiPath)
    msi_sha256 = $msiHash
    msi_product_name = $msiProductName
    msi_product_version = $msiProductVersion
    product_code = $msiProductCode
    display_name = [string]$entry.item.DisplayName
    display_version = [string]$entry.item.DisplayVersion
    registry_key = $registryPath
    install_dir = $installDir
    installed_exe = $installedExe
    build_exe_sha256 = $buildExeHash
    installed_exe_sha256 = $installedExeHash
    installed_from_windows_installer = $true
    registry_product_code_matches_msi = $true
    installed_exe_matches_build_exe = $true
    msiexec_exit_code = $installProcess.ExitCode
    verified_at_utc = [DateTime]::UtcNow.ToString('o')
}
$json = $evidence | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($EvidencePath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Output 'PASS MSI installed from exact build output; registry product, Program Files path and executable SHA-256 match.'
