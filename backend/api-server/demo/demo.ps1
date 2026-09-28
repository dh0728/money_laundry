param(
    [ValidateSet('start', 'stop', 'status')][string]$Action = 'start',
    [string]$DataDir = $env:AML_DEMO_DATA_DIR,
    [string]$Docker = 'docker',
    [string]$Project = 'aml-demo',
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
if ($Project -notmatch '^aml-demo(?:-[a-z0-9]+)*$') { throw 'Project must be aml-demo or aml-demo-<suffix>.' }
if (-not (Get-Command $Docker -ErrorAction SilentlyContinue)) {
    $dockerCandidate = Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe'
    if (Test-Path -LiteralPath $dockerCandidate) { $Docker = $dockerCandidate }
    else { throw 'Docker Desktop CLI was not found.' }
}
$composePath = Join-Path $PSScriptRoot 'compose.demo.yaml'
if ($Action -eq 'start') {
    if (-not $DataDir) { throw 'Supply -DataDir with the prepared daily bank file directory.' }
    $resolvedData = (Resolve-Path -LiteralPath $DataDir).Path
    if (-not (Test-Path -LiteralPath $resolvedData -PathType Container)) { throw 'DataDir must be a directory.' }
    $env:AML_DEMO_DATA_DIR = $resolvedData.Replace('\', '/')
} elseif (-not $env:AML_DEMO_DATA_DIR) {
    # Compose interpolation only; stop/status never creates mounts or containers.
    $env:AML_DEMO_DATA_DIR = $PSScriptRoot.Replace('\', '/')
}
$composeArgs = @('compose', '-p', $Project, '-f', $composePath)
if ($Action -eq 'start') {
    & $Docker @composeArgs config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Compose configuration failed.' }
    & $Docker @composeArgs build api inference view
    if ($LASTEXITCODE -ne 0) { throw 'Demo image build failed.' }
    & $Docker @composeArgs up -d --wait --wait-timeout 180
    if ($LASTEXITCODE -ne 0) {
        & $Docker @composeArgs ps -a
        throw 'Demo startup failed. Run compose logs for the failed service; saved data is preserved.'
    }
    $viewPort = if ($env:AML_DEMO_VIEW_PORT) { $env:AML_DEMO_VIEW_PORT } else { '8501' }
    $controlPort = if ($env:AML_DEMO_CONTROL_PORT) { $env:AML_DEMO_CONTROL_PORT } else { '8502' }
    Write-Output "Controls: http://127.0.0.1:$controlPort"
    Write-Output "Results: http://127.0.0.1:$viewPort"
    if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$controlPort" -WindowStyle Hidden }
} elseif ($Action -eq 'stop') {
    & $Docker @composeArgs down
    if ($LASTEXITCODE -ne 0) { throw 'Demo shutdown failed.' }
    Write-Output 'Stopped. DB, objects, inference state and keys are preserved in Docker volumes.'
} else {
    & $Docker @composeArgs ps -a
    if ($LASTEXITCODE -ne 0) { throw 'Could not read demo status.' }
}
