import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

test('Windows registry reader preserves Unicode and represents absent or non-string values as null', { skip: process.platform !== 'win32' }, () => {
    const reader = fileURLToPath(new URL('../windows/read-registration.ps1', import.meta.url)).replaceAll("'", "''");
    const subkey = `Software\\Jtcrpa\\McpBridgeTests\\${randomUUID()}`;
    const expected = 'I:\\验收 路径\\chrome.json';
    const script = `
$ErrorActionPreference = 'Stop'
$testSubkey = '${subkey}'
$key = $null
try {
    & '${reader}' -RegistryPath $testSubkey
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($testSubkey)
    & '${reader}' -RegistryPath $testSubkey
    $key.SetValue('', '${expected}', [Microsoft.Win32.RegistryValueKind]::String)
    & '${reader}' -RegistryPath $testSubkey
    $key.SetValue('', 123, [Microsoft.Win32.RegistryValueKind]::DWord)
    & '${reader}' -RegistryPath $testSubkey
} finally {
    if ($null -ne $key) { $key.Dispose() }
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($testSubkey, $false)
}`;
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true });
    assert.deepEqual(output.trim().split(/\r?\n/).map((line) => JSON.parse(line)), [null, null, expected, null]);
});
