param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('left-click', 'menu-show')]
    [string]$Action,
    [Parameter(Mandatory = $false)]
    [long]$MainWindowHandle = 0
)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') {
    throw 'Tray automation is restricted to a disposable GitHub-hosted runner.'
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OmniTrayInput {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
}
'@

$root = [System.Windows.Automation.AutomationElement]::RootElement
$nameProperty = [System.Windows.Automation.AutomationElement]::NameProperty
$processIdProperty = [System.Windows.Automation.AutomationElement]::ProcessIdProperty
$treeScope = [System.Windows.Automation.TreeScope]::Descendants
$trueCondition = [System.Windows.Automation.Condition]::TrueCondition
$explorerProcessIds = @(
    Get-Process -Name explorer -ErrorAction Stop |
        ForEach-Object { [int]$_.Id }
)
if ($explorerProcessIds.Count -eq 0) {
    throw 'The Windows shell explorer process is unavailable.'
}

function Find-NamedElements([string]$Name) {
    $condition = New-Object System.Windows.Automation.PropertyCondition($nameProperty, $Name)
    return $root.FindAll($treeScope, $condition)
}

function Find-ElementsMatchingName([string]$Pattern) {
    $found = New-Object System.Collections.Generic.List[object]
    foreach ($element in ($root.FindAll($treeScope, $trueCondition))) {
        try {
            if ([string]$element.Current.Name -match $Pattern) {
                $null = $found.Add($element)
            }
        }
        catch {
            continue
        }
    }
    return $found.ToArray()
}

function Test-MainWindowVisible {
    if ($MainWindowHandle -le 0) { return $false }
    return [OmniTrayInput]::IsWindowVisible([IntPtr]$MainWindowHandle)
}

function Click-Element($Element, [bool]$RightClick = $false) {
    $bounds = $Element.Current.BoundingRectangle
    if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) {
        throw 'The Windows accessibility element has no clickable screen bounds.'
    }
    $x = [int]($bounds.Left + ($bounds.Width / 2))
    $y = [int]($bounds.Top + ($bounds.Height / 2))
    if (-not [OmniTrayInput]::SetCursorPos($x, $y)) {
        throw 'Could not position the pointer on the Windows accessibility element.'
    }
    Start-Sleep -Milliseconds 100
    if ($RightClick) {
        [OmniTrayInput]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 60
        [OmniTrayInput]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
    }
    else {
        [OmniTrayInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 60
        [OmniTrayInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    }
}

function Find-TrayIcon {
    # Windows exposes classic notification-area icons differently across runner
    # images: the same icon may be reported as Button, Image, Custom, or
    # ListItem, and its tooltip can be decorated by the shell. Do not require
    # an Explorer ProcessId here: Windows 11 runner images can expose the
    # notification-area provider through a shell proxy process. Restrict the
    # name match to shell tray classes so an app window title cannot qualify.
    foreach ($element in ($root.FindAll($treeScope, $trueCondition))) {
        try {
            $current = $element.Current
            $name = [string]$current.Name
            $className = [string]$current.ClassName
            if ($name -match '(?i)omni[\s-]*context' -and
                $className -match '(?i)(SystemTray\.|NotifyIcon|TrayNotify|Shell_TrayWnd|ToolbarWindow32)' -and
                -not $current.BoundingRectangle.IsEmpty -and
                $current.BoundingRectangle.Width -gt 0 -and $current.BoundingRectangle.Height -gt 0) {
                return $element
            }
        }
        catch {
            continue
        }
    }
    return $null
}

function Find-VisibleTrayElements {
    # Some Windows runner images expose notification icons as SystemTray.*
    # elements without the tooltip name. Keep this fallback on UI Automation:
    # it still moves the real pointer over the shell icon and sends a real
    # left/right click, while the caller verifies this app's cached native
    # window handle changes visibility.
    $found = New-Object System.Collections.Generic.List[object]
    foreach ($element in (Find-ShellTrayElements)) {
        try {
            $name = [string]$element.Current.Name
            if ($name -notmatch '(?i)show hidden|\u663E\u793A\u9690\u85CF|more icons|\u66F4\u591A\u56FE\u6807') {
                $null = $found.Add($element)
            }
        }
        catch {
            continue
        }
    }
    return $found.ToArray()
}

function Find-ShellTrayElements {
    # Bounds are the only visibility gate. IsOffscreen is not reliable for
    # overflow icons on hosted Windows 11 shells, but a non-empty rectangle
    # still gives the real pointer a concrete target. Keep this list narrow to
    # notification-area providers and avoid using Explorer ProcessId as an
    # identity boundary.
    $found = New-Object System.Collections.Generic.List[object]
    foreach ($element in ($root.FindAll($treeScope, $trueCondition))) {
        try {
            $current = $element.Current
            $className = [string]$current.ClassName
            $automationId = [string]$current.AutomationId
            $isTrayClass = $className -match '(?i)^(SystemTray\.|NotifyIcon|TrayNotify)'
            $isTrayAutomationId = $automationId -match '(?i)(^|[._-])(?:SystemTrayIcon|NotifyIcon)(?:$|[._-])'
            if (-not ($isTrayClass -or $isTrayAutomationId)) { continue }
            $bounds = $current.BoundingRectangle
            if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) { continue }
            $null = $found.Add($element)
        }
        catch {
            continue
        }
    }
    return $found.ToArray()
}

