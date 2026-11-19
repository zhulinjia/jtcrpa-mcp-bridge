param([Parameter(Mandatory=$true)][string]$RegistryPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($RegistryPath)
$value = $null
try {
    if ($null -ne $key) {
        $stored = $key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($null -ne $stored -and $key.GetValueKind('') -eq [Microsoft.Win32.RegistryValueKind]::String) {
            $value = $stored
        }
    }
    if ($null -eq $value) { [Console]::WriteLine('null') }
    else { [Console]::WriteLine((ConvertTo-Json -InputObject $value -Compress)) }
} finally {
    if ($null -ne $key) { $key.Dispose() }
}
