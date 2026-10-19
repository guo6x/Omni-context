param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('left-click', 'menu-show')]
    [string]$Action
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
}
'@

$root = [System.Windows.Automation.AutomationElement]::RootElement
$nameProperty = [System.Windows.Automation.AutomationElement]::NameProperty
$treeScope = [System.Windows.Automation.TreeScope]::Descendants
$explorerProcess = Get-Process -Name explorer -ErrorAction Stop | Select-Object -First 1
$explorerProcessId = $explorerProcess.Id

function Find-NamedElements([string]$Name) {
    $condition = New-Object System.Windows.Automation.PropertyCondition($nameProperty, $Name)
    return $root.FindAll($treeScope, $condition)
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
    foreach ($element in (Find-NamedElements 'Omni-Context')) {
        try {
            $current = $element.Current
            if ($current.ProcessId -eq $explorerProcessId -and
                $current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
                -not $current.IsOffscreen -and -not $current.BoundingRectangle.IsEmpty) {
                return $element
            }
        }
        catch {
            continue
        }
    }
    return $null
}

$icon = $null
$deadline = [DateTime]::UtcNow.AddSeconds(20)
while ([DateTime]::UtcNow -lt $deadline -and -not $icon) {
    $icon = Find-TrayIcon
    if ($icon) { break }
    foreach ($hiddenName in @('Show hidden icons', '显示隐藏图标', '显示隐藏的图标', 'More icons', '更多图标')) {
        foreach ($hiddenButton in (Find-NamedElements $hiddenName)) {
            try {
                if ($hiddenButton.Current.ProcessId -ne $explorerProcessId -or
                    $hiddenButton.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button) {
                    continue
                }
                $pattern = $hiddenButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                $pattern.Invoke()
                Start-Sleep -Milliseconds 250
            }
            catch {
                continue
            }
        }
    }
    Start-Sleep -Milliseconds 250
}
if (-not $icon) {
    throw 'The installed Omni-Context notification-area icon was not exposed by Windows UI Automation.'
}

if ($Action -eq 'left-click') {
    Click-Element $icon
    Write-Output 'PASS installed tray icon left click'
    exit 0
}

Click-Element $icon $true
$menuItem = $null
$deadline = [DateTime]::UtcNow.AddSeconds(10)
$menuNames = @('显示主窗口', '显示主界面', 'Show Main Window', 'Show main window')
while ([DateTime]::UtcNow -lt $deadline -and -not $menuItem) {
    foreach ($menuName in $menuNames) {
        $elements = @(
            Find-NamedElements $menuName | Where-Object {
                $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem
            }
        )
        if ($elements.Count -gt 0) {
            $menuItem = $elements[0]
            break
        }
    }
    if (-not $menuItem) { Start-Sleep -Milliseconds 200 }
}
if (-not $menuItem) {
    throw 'The installed Omni-Context tray context menu did not expose its Show Main Window command.'
}

try {
    $invoke = $menuItem.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
}
catch {
    Click-Element $menuItem
}
Write-Output 'PASS installed tray context menu Show Main Window'