function Find-OverflowToggle {
    $found = New-Object System.Collections.Generic.List[object]
    foreach ($element in (Find-ShellTrayElements)) {
        try {
            $current = $element.Current
            if ([string]$current.AutomationId -eq 'SystemTrayIcon') {
                $null = $found.Add($element)
            }
        }
        catch {
            continue
        }
    }
    return @($found.ToArray() | Sort-Object -Property @{ Expression = { $_.Current.BoundingRectangle.Left } })
}

function Open-HiddenIcons {
    $hiddenNamePatterns = @(
        '^Show hidden icons$',
        '^\u663E\u793A\u9690\u85CF\u56FE\u6807$',
        '^\u663E\u793A\u9690\u85CF\u7684\u56FE\u6807$',
        '^More icons$',
        '^\u66F4\u591A\u56FE\u6807$'
    )
    foreach ($hiddenNamePattern in $hiddenNamePatterns) {
        foreach ($hiddenButton in (Find-ElementsMatchingName $hiddenNamePattern)) {
            try {
                # Prefer a real pointer click so the same shell path as a user
                # opens the overflow popup. Invoke is only a fallback for a
                # runner image that exposes the button without screen bounds.
                try {
                    Click-Element $hiddenButton
                }
                catch {
                    $pattern = $hiddenButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                    $pattern.Invoke()
                }
                Start-Sleep -Milliseconds 800
                return $true
            }
            catch {
                continue
            }
        }
    }
    foreach ($overflowToggle in (Find-OverflowToggle)) {
        try {
            Click-Element $overflowToggle
            Start-Sleep -Milliseconds 1000
            if ((Find-VisibleTrayElements).Count -gt 0) { return $true }
        }
        catch {
            continue
        }
    }
    return $false
}

$menuNamePatterns = @(
    '^\u663E\u793A\u4E3B\u7A97\u53E3$',
    '^\u663E\u793A\u4E3B\u754C\u9762$',
    '^Show Main Window$',
    '^Show main window$'
)
function Find-ShowMainMenuItem {
    foreach ($menuNamePattern in $menuNamePatterns) {
        $elements = @(
            Find-ElementsMatchingName $menuNamePattern | Where-Object {
                $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem
            }
        )
        if ($elements.Count -gt 0) {
            return $elements[0]
        }
    }
    return $null
}

function Try-ShowMainMenu($Element) {
    try {
        Click-Element $Element $true
    }
    catch {
        return $false
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    $menuItem = $null
    while ([DateTime]::UtcNow -lt $deadline -and -not $menuItem) {
        $menuItem = Find-ShowMainMenuItem
        if (-not $menuItem) { Start-Sleep -Milliseconds 200 }
    }
    if (-not $menuItem) { return $false }
    try {
        $invoke = $menuItem.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $invoke.Invoke()
    }
    catch {
        Click-Element $menuItem
    }
    return $true
}

function Dismiss-ContextMenu {
    [OmniTrayInput]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)
    [OmniTrayInput]::keybd_event(0x1B, 0, 0x0002, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 150
}

function Find-ShowMainMenuItemWithin {
    param([int]$TimeoutMs = 2000)
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    $menuItem = $null
    while ([DateTime]::UtcNow -lt $deadline -and -not $menuItem) {
        $menuItem = Find-ShowMainMenuItem
        if (-not $menuItem) { Start-Sleep -Milliseconds 200 }
    }
    return $menuItem
}

function Find-AppTrayCandidate {
    # Probe each shell candidate through its real context menu. The application
    # menu has a unique Show Main Window item, so clock/volume/other icons are
    # never accepted as the Omni-Context icon. Re-enumerate after each probe
    # because opening the overflow popup can invalidate UIA element handles.
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        Dismiss-ContextMenu
        $candidates = @(Find-VisibleTrayElements)
        $omniCandidates = @($candidates | Where-Object {
            $_.Current.ClassName -match '(?i)SystemTray\.OmniButton'
        })
        $otherCandidates = @($candidates | Where-Object {
            $_.Current.ClassName -notmatch '(?i)SystemTray\.OmniButton'
        })
        $candidates = @($omniCandidates + $otherCandidates)
        foreach ($candidate in $candidates) {
            try {
                Click-Element $candidate $true
                $menuItem = Find-ShowMainMenuItemWithin
                if ($menuItem) {
                    return [pscustomobject]@{ Icon = $candidate; Menu = $menuItem }
                }
            }
            catch {
                # The shell may remove a stale overflow element while probing.
            }
            Dismiss-ContextMenu
        }
        Start-Sleep -Milliseconds 250
    }
    return $null
}

