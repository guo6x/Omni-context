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
$classNameProperty = [System.Windows.Automation.AutomationElement]::ClassNameProperty
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

function Wait-MainWindowVisible([int]$TimeoutMs = 3000) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-MainWindowVisible) { return $true }
        Start-Sleep -Milliseconds 100
    }
    return (Test-MainWindowVisible)
}

function Click-Element($Element, [bool]$RightClick = $false) {
    $bounds = $Element.Current.BoundingRectangle
    if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) {
        throw 'The Windows accessibility element has no clickable screen bounds.'
    }
    $x = [int]($bounds.Left + ($bounds.Width / 2))
    $y = [int]($bounds.Top + ($bounds.Height / 2))
    Click-Point $x $y $RightClick
}

function Click-Point([int]$X, [int]$Y, [bool]$RightClick = $false) {
    if (-not [OmniTrayInput]::SetCursorPos($X, $Y)) {
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

function Get-TrayClickPoints($Element) {
    $bounds = $Element.Current.BoundingRectangle
    if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) {
        return @()
    }
    $className = [string]$Element.Current.ClassName
    if ($className -notmatch '(?i)^ToolbarWindow32$' -or $bounds.Width -le 24) {
        return @([pscustomobject]@{
            X = [int]($bounds.Left + ($bounds.Width / 2))
            Y = [int]($bounds.Top + ($bounds.Height / 2))
        })
    }
    # Classic shell toolbar buttons are exposed as one parent rectangle. Probe
    # each 24px slot so the pointer never lands in the gap between two buttons.
    $slotCount = [Math]::Max(1, [int][Math]::Ceiling($bounds.Width / 24))
    $points = New-Object System.Collections.Generic.List[object]
    for ($slot = 0; $slot -lt $slotCount; $slot++) {
        $null = $points.Add([pscustomobject]@{
            X = [int]($bounds.Left + (($slot * $bounds.Width / $slotCount) + ($bounds.Width / $slotCount / 2)))
            Y = [int]($bounds.Top + ($bounds.Height / 2))
        })
    }
    return $points.ToArray()
}

function Find-TrayIcon {
    # Windows exposes classic notification-area icons differently across runner
    # images: the same icon may be reported as Button, Image, Custom, or
    # ListItem, and its tooltip can be decorated by the shell. Do not require
    # an Explorer ProcessId here: Windows 11 runner images can expose the
    # notification-area provider through a shell proxy process. Restrict the
    # name match to shell tray classes so an app window title cannot qualify.
    foreach ($element in (Find-ShellTrayElements)) {
        try {
            $current = $element.Current
            $name = [string]$current.Name
            $className = [string]$current.ClassName
            if ($name -match '(?i)omni[\s-]*context' -and
                $className -match '(?i)(SystemTray\.|NotifyIcon|TrayNotify|ToolbarWindow32)' -and
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
            $className = [string]$element.Current.ClassName
            # Find-ShellTrayElements also returns the shell host/toolbars that
            # contain the real buttons. They are useful as overflow-toggle
            # targets, but must not be probed as application tray icons: a
            # toolbar's bounds can remain visible even when its overflow popup
            # is closed, which would make the fallback accept a false target.
            if ($className -match '(?i)^(Shell_TrayWnd|TrayNotifyWnd|ToolbarWindow32)$') {
                continue
            }
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
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($element in ($root.FindAll($treeScope, $trueCondition))) {
        try {
            $current = $element.Current
            $className = [string]$current.ClassName
            $automationId = [string]$current.AutomationId
            # Windows Server 2022 may expose notification buttons as direct
            # ToolbarWindow32 descendants of TrayNotifyWnd instead of the
            # SystemTray.* proxy classes used by interactive Windows 11.
            $isTrayClass = $className -match '(?i)^(SystemTray\.|NotifyIcon|TrayNotify)'
            $isTrayAutomationId = $automationId -match '(?i)(^|[._-])(?:SystemTrayIcon|NotifyIcon)(?:$|[._-])'
            if (-not ($isTrayClass -or $isTrayAutomationId)) { continue }
            $bounds = $current.BoundingRectangle
            if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) { continue }
            $key = (([string]$current.NativeWindowHandle) + '|' + [string]$current.AutomationId + '|' +
                [string]$current.ClassName + '|' + [int]$bounds.Left + '|' + [int]$bounds.Top + '|' +
                [int]$bounds.Width + '|' + [int]$bounds.Height)
            if ($seen.Add($key)) { $null = $found.Add($element) }
        }
        catch {
            continue
        }
    }
    # Classic Windows Server taskbars expose individual notification buttons as
    # generic Button/Custom descendants of TrayNotifyWnd, not SystemTray.*.
    # Walk those host descendants and retain only controls with concrete bounds
    # so clicks still target real shell UIA elements.
    $trayHostCondition = New-Object System.Windows.Automation.PropertyCondition($classNameProperty, 'TrayNotifyWnd')
    foreach ($trayHost in ($root.FindAll($treeScope, $trayHostCondition))) {
        try {
            foreach ($element in ($trayHost.FindAll($treeScope, $trueCondition))) {
                try {
                    $current = $element.Current
                    $className = [string]$current.ClassName
                    $controlType = [string]$current.ControlType.ProgrammaticName
                    $bounds = $current.BoundingRectangle
                    $isButton = $controlType -match '(?i)(Button|Custom|Image|ListItem|MenuItem|Thumb)$'
                    $isToolbar = $className -match '(?i)^(ToolbarWindow32|SystemTray\.|NotifyIcon)'
                    if (-not ($isButton -or $isToolbar) -or
                        $bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) { continue }
                    $key = (([string]$current.NativeWindowHandle) + '|' + [string]$current.AutomationId + '|' +
                        $className + '|' + [int]$bounds.Left + '|' + [int]$bounds.Top + '|' +
                        [int]$bounds.Width + '|' + [int]$bounds.Height)
                    if ($seen.Add($key)) { $null = $found.Add($element) }
                }
                catch { continue }
            }
        }
        catch { continue }
    }
    return $found.ToArray()
}

function Find-OverflowToggle {
    $found = New-Object System.Collections.Generic.List[object]
    foreach ($element in (Find-ShellTrayElements)) {
        try {
            $current = $element.Current
            if ([string]$current.AutomationId -eq 'SystemTrayIcon' -or
                [string]$current.ClassName -match '(?i)^ToolbarWindow32$') {
                $null = $found.Add($element)
            }
        }
        catch {
            continue
        }
    }
    return @($found.ToArray() | Sort-Object -Property @(
        @{ Expression = { $_.Current.BoundingRectangle.Width } },
        @{ Expression = { $_.Current.BoundingRectangle.Left } }
    ))
}

function Open-HiddenIcons {
    $hiddenNamePatterns = @(
        '(?i)show hidden icons',
        '(?i)\u663E\u793A\u9690\u85CF',
        '(?i)more icons',
        '(?i)\u66F4\u591A\u56FE\u6807'
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
            foreach ($point in (Get-TrayClickPoints $overflowToggle)) {
                Click-Point $point.X $point.Y
                Start-Sleep -Milliseconds 1000
                # A toolbar host is always present in the classic shell, so
                # merely finding one is not evidence that the overflow popup
                # opened. The caller separately probes toolbar slots and
                # verifies this product's menu/window effect.
                if ((Find-VisibleTrayElements | Where-Object {
                    $_.Current.ClassName -notmatch '(?i)^ToolbarWindow32$'
                }).Count -gt 0) { return $true }
            }
        }
        catch {
            continue
        }
    }
    return $false
}

$menuNamePatterns = @(
    '^\s*\u663E\u793A\u4E3B\u7A97\u53E3\s*$',
    '^\s*\u663E\u793A\u4E3B\u754C\u9762\s*$',
    '(?i)^\s*show\s+(?:the\s+)?main\s+window\s*$'
)
function Find-ShowMainMenuItem {
    foreach ($menuNamePattern in $menuNamePatterns) {
        $elements = @(
            Find-ElementsMatchingName $menuNamePattern | Where-Object {
                try {
                    $current = $_.Current
                    $bounds = $current.BoundingRectangle
                    if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) {
                        return $false
                    }
                    # Native Windows context menus are exposed as MenuItem on
                    # some runner images, but as ListItem/Custom/Text on the
                    # classic Server shell. The exact product label plus the
                    # later cached-HWND visibility check remains the identity
                    # gate; do not reject a real menu solely for its UIA type.
                    $controlType = [string]$current.ControlType.ProgrammaticName
                    return $controlType -match '(?i)(MenuItem|ListItem|Button|Custom|Text)'
                }
                catch {
                    return $false
                }
            }
        )
        if ($elements.Count -gt 0) {
            return $elements[0]
        }
    }
    return $null
}

function Find-TrayToolbarElements {
    # Classic Windows Server exposes notification icons as toolbar items rather
    # than individual UIA elements. Keep the toolbar itself scoped to the shell
    # TrayNotifyWnd; ToolbarWindow32 is a generic class used by many unrelated
    # windows and must never be treated as a tray icon globally.
    $found = New-Object System.Collections.Generic.List[object]
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    $trayHostCondition = New-Object System.Windows.Automation.PropertyCondition($classNameProperty, 'TrayNotifyWnd')
    foreach ($trayHost in ($root.FindAll($treeScope, $trayHostCondition))) {
        try {
            foreach ($element in ($trayHost.FindAll($treeScope, $trueCondition))) {
                try {
                    $current = $element.Current
                    if ([string]$current.ClassName -notmatch '(?i)^ToolbarWindow32$') { continue }
                    $bounds = $current.BoundingRectangle
                    if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) { continue }
                    $key = (([string]$current.NativeWindowHandle) + '|' + [string]$current.AutomationId + '|' +
                        [int]$bounds.Left + '|' + [int]$bounds.Top + '|' + [int]$bounds.Width + '|' + [int]$bounds.Height)
                    if ($seen.Add($key)) { $null = $found.Add($element) }
                }
                catch { continue }
            }
        }
        catch { continue }
    }
    return $found.ToArray()
}

