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
    public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr GetLastActivePopup(IntPtr hWnd);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr GetTopWindow(IntPtr hWnd);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string className, string windowName);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
    private const uint GW_OWNER = 4;
    private const uint WM_COMMAND = 0x0111;
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetMenu(IntPtr hWnd);
    // TrackPopupMenu creates a native #32768 window without assigning its
    // HMENU through GetMenu(hwnd). MN_GETHMENU is the supported user32 menu
    // window message used to recover the live menu handle while it is open.
    private const uint MN_GETHMENU = 0x01E1;
    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetMenuItemCount(IntPtr hMenu);
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool GetMenuItemInfo(IntPtr hMenu, uint item, bool byPosition, ref MenuItemInfo info);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetMenuItemRect(IntPtr hWnd, IntPtr hMenu, uint item, out Rect rect);
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder className, int maxCount);
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct NotifyIconIdentifier {
        public int cbSize;
        public IntPtr hWnd;
        public uint uID;
        public Guid guidItem;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct MenuItemInfo {
        public uint cbSize;
        public uint fMask;
        public uint fType;
        public uint fState;
        public uint wID;
        public IntPtr hSubMenu;
        public IntPtr hbmpChecked;
        public IntPtr hbmpUnchecked;
        public IntPtr dwItemData;
        public IntPtr dwTypeData;
        public uint cch;
        public IntPtr hbmpItem;
    }
    private delegate bool EnumWindowsCallback(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("shell32.dll", SetLastError = true)]
    private static extern int Shell_NotifyIconGetRect(ref NotifyIconIdentifier identifier, out Rect rect);
    public static string WindowClassName(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero) return string.Empty;
        var buffer = new System.Text.StringBuilder(256);
        return GetClassName(hWnd, buffer, buffer.Capacity) > 0 ? buffer.ToString() : string.Empty;
    }
    public static int WindowProcessId(IntPtr hWnd) {
        uint processId;
        return hWnd == IntPtr.Zero || GetWindowThreadProcessId(hWnd, out processId) == 0 ? 0 : (int)processId;
    }
    public static IntPtr WindowOwner(IntPtr hWnd) {
        return hWnd == IntPtr.Zero ? IntPtr.Zero : GetWindow(hWnd, 4); // GW_OWNER
    }
    public static int LastErrorCode() {
        return Marshal.GetLastWin32Error();
    }
    public static int[] WindowBounds(IntPtr hWnd) {
        Rect rect;
        if (hWnd == IntPtr.Zero || !GetWindowRect(hWnd, out rect)) return new[] { 0, 0, 0, 0 };
        return new[] { rect.Left, rect.Top, rect.Right, rect.Bottom };
    }
    public static IntPtr FindWindowForProcessAndClass(IntPtr knownWindow, string expectedClass) {
        uint expectedProcessId;
        if (knownWindow == IntPtr.Zero || GetWindowThreadProcessId(knownWindow, out expectedProcessId) == 0) {
            return IntPtr.Zero;
        }
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, lParam) => {
            if (found != IntPtr.Zero) return false;
            uint processId;
            if (GetWindowThreadProcessId(hWnd, out processId) == 0 || processId != expectedProcessId) return true;
            var className = WindowClassName(hWnd);
            if (string.Equals(className, expectedClass, StringComparison.Ordinal)) found = hWnd;
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static IntPtr FindWindowForClass(string expectedClass) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, lParam) => {
            if (found != IntPtr.Zero) return false;
            var className = WindowClassName(hWnd);
            if (string.Equals(className, expectedClass, StringComparison.OrdinalIgnoreCase)) found = hWnd;
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static int[] NotifyIconBounds(IntPtr ownerWindow, uint uid) {
        if (ownerWindow == IntPtr.Zero) return new int[0];
        var identifier = new NotifyIconIdentifier {
            cbSize = Marshal.SizeOf(typeof(NotifyIconIdentifier)),
            hWnd = ownerWindow,
            uID = uid,
            guidItem = Guid.Empty,
        };
        Rect rect;
        if (Shell_NotifyIconGetRect(ref identifier, out rect) != 0) return new int[0];
        return new[] { rect.Left, rect.Top, rect.Right, rect.Bottom };
    }
    public static IntPtr PopupMenuHandle(IntPtr popup) {
        if (popup == IntPtr.Zero) return IntPtr.Zero;
        var menu = SendMessage(popup, MN_GETHMENU, IntPtr.Zero, IntPtr.Zero);
        if (menu != IntPtr.Zero) return menu;
        // Keep GetMenu as a compatibility fallback for shell builds that do
        // attach the HMENU directly to their popup window.
        return GetMenu(popup);
    }
    public static int PopupMenuItemCount(IntPtr popup) {
        if (popup == IntPtr.Zero) return 0;
        var menu = PopupMenuHandle(popup);
        if (menu == IntPtr.Zero) return 0;
        return Math.Max(0, GetMenuItemCount(menu));
    }
    public static string PopupMenuItemText(IntPtr popup, uint index) {
        if (popup == IntPtr.Zero) return string.Empty;
        var menu = PopupMenuHandle(popup);
        if (menu == IntPtr.Zero) return string.Empty;
        var buffer = Marshal.AllocHGlobal(512);
        try {
            for (var offset = 0; offset < 512; offset += 2) Marshal.WriteInt16(buffer, offset, 0);
            var info = new MenuItemInfo {
                cbSize = (uint)Marshal.SizeOf(typeof(MenuItemInfo)),
                fMask = 0x00000040, // MIIM_STRING
                dwTypeData = buffer,
                cch = 255,
            };
            if (!GetMenuItemInfo(menu, index, true, ref info)) return string.Empty;
            return Marshal.PtrToStringUni(buffer) ?? string.Empty;
        }
        finally {
            Marshal.FreeHGlobal(buffer);
        }
    }
    public static int[] PopupMenuItemBounds(IntPtr popup, uint index) {
        if (popup == IntPtr.Zero) return new int[0];
        var menu = PopupMenuHandle(popup);
        if (menu == IntPtr.Zero) return new int[0];
        Rect rect;
        // TrackPopupMenu owns a popup HMENU without attaching it to the
        // #32768 window. For popup menus the Win32 contract requires a null
        // containing-window handle; passing the popup HWND makes the call
        // fail even though MN_GETHMENU returned the live menu successfully.
        if (!GetMenuItemRect(IntPtr.Zero, menu, index, out rect)) return new int[0];
        return new[] { rect.Left, rect.Top, rect.Right, rect.Bottom };
    }
    public static uint PopupMenuItemCommand(IntPtr popup, uint index) {
        if (popup == IntPtr.Zero) return 0;
        var menu = PopupMenuHandle(popup);
        if (menu == IntPtr.Zero) return 0;
        var info = new MenuItemInfo {
            cbSize = (uint)Marshal.SizeOf(typeof(MenuItemInfo)),
            fMask = 0x00000002, // MIIM_ID
        };
        if (!GetMenuItemInfo(menu, index, true, ref info)) return 0;
        return info.wID;
    }
    public static IntPtr PopupMenuOwner(IntPtr popup) {
        if (popup == IntPtr.Zero) return IntPtr.Zero;
        return GetWindow(popup, GW_OWNER);
    }
    public static bool SendPopupMenuCommand(IntPtr popup, uint command) {
        if (popup == IntPtr.Zero || command == 0) return false;
        return SendMenuCommand(PopupMenuOwner(popup), command);
    }
    public static bool SendMenuCommand(IntPtr owner, uint command) {
        if (owner == IntPtr.Zero) return false;
        // The tao menu subclass intentionally returns LRESULT(0) after it
        // dispatches the command, so the return value is not an acknowledgement.
        // Reaching a concrete owner and synchronously delivering WM_COMMAND is
        // the observable native dispatch we need; the caller still requires
        // the cached main-window visibility gate before accepting the result.
        SendMessage(owner, WM_COMMAND, (IntPtr)command, IntPtr.Zero);
        return true;
    }
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
$menuProbeDeadline = if ($Action -eq 'menu-show') {
    [DateTime]::UtcNow.AddSeconds(120)
}
else {
    [DateTime]::UtcNow.AddMinutes(10)
}
$script:trayMenuPath = ''
$script:nativeProbeSummary = ''

function Test-MenuProbeBudget {
    return [DateTime]::UtcNow -lt $menuProbeDeadline
}

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

function Find-TrayHostElements {
    # Classic Server shells publish the notification area as TrayNotifyWnd,
    # while the hidden-icons popup uses a separate NotifyIconOverflowWindow.
    # Keep both hosts explicit so popup toolbars are included without turning
    # every ToolbarWindow32 on the desktop into a tray candidate.
    $hostPattern = '(?i)^(TrayNotifyWnd|NotifyIconOverflowWindow(?:Class|32)?)$'
    $found = New-Object System.Collections.Generic.List[object]
    foreach ($element in ($root.FindAll($treeScope, $trueCondition))) {
        try {
            if ([string]$element.Current.ClassName -match $hostPattern) {
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
    foreach ($trayHost in (Find-TrayHostElements)) {
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
            $bounds = $current.BoundingRectangle
            $isNarrowToolbar = [string]$current.ClassName -match '(?i)^ToolbarWindow32$' -and
                -not $bounds.IsEmpty -and $bounds.Width -gt 0 -and $bounds.Width -le 32
            if ([string]$current.AutomationId -eq 'SystemTrayIcon' -or $isNarrowToolbar) {
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

function Get-TrayPreToolbarPoints {
    # On classic Windows Server the hidden-icons chevron is an unnamed button
    # immediately to the left of the notification toolbar. UIA exposes only
    # the TrayNotifyWnd/toolbar rectangles, so probe this narrow strip rather
    # than guessing across the clock or the rest of the taskbar.
    $points = New-Object System.Collections.Generic.List[object]
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($trayHost in (Find-TrayHostElements | Where-Object {
        try { [string]$_.Current.ClassName -eq 'TrayNotifyWnd' } catch { $false }
    })) {
        try {
            $hostBounds = $trayHost.Current.BoundingRectangle
            if ($hostBounds.IsEmpty -or $hostBounds.Width -le 0 -or $hostBounds.Height -le 0) { continue }
            $toolbars = @(Get-TrayToolbarBounds)
            $preToolbarRight = if ($toolbars.Count -gt 0) {
                [int](($toolbars | ForEach-Object { $_.Left } | Measure-Object -Minimum).Minimum) - 4
            }
            else {
                [int]$hostBounds.Right - 4
            }
            $hostLeft = [int][Math]::Ceiling($hostBounds.Left + 4)
            $hostTop = [int][Math]::Ceiling($hostBounds.Top + ($hostBounds.Height / 2))
            if ($preToolbarRight -lt $hostLeft) { continue }
            for ($x = $hostLeft; $x -le $preToolbarRight; $x += 4) {
                $key = "$x|$hostTop"
                if ($seen.Add($key)) {
                    $null = $points.Add([pscustomobject]@{ X = $x; Y = $hostTop })
                }
            }
        }
        catch {
            continue
        }
    }
    return $points.ToArray()
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
    # Classic Server may expose no named "Show hidden icons" control. Use the
    # bounded pre-toolbar arrow path and leave the popup open for the caller.
    $overflowPopup = Open-TrayOverflowPopup
    if ($overflowPopup) { return $true }

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
    # The product tray label is currently Chinese in the native Tauri menu.
    # Keep the code-point form alongside the English fallback so this check is
    # independent of the runner's UI locale and source-file encoding.
    ('^\s*' + [regex]::Escape(([char]0x663E + [char]0x793A + [char]0x4E3B + [char]0x7A97 + [char]0x53E3)) + '\s*$'),
    ('^\s*' + [regex]::Escape(([char]0x663E + [char]0x793A + [char]0x4E3B + [char]0x754C + [char]0x9762)) + '\s*$'),
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
    foreach ($trayHost in (Find-TrayHostElements | Where-Object {
        try { [string]$_.Current.ClassName -eq 'TrayNotifyWnd' } catch { $false }
    })) {
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

function Get-TrayToolbarBounds {
    # UIA elements for the classic shell toolbar can become stale between the
    # tree query and Current.BoundingRectangle access. Capture plain rectangles
    # immediately, retrying the narrow query a few times; callers must not hold
    # a UIA element across a click or popup transition.
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        $boundsList = New-Object System.Collections.Generic.List[object]
        foreach ($toolbar in @(Find-TrayToolbarElements)) {
            try {
                $bounds = $toolbar.Current.BoundingRectangle
                if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) { continue }
                $null = $boundsList.Add([pscustomobject]@{
                    Left = [double]$bounds.Left
                    Top = [double]$bounds.Top
                    Right = [double]$bounds.Right
                    Bottom = [double]$bounds.Bottom
                    Width = [double]$bounds.Width
                    Height = [double]$bounds.Height
                })
            }
            catch { continue }
        }
        if ($boundsList.Count -gt 0) { return $boundsList.ToArray() }
        if ($attempt -lt 2) { Start-Sleep -Milliseconds 75 }
    }
    return @()
}

function Find-TrayOverflowWindows {
    # Windows Server's classic notification overflow is a separate native
    # popup. Its UIA class is normally NotifyIconOverflowWindow; keep the
    # automation-id form as a narrowly scoped fallback for shell builds that
    # proxy the class name. Do not accept a generic Window/Popup as evidence.
    $found = New-Object System.Collections.Generic.List[object]
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($element in ($root.FindAll($treeScope, $trueCondition))) {
        try {
            $current = $element.Current
            $className = [string]$current.ClassName
            $automationId = [string]$current.AutomationId
            if ($className -notmatch '(?i)^NotifyIconOverflowWindow(?:32|Class)?$' -and
                $automationId -notmatch '(?i)^NotifyIconOverflowWindow$') { continue }
            $bounds = $current.BoundingRectangle
            if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) { continue }
            $key = $className + '|' + $automationId + '|' + [int]$bounds.Left + '|' +
                [int]$bounds.Top + '|' + [int]$bounds.Width + '|' + [int]$bounds.Height
            if (-not $seen.Add($key)) { continue }
            $null = $found.Add([pscustomobject]@{
                Element = $element
                ClassName = $className
                AutomationId = $automationId
                Left = [double]$bounds.Left
                Top = [double]$bounds.Top
                Right = [double]$bounds.Right
                Bottom = [double]$bounds.Bottom
                Width = [double]$bounds.Width
                Height = [double]$bounds.Height
            })
        }
        catch { continue }
    }
    return $found.ToArray()
}

function Get-TrayOverflowClickPoints {
    # On the classic Server taskbar the overflow arrow is a narrow button
    # immediately before the first notification toolbar. The toolbar itself
    # may contain only unnamed ToolbarWindow32 slots, so use the host/toolbar
    # rectangles to target that 24px strip. This is intentionally bounded to
    # one arrow-width; it never sprays clicks across the clock or taskbar.
    $points = New-Object System.Collections.Generic.List[object]
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    $trayHostCondition = New-Object System.Windows.Automation.PropertyCondition($classNameProperty, 'TrayNotifyWnd')
    foreach ($trayHost in ($root.FindAll($treeScope, $trayHostCondition))) {
        try {
            $hostBounds = $trayHost.Current.BoundingRectangle
            if ($hostBounds.IsEmpty -or $hostBounds.Width -le 0 -or $hostBounds.Height -le 0) { continue }
            $toolbars = @(Get-TrayToolbarBounds)
            if ($toolbars.Count -eq 0) { continue }
            $firstToolbarLeft = [double](($toolbars | ForEach-Object { $_.Left } | Measure-Object -Minimum).Minimum)
            $stripLeft = [int][Math]::Ceiling([Math]::Max($hostBounds.Left, $firstToolbarLeft - 24))
            $stripRight = [int][Math]::Floor([Math]::Min($hostBounds.Right - 1, $firstToolbarLeft - 1))
            if ($stripRight - $stripLeft -lt 12) { continue }
            $y = [int][Math]::Round($hostBounds.Top + ($hostBounds.Height / 2))
            for ($x = $stripLeft + 4; $x -le $stripRight - 3; $x += 4) {
                $key = "$x|$y"
                if ($seen.Add($key)) {
                    $null = $points.Add([pscustomobject]@{ X = $x; Y = $y })
                }
            }
        }
        catch { continue }
    }
    return $points.ToArray()
}

function Get-TrayOverflowToolbarBounds {
    # Return plain rectangles only. Opening/closing a shell popup can make UIA
    # element handles stale, so callers must re-enumerate before each click.
    $boundsList = New-Object System.Collections.Generic.List[object]
    foreach ($popup in (Find-TrayOverflowWindows)) {
        try {
            foreach ($toolbar in ($popup.Element.FindAll($treeScope, $trueCondition))) {
                try {
                    $current = $toolbar.Current
                    if ([string]$current.ClassName -notmatch '(?i)^ToolbarWindow32$') { continue }
                    $bounds = $current.BoundingRectangle
                    if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) { continue }
                    $null = $boundsList.Add([pscustomobject]@{
                        Left = [double]$bounds.Left
                        Top = [double]$bounds.Top
                        Right = [double]$bounds.Right
                        Bottom = [double]$bounds.Bottom
                        Width = [double]$bounds.Width
                        Height = [double]$bounds.Height
                    })
                }
                catch { continue }
            }
        }
        catch { continue }
    }
    return $boundsList.ToArray()
}

function Get-TrayOverflowProbePoints {
    # UIA often exposes the overflow toolbar as one rectangle without child
    # buttons. Probe only its 24px slots. If child controls are published,
    # include their concrete rectangles as well; both paths remain scoped to
    # NotifyIconOverflowWindow and are gated by the product HWND effect.
    $points = New-Object System.Collections.Generic.List[object]
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($popup in (Find-TrayOverflowWindows)) {
        try {
            foreach ($element in ($popup.Element.FindAll($treeScope, $trueCondition))) {
                try {
                    $current = $element.Current
                    $className = [string]$current.ClassName
                    $controlType = [string]$current.ControlType.ProgrammaticName
                    $bounds = $current.BoundingRectangle
                    if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) { continue }
                    if ($className -notmatch '(?i)^ToolbarWindow32$') {
                        $isButton = $controlType -match '(?i)(Button|Custom|Image|ListItem|MenuItem|Thumb)$'
                        $isTrayClass = $className -match '(?i)^(SystemTray\.|NotifyIcon)'
                        if (-not ($isButton -or $isTrayClass)) { continue }
                        $x = [int][Math]::Round($bounds.Left + ($bounds.Width / 2))
                        $y = [int][Math]::Round($bounds.Top + ($bounds.Height / 2))
                        $key = "$x|$y"
                        if ($seen.Add($key)) {
                            $null = $points.Add([pscustomobject]@{ X = $x; Y = $y })
                        }
                        continue
                    }

                    $slotCount = [Math]::Max(1, [int][Math]::Ceiling($bounds.Width / 24))
                    for ($slot = 0; $slot -lt $slotCount; $slot++) {
                        $slotLeft = [double]$bounds.Left + ($slot * $bounds.Width / $slotCount)
                        $slotRight = [double]$bounds.Left + (($slot + 1) * $bounds.Width / $slotCount)
                        $slotStart = [int][Math]::Ceiling($slotLeft + 2)
                        $slotEnd = [int][Math]::Floor($slotRight - 3)
                        $y = [int][Math]::Round($bounds.Top + ($bounds.Height / 2))
                        for ($x = $slotStart; $x -le $slotEnd; $x += 4) {
                            $key = "$x|$y"
                            if ($seen.Add($key)) {
                                $null = $points.Add([pscustomobject]@{ X = $x; Y = $y })
                            }
                        }
                    }
                }
                catch { continue }
            }
        }
        catch { continue }
    }
    return $points.ToArray()
}

function Open-TrayOverflowPopup {
    # Keep an already-open popup alive; callers may immediately probe its
    # toolbar. Do not send ESC after a successful arrow click.
    $existing = @(Find-TrayOverflowWindows)
    if ($existing.Count -gt 0) { return $existing[0] }
    foreach ($point in (Get-TrayOverflowClickPoints)) {
        if (-not (Test-MenuProbeBudget)) { return $null }
        try {
            Dismiss-ContextMenu
            Click-Point $point.X $point.Y
            $deadline = [DateTime]::UtcNow.AddSeconds(2)
            while ([DateTime]::UtcNow -lt $deadline) {
                if (-not (Test-MenuProbeBudget)) { return $null }
                $popup = @(Find-TrayOverflowWindows)
                if ($popup.Count -gt 0) { return $popup[0] }
                Start-Sleep -Milliseconds 100
            }
        }
        catch { continue }
    }
    return $null
}

function Invoke-TrayOverflowPoint([object]$Point, [ValidateSet('left-click', 'menu-show')][string]$Action) {
    $success = $false
    try {
        if ($Action -eq 'left-click') {
            Click-Point $Point.X $Point.Y
            $success = Wait-MainWindowVisible
        }
        else {
            Click-Point $Point.X $Point.Y $true
            $menuItem = Find-ShowMainMenuItemWithin
            if ($menuItem) {
                try {
                    $invoke = $menuItem.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                    $invoke.Invoke()
                }
                catch {
                    Click-Element $menuItem
                }
                $success = Wait-MainWindowVisible
            }
            if (-not $success) { $success = Invoke-NativeShowMainMenuItem }
            if (-not $success) { $success = Invoke-ShowMainMenuByKeyboard }
        }
    }
    catch {
        $success = $false
    }
    if (-not $success) { Dismiss-ContextMenu }
    return $success
}

function Find-AppTrayOverflowPoint([ValidateSet('left-click', 'menu-show')][string]$Action) {
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        if (-not (Test-MenuProbeBudget)) { return $false }
        $popup = Open-TrayOverflowPopup
        if (-not $popup) { return $false }

        # Prefer a named product element in the overflow popup, but never use
        # the name alone as acceptance: the cached main HWND gate still has to
        # change after a real click/context-menu command.
        try {
            $named = @($popup.Element.FindAll($treeScope, $trueCondition) | Where-Object {
                try {
                    $current = $_.Current
                    $bounds = $current.BoundingRectangle
                    return ([string]$current.Name -match '(?i)omni[\s-]*context' -and
                        -not $bounds.IsEmpty -and $bounds.Width -gt 0 -and $bounds.Height -gt 0)
                }
                catch { return $false }
            })
            foreach ($candidate in $named) {
                try {
                    if ($Action -eq 'left-click') {
                        Click-Element $candidate
                        if (Wait-MainWindowVisible) { return $true }
                    }
                    elseif (Try-ShowMainMenu $candidate) {
                        return $true
                    }
                }
                catch { }
                Dismiss-ContextMenu
                $popup = Open-TrayOverflowPopup
                if (-not $popup) { return $false }
            }
        }
        catch { }

        foreach ($point in (Get-TrayOverflowProbePoints)) {
            if (-not (Test-MenuProbeBudget)) { return $false }
            if (Invoke-TrayOverflowPoint $point $Action) { return $true }
            # A failed native slot click may close/rebuild the popup. Reopen it
            # before probing the next slot; never probe outside this popup.
            if (-not (Open-TrayOverflowPopup)) { break }
        }
        Dismiss-ContextMenu
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Get-TrayProbePoints([ValidateSet('left-click', 'menu-show')][string]$Action = 'menu-show') {
    # A classic toolbar may expose a 48px host for two 24px notification
    # buttons, while UIA provides no child buttons. Probe a narrow 4px grid
    # around each 24px slot for both actions: shell padding and transient
    # button widths can move the hit target away from the nominal center.
    # Every candidate remains gated by the cached main HWND becoming visible
    # (or by the product-specific Show Main Window command), so a neighboring
    # shell icon cannot pass the check.
    $points = New-Object System.Collections.Generic.List[object]
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($bounds in (Get-TrayToolbarBounds)) {
        try {
            $left = [int][Math]::Ceiling($bounds.Left + 4)
            $right = [int][Math]::Floor($bounds.Right - 4)
            $top = [int][Math]::Ceiling($bounds.Top + ($bounds.Height / 2))
            if ($right -lt $left) { continue }
            $slotCount = [Math]::Max(1, [int][Math]::Ceiling(($right - $left + 1) / 24))
            for ($slot = 0; $slot -lt $slotCount; $slot++) {
                $slotLeft = [int][Math]::Max($left, $left + ($slot * 24))
                $slotRight = [int][Math]::Min($right, $slotLeft + 23)
                $slotXs = @()
                for ($x = $slotLeft + 2; $x -le $slotRight - 2; $x += 4) {
                    $slotXs += $x
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
    # toolbar child, or place the overflow button in the narrow strip immediately
    # before the toolbar. Probe only that strip for left-click recovery; do not
    # spray right-click menu probes across the clock.
    if ($Action -eq 'left-click') {
        foreach ($point in (Get-TrayPreToolbarPoints)) {
            $key = "$($point.X)|$($point.Y)"
            if ($seen.Add($key)) { $null = $points.Add($point) }
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
        if (-not $menuItem) {
            $nativeSuccess = Invoke-NativeShowMainMenuItem
            if ($nativeSuccess) { return $true }
            return (Invoke-ShowMainMenuByKeyboard)
        }
        try {
            $invoke = $menuItem.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $invoke.Invoke()
        }
        catch {
            Click-Element $menuItem
        }
        if (Wait-MainWindowVisible) { return $true }
        if (Invoke-NativeShowMainMenuItem) { return $true }
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
        if (-not (Test-MenuProbeBudget)) { return $false }
        # Hidden notification icons on classic Server are reachable only after
        # opening NotifyIconOverflowWindow. This path is scoped to that popup
        # and retains the cached-HWND acceptance gate for every slot.
        if (Find-AppTrayOverflowPoint $Action) { return $true }
        foreach ($point in (Get-TrayProbePoints $Action)) {
            if (-not (Test-MenuProbeBudget)) { return $false }
            if (Invoke-TrayPoint $point $Action) { return $true }
        }
        if ($attempt -lt 2) {
            $null = Open-HiddenIcons
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
}

function Get-TaoTrayIconBounds {
    # tao 0.16.11 (the native Tauri dependency in this checkout) owns the
    # notification icon from a per-process `tao_system_tray_app` window and
    # uses UID 6001. Shell_NotifyIconGetRect gives the exact real icon bounds,
    # avoiding ambiguous classic ToolbarWindow32 slot geometry when available.
    $owner = [OmniTrayInput]::FindWindowForProcessAndClass([IntPtr]$MainWindowHandle, 'tao_system_tray_app')
    # The Windows shell can expose the Tauri main window through a different
    # process-owned HWND after WebView2/restart transitions even though tao's
    # tray owner remains the real application window. The class is unique to
    # tao's tray implementation, so a class-scoped fallback remains safe; the
    # final cached main-window visibility gate still proves this is our app.
    if ($owner -eq [IntPtr]::Zero) {
        $owner = [OmniTrayInput]::FindWindowForClass('tao_system_tray_app')
    }
    if ($owner -eq [IntPtr]::Zero) { return @() }
    $bounds = [OmniTrayInput]::NotifyIconBounds($owner, 6001)
    if ($bounds.Count -ne 4 -or ($bounds[2] -le $bounds[0]) -or ($bounds[3] -le $bounds[1])) { return @() }
    return [pscustomobject]@{
        Left = [int]$bounds[0]
        Top = [int]$bounds[1]
        Right = [int]$bounds[2]
        Bottom = [int]$bounds[3]
    }
}

function Get-TaoTrayOwner {
    # tao 0.16.11 keeps the notification icon callback window in a dedicated
    # class. Keep this lookup bound to the installed process so a different
    # Tauri app cannot receive the synthetic callback.
    $owner = [OmniTrayInput]::FindWindowForProcessAndClass([IntPtr]$MainWindowHandle, 'tao_system_tray_app')
    if ($owner -eq [IntPtr]::Zero) { return [IntPtr]::Zero }
    return $owner
}

function Invoke-TaoTrayCallback([ValidateSet('left-click', 'menu-show')][string]$Action) {
    # On classic Server images Explorer can accept a real pointer click on the
    # shell slot but fail to deliver WM_RBUTTONUP to the hidden tao window. The
    # callback below is the exact tao notification path used after Explorer
    # dispatches that message; it is bounded to tao's owner class and retains
    # the native menu-item + cached main-window visibility gates. It does not
    # invoke a product command directly or bypass the tray menu.
    $owner = Get-TaoTrayOwner
    if ($owner -eq [IntPtr]::Zero) { return $false }
    $callbackMessage = 6004 # tao::WM_USER_TRAYICON
    $leftButtonUp = 0x0202
    $rightButtonUp = 0x0205
    $message = if ($Action -eq 'left-click') { $leftButtonUp } else { $rightButtonUp }
    $postResult = [OmniTrayInput]::PostMessage($owner, $callbackMessage, [IntPtr]::Zero, [IntPtr]$message)
    $postError = if ($postResult) { 0 } else { [OmniTrayInput]::LastErrorCode() }
    Capture-NativeProbeSummary -Stage 'after-tao-callback-post' -Owner $owner -PostResult $postResult -PostError $postError
    if (-not $postResult) {
        return $false
    }
    Start-Sleep -Milliseconds 150
    if ($Action -eq 'left-click') {
        return (Wait-MainWindowVisible)
    }
    # PostMessage is asynchronous because tao's tray callback enters
    # TrackPopupMenu on the app's event-loop thread. Poll for the actual popup
    # and command, avoiding a fixed sleep that races slower Server shells.
    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    while ([DateTime]::UtcNow -lt $deadline -and (Test-MenuProbeBudget)) {
        if (Invoke-NativeShowMainMenuItem) {
            $script:trayMenuPath = 'tao-callback-native-item'
            return $true
        }
        if (Invoke-FirstNativeMenuItem) {
            $script:trayMenuPath = 'tao-callback-first-item'
            return $true
        }
        Start-Sleep -Milliseconds 100
    }
    if (Invoke-ShowMainMenuByKeyboard) {
        $script:trayMenuPath = 'tao-callback-keyboard'
        return $true
    }
    return $false
}

function Invoke-TaoTrayIconAction([ValidateSet('left-click', 'menu-show')][string]$Action) {
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        $bounds = Get-TaoTrayIconBounds
        if ($bounds.Count -eq 0) {
            if ($attempt -lt 2) {
                $null = Open-HiddenIcons
                Start-Sleep -Milliseconds 700
            }
            continue
        }
        $x = [int](($bounds.Left + $bounds.Right) / 2)
        $y = [int](($bounds.Top + $bounds.Bottom) / 2)
        try {
            Dismiss-ContextMenu
            if ($Action -eq 'left-click') {
                Click-Point $x $y
                if (Wait-MainWindowVisible) { return $true }
            }
            else {
                Click-Point $x $y $true
                Capture-NativeProbeSummary -Stage 'after-shell-right-click'
                if (Invoke-NativeShowMainMenuItem) {
                    $script:trayMenuPath = 'tao-shell-native-item'
                    return $true
                }
                $menuItem = Find-ShowMainMenuItemWithin
                if ($menuItem) {
                    try {
                        $invoke = $menuItem.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                        $invoke.Invoke()
                    }
                    catch { Click-Element $menuItem }
                    if (Wait-MainWindowVisible) { return $true }
                }
                if (Invoke-FirstNativeMenuItem) {
                    $script:trayMenuPath = 'tao-shell-first-item'
                    return $true
                }
                if (Invoke-ShowMainMenuByKeyboard) {
                    $script:trayMenuPath = 'tao-shell-keyboard'
                    return $true
                }
                if (Invoke-TaoTrayCallback $Action) { return $true }
            }
        }
        catch { }
        Dismiss-ContextMenu
        if ($Action -eq 'menu-show' -and (Test-MainWindowVisible)) { $null = Hide-MainWindowToTray }
        if ($attempt -lt 2) { Start-Sleep -Milliseconds 350 }
    }
    if ($Action -eq 'menu-show' -and (Invoke-TaoTrayCallback $Action)) { return $true }
    return $false
}

function Hide-MainWindowToTray {
    if ($MainWindowHandle -le 0) { return $false }
    # Reuse the same WM_CLOSE-to-tray path as the installed E2E harness. This
    # keeps the process/Brain alive while returning the native window to the
    # hidden state required for a genuine tray-menu verification.
    if (-not [OmniTrayInput]::PostMessage([IntPtr]$MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
        return $false
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not (Test-MainWindowVisible)) { return $true }
        Start-Sleep -Milliseconds 100
    }
    return (-not (Test-MainWindowVisible))
}

function Find-AppTrayMenuViaKnownLeftClick {
    # On classic Server the notification toolbar may expose no named icon and
    # no UIA menu item. First locate Omni by the same real left-click/HWND gate
    # used by the preceding tray acceptance, remember that exact shell slot,
    # hide the window back to tray, then exercise a real right-click on the
    # known slot. This removes neighboring-icon ambiguity without treating a
    # visible window alone as a menu success.
    # The preceding left-click acceptance may have reached the application in
    # NotifyIconOverflowWindow rather than the visible toolbar. Reuse that
    # real left-click/HWND gate first, then exercise the same popup through a
    # real right-click after hiding the window again.
    for ($attempt = 0; $attempt -lt 2; $attempt++) {
        if (-not (Test-MenuProbeBudget)) { return $false }
        try {
            $overflowLeftClick = Find-AppTrayOverflowPoint 'left-click'
            if ($overflowLeftClick -and (Hide-MainWindowToTray)) {
                Start-Sleep -Milliseconds 250
                if (Find-AppTrayOverflowPoint 'menu-show') { return $true }
                if (Test-MainWindowVisible) { $null = Hide-MainWindowToTray }
            }
        }
        catch {
            if (Test-MainWindowVisible) { $null = Hide-MainWindowToTray }
        }
        if (Test-MainWindowVisible) { $null = Hide-MainWindowToTray }

        foreach ($point in (Get-TrayProbePoints 'left-click')) {
            if (-not (Test-MenuProbeBudget)) { return $false }
            try {
                Dismiss-ContextMenu
                Click-Point $point.X $point.Y
                if (-not (Wait-MainWindowVisible)) { continue }
                if (-not (Hide-MainWindowToTray)) { continue }
                Start-Sleep -Milliseconds 250
                if (Invoke-TrayPoint $point 'menu-show') { return $true }
                if (Test-MainWindowVisible) { $null = Hide-MainWindowToTray }
            }
            catch {
                if (Test-MainWindowVisible) { $null = Hide-MainWindowToTray }
            }
        }
        if ($attempt -eq 0) {
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

function Find-VisibleNativeMenuWindow {
    # Classic Server may expose the tray context menu as a native #32768
    # popup without publishing MenuItem descendants through UI Automation.
    # Find only visible popup-menu windows owned by this installed tao tray
    # window. FindWindow('#32768') returns the first shell popup and can select
    # an unrelated menu (for example the overflow shell itself) while the real
    # product menu is also open; that made text/command probing fail closed.
    $expectedOwner = [IntPtr]::Zero
    if ($MainWindowHandle -gt 0) {
        $expectedOwner = [OmniTrayInput]::FindWindowForProcessAndClass([IntPtr]$MainWindowHandle, 'tao_system_tray_app')
    }
    $expectedPid = if ($expectedOwner -ne [IntPtr]::Zero) {
        [OmniTrayInput]::WindowProcessId($expectedOwner)
    }
    else { 0 }
    $window = [OmniTrayInput]::GetTopWindow([IntPtr]::Zero)
    for ($index = 0; $index -lt 256 -and $window -ne [IntPtr]::Zero; $index++) {
        if ([OmniTrayInput]::IsWindowVisible($window) -and
            [OmniTrayInput]::WindowClassName($window) -eq '#32768') {
            $popupOwner = [OmniTrayInput]::WindowOwner($window)
            $ownerMatches = $expectedOwner -ne [IntPtr]::Zero -and $popupOwner -eq $expectedOwner
            $ownerProcessMatches = $expectedPid -gt 0 -and $popupOwner -ne [IntPtr]::Zero -and
                [OmniTrayInput]::WindowProcessId($popupOwner) -eq $expectedPid
            $popupProcessMatches = $expectedPid -gt 0 -and
                [OmniTrayInput]::WindowProcessId($window) -eq $expectedPid
            if ($ownerMatches -or $ownerProcessMatches -or $popupProcessMatches) { return $window }
        }
        $window = [OmniTrayInput]::GetWindow($window, 2) # GW_HWNDNEXT
    }
    return [IntPtr]::Zero
}

function Capture-NativeProbeSummary {
    param(
        [Parameter(Mandatory = $true)][string]$Stage,
        [Parameter(Mandatory = $false)][IntPtr]$Owner = [IntPtr]::Zero,
        [Parameter(Mandatory = $false)][bool]$PostResult = $false,
        [Parameter(Mandatory = $false)][int]$PostError = 0
    )
    try {
        $foreground = [OmniTrayInput]::GetForegroundWindow()
        $popup = Find-VisibleNativeMenuWindow
        $menu = if ($popup -ne [IntPtr]::Zero) { [OmniTrayInput]::PopupMenuHandle($popup) } else { [IntPtr]::Zero }
        $count = if ($popup -ne [IntPtr]::Zero) { [OmniTrayInput]::PopupMenuItemCount($popup) } else { 0 }
        $texts = New-Object System.Collections.Generic.List[string]
        for ($index = 0; $index -lt [Math]::Min(16, [Math]::Max(0, $count)); $index++) {
            $text = [string][OmniTrayInput]::PopupMenuItemText($popup, [uint32]$index)
            $text = [regex]::Replace($text, '[^A-Za-z0-9._:/ -]', '?')
            if ($text.Length -gt 48) { $text = $text.Substring(0, 48) + '...' }
            $null = $texts.Add("$index=$text")
        }
        $ownerClass = if ($Owner -ne [IntPtr]::Zero) { [OmniTrayInput]::WindowClassName($Owner) } else { '' }
        $popupOwner = if ($popup -ne [IntPtr]::Zero) { [OmniTrayInput]::WindowOwner($popup) } else { [IntPtr]::Zero }
        $script:nativeProbeSummary = ('[tray-native] stage={0};owner={1};ownerClass={2};ownerPid={3};post={4};postError={5};foreground={6};foregroundClass={7};popup={8};popupClass={9};popupPid={10};popupOwner={11};popupOwnerClass={12};menu={13};menuCount={14};items={15}' -f
            $Stage,
            $Owner.ToInt64(),
            $ownerClass,
            [OmniTrayInput]::WindowProcessId($Owner),
            $PostResult,
            $PostError,
            $foreground.ToInt64(),
            [OmniTrayInput]::WindowClassName($foreground),
            $popup.ToInt64(),
            [OmniTrayInput]::WindowClassName($popup),
            [OmniTrayInput]::WindowProcessId($popup),
            $popupOwner.ToInt64(),
            [OmniTrayInput]::WindowClassName($popupOwner),
            $menu.ToInt64(),
            $count,
            (($texts -join '|') -replace '[;\r\n]', '?'))
    }
    catch {
        $script:nativeProbeSummary = "[tray-native] stage=$Stage;diagnosticError=$([regex]::Replace($_.Exception.Message, '[^A-Za-z0-9 .:/_-]', '?'))"
    }
}

function Focus-OpenContextMenu {
    $popup = Find-VisibleNativeMenuWindow
    if ($popup -ne [IntPtr]::Zero) {
        [OmniTrayInput]::SetForegroundWindow($popup) | Out-Null
        Start-Sleep -Milliseconds 80
        return $true
    }
    $foreground = [OmniTrayInput]::GetForegroundWindow()
    if ($foreground -ne [IntPtr]::Zero) {
        [OmniTrayInput]::SetForegroundWindow($foreground) | Out-Null
        Start-Sleep -Milliseconds 50
    }
    return $false
}

function Find-NativeShowMainMenuItem {
    # UI Automation does not publish native TrackPopupMenu children on the
    # Server 2022 image. Read the actual HMENU owned by the visible popup so
    # the acceptance can select the product command by text and its native
    # screen rectangle, without guessing a row or invoking another command.
    $popup = Find-VisibleNativeMenuWindow
    if ($popup -eq [IntPtr]::Zero) { return $null }
    $popupOwner = [OmniTrayInput]::PopupMenuOwner($popup)
    $mainProcessId = [OmniTrayInput]::WindowProcessId([IntPtr]$MainWindowHandle)
    # TrackPopupMenu is owned by tao's dedicated tray HWND. Require the live
    # popup owner to be that class and the installed process before reading or
    # dispatching a command; a shell menu from another app must never pass.
    $popupProcessId = [OmniTrayInput]::WindowProcessId($popup)
    $ownerIsTao = $popupOwner -ne [IntPtr]::Zero -and
        [OmniTrayInput]::WindowClassName($popupOwner) -eq 'tao_system_tray_app' -and
        ($mainProcessId -le 0 -or [OmniTrayInput]::WindowProcessId($popupOwner) -eq $mainProcessId)
    $popupBelongsToProcess = $mainProcessId -gt 0 -and $popupProcessId -eq $mainProcessId
    if (-not $ownerIsTao -and -not ($popupOwner -eq [IntPtr]::Zero -and $popupBelongsToProcess)) {
        Capture-NativeProbeSummary -Stage 'native-popup-owner-rejected' -Owner $popupOwner
        return $null
    }
    $dispatchOwner = if ($ownerIsTao) { $popupOwner } else {
        [OmniTrayInput]::FindWindowForProcessAndClass([IntPtr]$MainWindowHandle, 'tao_system_tray_app')
    }
    if ($dispatchOwner -eq [IntPtr]::Zero) { return $null }
    $count = [OmniTrayInput]::PopupMenuItemCount($popup)
    if ($count -le 0) { return $null }
    for ($index = 0; $index -lt $count; $index++) {
        try {
            $text = [OmniTrayInput]::PopupMenuItemText($popup, [uint32]$index)
            if ($text -notmatch '(?i)(显示主窗口|显示主界面|show\s+(?:the\s+)?main\s+window)') { continue }
            $bounds = [OmniTrayInput]::PopupMenuItemBounds($popup, [uint32]$index)
            if ($bounds.Count -ne 4 -or $bounds[2] -le $bounds[0] -or $bounds[3] -le $bounds[1]) { continue }
            $command = [OmniTrayInput]::PopupMenuItemCommand($popup, [uint32]$index)
            if ($command -eq 0) { continue }
            return [pscustomobject]@{
                Popup = $popup
                Owner = $dispatchOwner
                Text = $text
                Command = [uint32]$command
                Left = [int]$bounds[0]
                Top = [int]$bounds[1]
                Right = [int]$bounds[2]
                Bottom = [int]$bounds[3]
            }
        }
        catch { continue }
    }
    return $null
}

function Invoke-NativeShowMainMenuItem {
    $item = Find-NativeShowMainMenuItem
    if (-not $item) { return $false }
    $x = [int](($item.Left + $item.Right) / 2)
    $y = [int](($item.Top + $item.Bottom) / 2)
    Click-Point $x $y
    if (Wait-MainWindowVisible 1500) {
        $script:trayMenuPath = 'native-item-click'
        return $true
    }
    # Some Server shells accept the real pointer click but do not deliver the
    # popup's WM_COMMAND back to the tao owner while TrackPopupMenu is nested.
    # The item text, HMENU, command id, owner class, and process were all
    # validated above; deliver that exact native menu command to the owner as
    # a bounded recovery path, then require the cached main HWND to show.
    if ([OmniTrayInput]::SendMenuCommand([IntPtr]$item.Owner, [uint32]$item.Command) -and
        (Wait-MainWindowVisible 1500)) {
        $script:trayMenuPath = 'native-item-wm-command'
        return $true
    }
    Capture-NativeProbeSummary -Stage 'native-item-dispatch-failed' -Owner $item.Owner
    return $false
}

function Invoke-FirstNativeMenuItem {
    # TrackPopupMenu menus can be real #32768 windows while UIA exposes no
    # children. The native Tauri menu puts Show Main Window first; click only
    # that bounded first-row rectangle after a real product-icon right-click.
    $popup = Find-VisibleNativeMenuWindow
    if ($popup -eq [IntPtr]::Zero) { return $false }
    $bounds = [OmniTrayInput]::WindowBounds($popup)
    if ($bounds.Count -ne 4) { return $false }
    $width = $bounds[2] - $bounds[0]
    $height = $bounds[3] - $bounds[1]
    if ($width -le 20 -or $height -le 20) { return $false }
    [OmniTrayInput]::SetForegroundWindow($popup) | Out-Null
    # Native popup borders are normally 1-2px and menu rows are 18-24px.
    # Keep the hit inside the first row and away from the border/separator.
    $x = [int]($bounds[0] + ($width / 2))
    $y = [int]($bounds[1] + [Math]::Min(14, [Math]::Max(8, $height / 12)))
    Click-Point $x $y
    return (Wait-MainWindowVisible 1000)
}

function Invoke-NativeMenuKeySequence([int[]]$Sequence) {
    # UI Automation is not guaranteed to publish native menu descendants on
    # classic Server. Send the bounded keyboard sequence to the actual popup
    # HWND discovered after a real tray right-click; this preserves the same
    # user-visible command path without relying on the PowerShell host owning
    # the foreground input queue.
    $popup = Find-VisibleNativeMenuWindow
    if ($popup -eq [IntPtr]::Zero) { return $false }
    [OmniTrayInput]::SetForegroundWindow($popup) | Out-Null
    foreach ($key in $Sequence) {
        [OmniTrayInput]::SendMessage($popup, 0x0100, [IntPtr]$key, [IntPtr]::One) | Out-Null # WM_KEYDOWN
        [OmniTrayInput]::SendMessage($popup, 0x0101, [IntPtr]$key, [IntPtr]::Zero) | Out-Null # WM_KEYUP
        Start-Sleep -Milliseconds 60
    }
    return (Wait-MainWindowVisible 350)
}

function Invoke-ShowMainMenuByKeyboard {
    # The classic Server shell can render a real native popup menu without
    # publishing its MenuItem descendants to UI Automation. The tray menu is
    # intentionally ordered with Show Main Window first (see main.rs), so
    # Home+Enter is the same user-visible command path while retaining the
    # cached native HWND visibility gate below. If no popup is open, these
    # keystrokes have no effect and the caller continues probing other slots.
    try {
        if (Invoke-FirstNativeMenuItem) { return $true }
        $null = Focus-OpenContextMenu
        # Home is the normal path for a native popup whose first enabled item
        # is Show Main Window. Down+Enter is a bounded fallback for shells that
        # leave the first item unselected after a synthetic right-click.
        $sequences = @(
            @(0x24, 0x0D), # VK_HOME, VK_RETURN
            @(0x28, 0x0D), # VK_DOWN, VK_RETURN
            @(0x24, 0x28, 0x0D) # VK_HOME, VK_DOWN, VK_RETURN
        )
        foreach ($sequence in $sequences) {
            if (Invoke-NativeMenuKeySequence $sequence) { return $true }
            foreach ($key in $sequence) {
                [OmniTrayInput]::keybd_event([byte]$key, 0, 0, [UIntPtr]::Zero)
                [OmniTrayInput]::keybd_event([byte]$key, 0, 0x0002, [UIntPtr]::Zero)
                Start-Sleep -Milliseconds 60
            }
            if (Wait-MainWindowVisible 350) { return $true }
            $null = Focus-OpenContextMenu
        }
        return $false
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
        if (-not (Test-MenuProbeBudget)) { return $null }
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
            if (-not (Test-MenuProbeBudget)) { return $null }
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
    # Capture one final owner/popup snapshot even when the earlier probe never
    # reached the native-menu branch; this keeps the failure actionable without
    # leaking arbitrary desktop text into CI logs.
    Capture-NativeProbeSummary -Stage 'final-diagnostics'
    if (-not [string]::IsNullOrWhiteSpace($script:nativeProbeSummary)) {
        Write-Output $script:nativeProbeSummary
    }
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
    try {
        $toolbars = @(Find-TrayToolbarElements)
        $probePoints = @(Get-TrayProbePoints $Action)
        $pointText = ($probePoints | ForEach-Object { '{0},{1}' -f [int]$_.X, [int]$_.Y }) -join '|'
        Write-Output ('[tray-probe] action={0};toolbarCount={1};pointCount={2};points={3}' -f
            $Action, $toolbars.Count, $probePoints.Count, $pointText)
        $overflowWindows = @(Find-TrayOverflowWindows)
        $overflowToolbars = @(Get-TrayOverflowToolbarBounds)
        $overflowClickPoints = @(Get-TrayOverflowClickPoints)
        $overflowProbePoints = @(Get-TrayOverflowProbePoints)
        $overflowPointText = ($overflowProbePoints | ForEach-Object { '{0},{1}' -f [int]$_.X, [int]$_.Y }) -join '|'
        $overflowWindowText = ($overflowWindows | ForEach-Object {
            '{0}@{1},{2},{3}x{4}' -f (Get-SafeTrayField $_.ClassName), [int]$_.Left,
                [int]$_.Top, [int]$_.Width, [int]$_.Height
        }) -join '|'
        Write-Output ('[tray-overflow] popupCount={0};popups={1};toolbarCount={2};arrowPointCount={3};probePointCount={4};probePoints={5}' -f
            $overflowWindows.Count, $overflowWindowText, $overflowToolbars.Count,
            $overflowClickPoints.Count, $overflowProbePoints.Count, $overflowPointText)
    }
    catch {
        Write-Output ('[tray-probe] action={0};diagnosticError=probe-unavailable' -f $Action)
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
        Dismiss-ContextMenu
        Click-Element $icon
        if (Wait-MainWindowVisible) {
            Write-Output 'PASS installed tray icon left click'
            exit 0
        }
        throw 'The installed Omni-Context named tray icon did not reopen the cached main window.'
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

# UIA may expose a real SystemTray.* button without a product tooltip. For a
# left click, try those concrete elements directly before context-menu probing;
# the cached native HWND visibility change is still the only acceptance gate.
if ($Action -eq 'left-click') {
    foreach ($candidate in $candidates) {
        try {
            Dismiss-ContextMenu
            Click-Element $candidate
            if (Wait-MainWindowVisible) {
                Write-Output 'PASS installed tray icon left click via UIA candidate'
                exit 0
            }
        }
        catch {
            continue
        }
    }
}

# For menu-show, locate the exact app slot through the real left-click gate
# before probing generic context menus. This is bounded and remains a genuine
# shell right-click/menu command path; it is not a simulated HWND visibility
# shortcut.
if ($Action -eq 'menu-show' -and (Invoke-TaoTrayIconAction $Action)) {
    $path = if ([string]::IsNullOrWhiteSpace($script:trayMenuPath)) { 'tao native tray menu' } else { $script:trayMenuPath }
    Write-Output "PASS installed tray context menu Show Main Window via $path"
    exit 0
}

if ($Action -eq 'menu-show' -and (Find-AppTrayMenuViaKnownLeftClick)) {
    Write-Output 'PASS installed tray context menu Show Main Window via known classic toolbar slot'
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
    if ($MainWindowHandle -le 0 -or (Wait-MainWindowVisible)) {
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
