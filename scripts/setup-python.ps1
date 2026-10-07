$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsDirectory = Join-Path $projectRoot '.tools'
$pythonDirectory = Join-Path $toolsDirectory 'python'
$pythonExecutable = Join-Path $pythonDirectory 'python.exe'
New-Item -ItemType Directory -Path $toolsDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    $archive = Join-Path $toolsDirectory 'python.zip'
    Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.13.7/python-3.13.7-embed-amd64.zip' -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $pythonDirectory -Force
}
$pathConfiguration = Join-Path $pythonDirectory 'python313._pth'
(Get-Content -LiteralPath $pathConfiguration) -replace '#import site', 'import site' | Set-Content -LiteralPath $pathConfiguration -Encoding ASCII
if (-not (Test-Path -LiteralPath (Join-Path $pythonDirectory 'Lib\site-packages\pip\__init__.py'))) {
    $pipInstaller = Join-Path $toolsDirectory 'get-pip.py'
    Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $pipInstaller
    & $pythonExecutable $pipInstaller --no-warn-script-location
    if ($LASTEXITCODE -ne 0) { throw 'pip setup failed' }
}
& $pythonExecutable -m pip install -r (Join-Path $projectRoot 'parser\requirements.txt') --no-warn-script-location
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed' }
$parserDirectory = Join-Path $toolsDirectory 'fc26-save-parser'
if (-not (Test-Path -LiteralPath $parserDirectory)) {
    git clone 'https://github.com/mhirst1992/fc26-save-parser.git' $parserDirectory
    if ($LASTEXITCODE -ne 0) { throw 'FC26 decoder download failed' }
    git -C $parserDirectory checkout --detach '6c4e89a8ec15bf5aa23c11e58182500d8fb71f3d'
    if ($LASTEXITCODE -ne 0) { throw 'Could not pin the FC26 decoder revision' }
}
Write-Host 'Local Python, Pillow and FC26 decoder are ready. Run npm.cmd run doctor.'