function Get-SafeTrayField([object]$Value, [int]$MaxLength = 64) {
    $text = [string]$Value
    # UIA names are shell-provided, but may contain localized/user-controlled
    # text. Keep diagnostics bounded and printable before they enter CI logs.
    $text = [regex]::Replace($text, '[^A-Za-z0-9._:/ -]', '?')
    if ($text.Length -gt $MaxLength) { return $text.Substring(0, $MaxLength) + '...' }
    return $text
}

function Write-TrayDiagnostics {
    # This is deliberately read-only and capped. It records enough shell UIA
    # shape to diagnose runner differences without dumping arbitrary desktop
    # text or paths into the acceptance log.
    $diagnostics = New-Object System.Collections.Generic.List[string]
    foreach ($element in ($root.FindAll($treeScope, $trueCondition))) {
        try {
            $current = $element.Current
            $className = [string]$current.ClassName
            $automationId = [string]$current.AutomationId
            $isTrayClass = $className -match '(?i)(SystemTray\.|NotifyIcon|TrayNotify|Shell_TrayWnd|ToolbarWindow32)'
            $isTrayAutomationId = $automationId -match '(?i)(^|[._-])(?:SystemTrayIcon|NotifyIcon)(?:$|[._-])'
            if (-not ($isTrayClass -or $isTrayAutomationId)) { continue }
            $bounds = $current.BoundingRectangle
            $boundsText = if ($bounds.IsEmpty) { 'empty' } else {
                '{0},{1},{2}x{3}' -f [int]$bounds.Left, [int]$bounds.Top, [int]$bounds.Width, [int]$bounds.Height
            }
            $diagnostics.Add(('[tray-uia] class={0};automationId={1};controlType={2};pid={3};offscreen={4};bounds={5};name={6}' -f
                (Get-SafeTrayField $className),
                (Get-SafeTrayField $automationId),
                (Get-SafeTrayField ([string]$current.ControlType)),
                [int]$current.ProcessId,
                [bool]$current.IsOffscreen,
                $boundsText,
                (Get-SafeTrayField ([string]$current.Name))))
            if ($diagnostics.Count -ge 80) { break }
        }
        catch {
            continue
        }
    }
    if ($diagnostics.Count -eq 0) {
        Write-Output '[tray-uia] no shell tray descendants matched the diagnostic filter'
    }
    else {
        foreach ($line in $diagnostics) { Write-Output $line }
    }
}

$icon = $null
$candidates = @()
$overflowAttempted = $false
$deadline = [DateTime]::UtcNow.AddSeconds(20)
while ([DateTime]::UtcNow -lt $deadline -and -not $icon) {
    $icon = Find-TrayIcon
    if ($icon) { break }
    if (-not $overflowAttempted) {
        $overflowAttempted = $true
        $null = Open-HiddenIcons
        Start-Sleep -Milliseconds 1000
        continue
    }
    $candidates = @(Find-VisibleTrayElements)
    if ($candidates.Count -gt 0) { break }
    Start-Sleep -Milliseconds 250
}

if ($icon) {
    if ($Action -eq 'left-click') {
        Click-Element $icon
        Write-Output 'PASS installed tray icon left click'
        exit 0
    }
    if (Try-ShowMainMenu $icon) {
        Write-Output 'PASS installed tray context menu Show Main Window'
        exit 0
    }
    throw 'The installed Omni-Context tray context menu did not expose its Show Main Window command.'
}

# Fallback for shell builds that expose tray icons only as unnamed
# SystemTray.* elements. Each candidate is a real UIA element and must expose
# this product's Show Main Window command before it can be used.
$candidates = @($candidates + @(Find-VisibleTrayElements) | Select-Object -Unique)
if ($candidates.Count -eq 0) {
    Write-TrayDiagnostics
    throw 'The installed Omni-Context notification-area icon was not exposed by Windows UI Automation (no named product tooltip or SystemTray.* candidate was available).'
}

$appCandidate = Find-AppTrayCandidate
if (-not $appCandidate) {
    Write-TrayDiagnostics
    throw 'The installed Omni-Context SystemTray.* candidates did not expose its Show Main Window command.'
}

if ($Action -eq 'left-click') {
    Dismiss-ContextMenu
    Click-Element $appCandidate.Icon
    Start-Sleep -Milliseconds 250
    if ($MainWindowHandle -le 0 -or (Test-MainWindowVisible)) {
        Write-Output 'PASS installed tray icon left click via SystemTray UIA candidate'
        exit 0
    }
    throw 'The installed Omni-Context SystemTray.* candidate did not reopen the cached main window.'
}

try {
    $invoke = $appCandidate.Menu.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
}
catch {
    Click-Element $appCandidate.Menu
}
Start-Sleep -Milliseconds 250
if ($MainWindowHandle -le 0 -or (Test-MainWindowVisible)) {
    Write-Output 'PASS installed tray context menu Show Main Window via SystemTray UIA candidate'
    exit 0
}
throw 'The installed Omni-Context SystemTray.* candidate did not reopen the cached main window.'
