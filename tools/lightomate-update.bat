@echo off
rem Lightomate: download the latest release and extract it to %USERPROFILE%\Lightomate.
rem Everything below the marker line is PowerShell; it is read as UTF-8 and run.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = [IO.File]::ReadAllText('%~f0', [Text.Encoding]::UTF8); Invoke-Expression $s.Substring($s.IndexOf('#' + 'PS1') + 4)"
pause
exit /b
#PS1
# ここから下は PowerShell です。コマンドプロンプトは日本語の扱いが不安定なため、処理と表示を
# PowerShell で行います。
#
# GitHub の最新のリリースから lightomate-vX.Y.Z.zip を取得し、%USERPROFILE%\Lightomate に展開します。
# 同じフォルダーに展開するため、Chrome には初回に一度だけ読み込めば、以降は［再読み込み］で更新できます。
# 保存したフローは Chrome の中にあり、このフォルダーを入れ替えても失われません。

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$dest = Join-Path $env:USERPROFILE 'Lightomate'
$headers = @{ 'User-Agent' = 'lightomate-update' }

try {
  Write-Host '最新のリリースを確認しています。'
  $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/kaorinstar/lightomate/releases/latest' -Headers $headers -UseBasicParsing
  $zipName = "lightomate-$($release.tag_name).zip"
  $asset = $release.assets | Where-Object { $_.name -eq $zipName } | Select-Object -First 1
  if (-not $asset) { throw "リリース $($release.tag_name) に $zipName が添付されていません。" }

  $work = Join-Path ([IO.Path]::GetTempPath()) ('lightomate-' + [Guid]::NewGuid())
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    Write-Host "$zipName をダウンロードしています。"
    $zip = Join-Path $work $zipName
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -Headers $headers -UseBasicParsing
    $unpacked = Join-Path $work 'extension'
    Expand-Archive -Path $zip -DestinationPath $unpacked
    if (-not (Test-Path (Join-Path $unpacked 'manifest.json'))) { throw "$zipName に manifest.json がありません。" }

    # 展開先に Lightomate 以外のファイルがある場合は中止します。利用者のファイルを消さないためです。
    if (Test-Path $dest) {
      $manifestPath = Join-Path $dest 'manifest.json'
      $isLightomate = (Test-Path $manifestPath) -and
        ((Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json).name -eq 'Lightomate')
      $isEmpty = -not (Get-ChildItem -LiteralPath $dest -Force | Select-Object -First 1)
      if (-not ($isLightomate -or $isEmpty)) {
        throw "$dest に Lightomate 以外のファイルがあるため、中止しました。フォルダーの中身を確認してください。"
      }
      # 古い版のファイルを残さないよう、中身を入れ替えます。
      Get-ChildItem -LiteralPath $dest -Force | Remove-Item -Recurse -Force
    } else {
      New-Item -ItemType Directory -Path $dest | Out-Null
    }
    Copy-Item -Path (Join-Path $unpacked '*') -Destination $dest -Recurse -Force
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }

  Write-Host ''
  Write-Host "Lightomate $($release.tag_name) を次のフォルダーに展開しました。"
  Write-Host "  $dest"
  Write-Host ''
  Write-Host '更新の場合：chrome://extensions を開き、Lightomate の［再読み込み］ボタンを押してください。'
  Write-Host '初めての場合：chrome://extensions で［パッケージ化されていない拡張機能を読み込む］を押し、上のフォルダーを選んでください。'
} catch {
  Write-Host ''
  Write-Host "失敗しました：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
