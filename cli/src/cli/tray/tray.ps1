# kRouter tray icon for Windows using NotifyIcon
# IPC: stdin JSON commands, stdout JSON events
param([string]$IconPath, [string]$Tooltip)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$script:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$script:notifyIcon.Icon = New-Object System.Drawing.Icon($IconPath)
$script:notifyIcon.Text = $Tooltip
$script:notifyIcon.Visible = $true

$script:menu = New-Object System.Windows.Forms.ContextMenuStrip
$script:notifyIcon.ContextMenuStrip = $script:menu
$script:items = @()

function Write-Event($obj) {
  $json = $obj | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Add-MenuItem($index, $title, $enabled) {
  $item = New-Object System.Windows.Forms.ToolStripMenuItem
  $item.Text = $title
  $item.Enabled = $enabled
  $idx = $index
  $item.Add_Click({ Write-Event @{ type = "click"; index = $idx } }.GetNewClosure())
  $script:menu.Items.Add($item) | Out-Null
  $script:items += $item
}

function Update-MenuItem($index, $title, $enabled) {
  if ($index -lt $script:items.Count) {
    $script:items[$index].Text = $title
    $script:items[$index].Enabled = $enabled
  }
}

function Set-Tooltip($text) {
  # NotifyIcon.Text max 63 chars
  if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
  $script:notifyIcon.Text = $text
}

# stdin is polled from a System.Windows.Forms.Timer, whose Tick runs on the very
# thread Application::Run() pumps. The previous loop guarded on [Console]::In.Peek(),
# which does not return -1 on an open-but-idle pipe -- it blocks until the next byte
# arrives. So the first tick after the startup burst never returned, the message pump
# stopped, and the tray icon appeared but ignored every click: no menu, no Quit.
#
# [Console]::In is a SyncTextReader whose ReadLineAsync() is synchronous too, so it
# cannot be used either. Read the raw handle through our own StreamReader and poll a
# genuinely async task, so the Tick handler always returns immediately.
$script:stdin   = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$script:pending = $null

$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = 100
$script:timer.Add_Tick({
  try {
    if ($null -eq $script:pending) { $script:pending = $script:stdin.ReadLineAsync() }
    while ($script:pending.IsCompleted) {
      $line = $script:pending.Result
      $script:pending = $null
      if ($null -eq $line) {
        # EOF: the Node parent is gone. Exit instead of lingering as a dead icon the
        # user can only clear through Task Manager.
        $script:notifyIcon.Visible = $false
        $script:notifyIcon.Dispose()
        [System.Windows.Forms.Application]::Exit()
        return
      }
      if (-not [string]::IsNullOrWhiteSpace($line)) {
        $cmd = $line | ConvertFrom-Json
        switch ($cmd.action) {
          "add-item"    { Add-MenuItem $cmd.index $cmd.title $cmd.enabled }
          "update-item" { Update-MenuItem $cmd.index $cmd.title $cmd.enabled }
          "set-tooltip" { Set-Tooltip $cmd.text }
          "ready"       { Write-Event @{ type = "ready" } }
          "kill"        {
            $script:notifyIcon.Visible = $false
            $script:notifyIcon.Dispose()
            [System.Windows.Forms.Application]::Exit()
            return
          }
        }
      }
      $script:pending = $script:stdin.ReadLineAsync()
    }
  } catch {
    Write-Event @{ type = "error"; message = $_.Exception.Message }
  }
})
$script:timer.Start()

Write-Event @{ type = "started" }
[System.Windows.Forms.Application]::Run()