function Get-TrayProbePoints([ValidateSet('left-click', 'menu-show')][string]$Action = 'menu-show') {
    # A classic toolbar may expose a 48px host for two 24px notification
    # buttons, while UIA provides no child buttons. Probe the center of each
    # 24px slot inside each real tray toolbar. For the direct left-click path,
    # add a narrow 4px grid around those slots to tolerate shell padding and a
    # transient button-width change; every candidate remains gated by the
    # cached main HWND becoming visible.
    $points = New-Object System.Collections.Generic.List[object]
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($toolbar in (Find-TrayToolbarElements)) {
        try {
            $bounds = $toolbar.Current.BoundingRectangle
            $left = [int][Math]::Ceiling($bounds.Left + 4)
            $right = [int][Math]::Floor($bounds.Right - 4)
            $top = [int][Math]::Ceiling($bounds.Top + ($bounds.Height / 2))
            if ($right -lt $left) { continue }
            $slotCount = [Math]::Max(1, [int][Math]::Ceiling(($right - $left + 1) / 24))
            for ($slot = 0; $slot -lt $slotCount; $slot++) {
                $slotLeft = [int][Math]::Max($left, $left + ($slot * 24))
                $slotRight = [int][Math]::Min($right, $slotLeft + 23)
                $slotCenter = [int](($slotLeft + $slotRight) / 2)
                $slotXs = if ($Action -eq 'left-click') {
                    @($slotLeft + 4, $slotCenter, $slotRight - 4)
                }
                else {
                    @($slotCenter)
                }
                foreach ($x in $slotXs) {
                    if ($x -lt $left -or $x -gt $right) { continue }
                    $key = "$x|$top"
                    if ($seen.Add($key)) {
                        $null = $points.Add([pscustomobject]@{ X = $x; Y = $top })
                    }
                }
            }
        }
        catch { continue }
    }

    # Some classic shell images briefly publish TrayNotifyWnd before its
    # toolbar child, or place the overflow button in the 24px strip immediately
    # before the toolbar. Probe only that narrow pre-toolbar strip for left
    # click recovery; do not spray right-click menu probes across the clock.
    if ($Action -eq 'left-click') {
        $trayHostCondition = New-Object System.Windows.Automation.PropertyCondition($classNameProperty, 'TrayNotifyWnd')
        foreach ($trayHost in ($root.FindAll($treeScope, $trayHostCondition))) {
            try {
                $hostBounds = $trayHost.Current.BoundingRectangle
                $toolbars = @(Find-TrayToolbarElements)
                $preToolbarRight = if ($toolbars.Count -gt 0) {
                    [int](($toolbars | ForEach-Object { $_.Current.BoundingRectangle.Left } | Measure-Object -Minimum).Minimum) - 4
                }
                else {
                    [int]$hostBounds.Right - 4
                }
                $hostLeft = [int][Math]::Ceiling($hostBounds.Left + 4)
                $hostTop = [int][Math]::Ceiling($hostBounds.Top + ($hostBounds.Height / 2))
                for ($x = $hostLeft; $x -le $preToolbarRight; $x += 4) {
                    $key = "$x|$hostTop"
                    if ($seen.Add($key)) {
                        $null = $points.Add([pscustomobject]@{ X = $x; Y = $hostTop })
                    }
                }
            }
            catch { continue }
        }
    }
    return $points.ToArray()
}

