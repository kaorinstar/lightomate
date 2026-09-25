@echo off
rem Lightomate: download the latest release (or a development branch) and extract it to Lightomate in the Downloads folder.
rem Everything below the marker line is PowerShell; it is read as UTF-8 and run.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = [IO.File]::ReadAllText('%~f0', [Text.Encoding]::UTF8); Invoke-Expression $s.Substring($s.IndexOf('#' + 'PS1') + 4)"
pause
exit /b
#PS1
# ここから下は PowerShell です。コマンドプロンプトは日本語の扱いが不安定なため、処理と表示を
# PowerShell で行います。
#
# GitHub の最新のリリースから lightomate-vX.Y.Z.zip を取得し、「ダウンロード」フォルダーの中の
# Lightomate フォルダーに展開します。「ダウンロード」フォルダーそのものには展開しません。展開の前に
# 展開先の中身を削除するため、ほかのダウンロード済みのファイルを消さないようにするためです。
# 同じフォルダーに展開するため、Chrome には初回に一度だけ読み込めば、以降は［再読み込み］で更新できます。
# 保存したフローは Chrome の中にあり、このフォルダーを入れ替えても失われません。
#
# 実行するとブランチ名を尋ねます（#56）。空のまま Enter を押すと最新のリリースを、ブランチ名を入力すると
# 開発中のブランチの版を展開します。プルリクエストの動作を確認するときに使います。

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Windows に登録された「ダウンロード」の場所です。利用者が D ドライブや OneDrive に移した場合も、
# 実際の場所を返します。取得できない場合は、既定の場所（%USERPROFILE%\Downloads）を使います。
function Get-DownloadsFolder {
  try {
    $path = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path
    if ($path -and (Test-Path -LiteralPath $path)) { return $path }
  } catch { }
  return Join-Path $env:USERPROFILE 'Downloads'
}

$dest = Join-Path (Get-DownloadsFolder) 'Lightomate'
# 作り直す前の v0.1.0 の更新用ファイルの展開先です（#36）。残っている場合は、読み込み直しを案内します。
$oldDest = Join-Path $env:USERPROFILE 'Lightomate'
$headers = @{ 'User-Agent' = 'lightomate-update' }

try {
  Write-Host '展開する版を選びます。'
  Write-Host '  最新のリリース：何も入力せずに Enter を押してください。'
  Write-Host '  開発中の版：依頼文に記載したブランチ名（例：feat/54-stop-rules）を入力して Enter を押してください。'
  $branch = (Read-Host 'ブランチ名').Trim()
  # ブランチ名は URL に組み込むため、使える文字を英数字と / - _ . に限ります。
  if ($branch -and (($branch -notmatch '^[A-Za-z0-9._/-]+$') -or ($branch -match '\.\.'))) {
    throw "ブランチ名「$branch」に使えない文字が含まれています。フォルダーは変更していません。"
  }

  $work = Join-Path ([IO.Path]::GetTempPath()) ('lightomate-' + [Guid]::NewGuid())
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    if ($branch) {
      $label = "ブランチ $branch の開発中の版"
      $zipName = 'branch.zip'
      $url = "https://github.com/kaorinstar/lightomate/archive/refs/heads/$branch.zip"
    } else {
      Write-Host '最新のリリースを確認しています。'
      $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/kaorinstar/lightomate/releases/latest' -Headers $headers -UseBasicParsing
      $label = "リリース $($release.tag_name)"
      $zipName = "lightomate-$($release.tag_name).zip"
      $asset = $release.assets | Where-Object { $_.name -eq $zipName } | Select-Object -First 1
      if (-not $asset) { throw "リリース $($release.tag_name) に $zipName が添付されていません。" }
      $url = $asset.browser_download_url
    }

    Write-Host "$($label)をダウンロードしています。"
    $zip = Join-Path $work $zipName
    try {
      Invoke-WebRequest -Uri $url -OutFile $zip -Headers $headers -UseBasicParsing
    } catch {
      if ($branch) { throw "ブランチ $branch をダウンロードできませんでした。ブランチ名を確認してください。フォルダーは変更していません。" }
      throw
    }
    $expanded = Join-Path $work 'expanded'
    Expand-Archive -Path $zip -DestinationPath $expanded
    if ($branch) {
      # ブランチの ZIP は、リポジトリ全体を 1 つのフォルダー（lightomate-<ブランチ名>）にまとめたものです。
      # その中の extension フォルダーだけを展開先に置きます。
      $unpacked = Get-ChildItem -LiteralPath $expanded -Directory |
        ForEach-Object { Join-Path $_.FullName 'extension' } |
        Where-Object { Test-Path (Join-Path $_ 'manifest.json') } |
        Select-Object -First 1
      if (-not $unpacked) { throw "ブランチ $branch に extension\manifest.json がありません。フォルダーは変更していません。" }
    } else {
      $unpacked = $expanded
      if (-not (Test-Path (Join-Path $unpacked 'manifest.json'))) { throw "$zipName に manifest.json がありません。" }
    }

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
      New-Item -ItemType Directory -Path $dest -Force | Out-Null
    }
    Copy-Item -Path (Join-Path $unpacked '*') -Destination $dest -Recurse -Force
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }

  Write-Host ''
  Write-Host "Lightomate の$($label)を次のフォルダーに展開しました。"
  Write-Host "  $dest"
  Write-Host ''
  Write-Host '更新の場合：chrome://extensions を開き、Lightomate の［再読み込み］ボタンを押してください。'
  Write-Host '初めての場合：chrome://extensions で［パッケージ化されていない拡張機能を読み込む］を押し、上のフォルダーを選んでください。'
  if ($branch) {
    Write-Host ''
    Write-Host '開発中の版には、確認中の変更が含まれます。確認が終わったら、このファイルをもう一度実行し、' -ForegroundColor Yellow
    Write-Host '何も入力せずに Enter を押して、最新のリリースに戻してください。' -ForegroundColor Yellow
  }
  if (Test-Path -LiteralPath (Join-Path $oldDest 'manifest.json')) {
    Write-Host ''
    Write-Host "以前の展開先（$oldDest）が残っています。" -ForegroundColor Yellow
    Write-Host '以前の展開先を読み込んでいた場合は、［削除］を押さずに、［パッケージ化されていない拡張機能を読み込む］で' -ForegroundColor Yellow
    Write-Host '上のフォルダーを選び直してください。保存したフローは残ります。読み込み直した後、以前の展開先は削除できます。' -ForegroundColor Yellow
  }
} catch {
  Write-Host ''
  Write-Host "失敗しました：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