function Invoke-TrayPoint([object]$Point, [ValidateSet('left-click', 'menu-show')][string]$Action) {
    Dismiss-ContextMenu
    try {
        if ($Action -eq 'left-click') {
            Click-Point $Point.X $Point.Y
            return (Wait-MainWindowVisible)
        }
        Click-Point $Point.X $Point.Y $true
        $menuItem = Find-ShowMainMenuItemWithin
        if (-not $menuItem) { return (Invoke-ShowMainMenuByKeyboard) }
        try {
            $invoke = $menuItem.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $invoke.Invoke()
        }
        catch {
            Click-Element $menuItem
        }
        if (Wait-MainWindowVisible) { return $true }
        return (Invoke-ShowMainMenuByKeyboard)
    }
    catch {
        return $false
    }
    finally {
        Dismiss-ContextMenu
    }
}

function Find-AppTrayPoint([ValidateSet('left-click', 'menu-show')][string]$Action) {
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        foreach ($point in (Get-TrayProbePoints $Action)) {
            if (Invoke-TrayPoint $point $Action) { return $true }
        }
        if ($attempt -lt 2) {
            $null = Open-HiddenIcons
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
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
    if (-not $menuItem) { return (Invoke-ShowMainMenuByKeyboard) }
    try {
        $invoke = $menuItem.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $invoke.Invoke()
    }
    catch {
        Click-Element $menuItem
    }
    if (Wait-MainWindowVisible) { return $true }
    return (Invoke-ShowMainMenuByKeyboard)
}

function Dismiss-ContextMenu {
    [OmniTrayInput]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)
    [OmniTrayInput]::keybd_event(0x1B, 0, 0x0002, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 150
}

function Invoke-ShowMainMenuByKeyboard {
    # The classic Server shell can render a real native popup menu without
    # publishing its MenuItem descendants to UI Automation. The tray menu is
    # intentionally ordered with Show Main Window first (see main.rs), so
    # Home+Enter is the same user-visible command path while retaining the
    # cached native HWND visibility gate below. If no popup is open, these
    # keystrokes have no effect and the caller continues probing other slots.
    try {
        [OmniTrayInput]::keybd_event(0x24, 0, 0, [UIntPtr]::Zero) # VK_HOME
        [OmniTrayInput]::keybd_event(0x24, 0, 0x0002, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 80
        [OmniTrayInput]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero) # VK_RETURN
        [OmniTrayInput]::keybd_event(0x0D, 0, 0x0002, [UIntPtr]::Zero)
        return (Wait-MainWindowVisible)
    }
    catch {
        return $false
    }
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
        if ($attempt -gt 0) {
            $null = Open-HiddenIcons
            Start-Sleep -Milliseconds 500
        }
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

function Get-TrayNameKind([string]$Name) {
    if ([string]::IsNullOrWhiteSpace($Name)) { return 'empty' }
    if ($Name -match '(?i)omni[\s-]*context') { return 'product' }
    if ($Name -match '(?i)show hidden|more icons|\u663E\u793A\u9690\u85CF|\u66F4\u591A\u56FE\u6807') { return 'overflow' }
    return 'other'
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
            $name = [string]$current.Name
            $diagnostics.Add(('[tray-uia] class={0};automationId={1};controlType={2};pid={3};offscreen={4};bounds={5};nameKind={6};nameLength={7}' -f
                (Get-SafeTrayField $className),
                (Get-SafeTrayField $automationId),
                (Get-SafeTrayField ([string]$current.ControlType)),
                [int]$current.ProcessId,
                [bool]$current.IsOffscreen,
                $boundsText,
                (Get-TrayNameKind $name),
                $name.Length))
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
    if ($candidates.Count -eq 0) {
        # A classic shell may expose only the toolbar host; that is enough to
        # switch to the scoped native slot probe without waiting out the retry
        # deadline for UIA children that will never be published.
        $candidates = @(Find-TrayToolbarElements)
    }
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

# A left click has a direct, observable acceptance gate: the cached main HWND
# must become visible. Do this before any context-menu probing, because probing
# other classic-toolbar slots can dismiss or reorder the native tray popup and
# make the subsequent left-click path flaky on Server images.
if ($Action -eq 'left-click' -and (Find-AppTrayPoint $Action)) {
    Write-Output 'PASS installed tray icon left click via classic toolbar slot'
    exit 0
}

if ($candidates.Count -eq 0) {
    if (Find-AppTrayPoint $Action) {
        if ($Action -eq 'left-click') {
            Write-Output 'PASS installed tray icon left click via classic toolbar slot'
        }
        else {
            Write-Output 'PASS installed tray context menu Show Main Window via classic toolbar slot'
        }
        exit 0
    }
    Write-TrayDiagnostics
    throw 'The installed Omni-Context notification-area icon was not exposed by Windows UI Automation (no named product tooltip or SystemTray.* candidate was available).'
}

$appCandidate = Find-AppTrayCandidate
if (-not $appCandidate) {
    if (Find-AppTrayPoint $Action) {
        if ($Action -eq 'left-click') {
            Write-Output 'PASS installed tray icon left click via classic toolbar slot'
        }
        else {
            Write-Output 'PASS installed tray context menu Show Main Window via classic toolbar slot'
        }
        exit 0
    }
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
