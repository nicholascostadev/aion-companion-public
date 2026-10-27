param([ValidateSet('patch','minor','major')][string]$Bump='patch')
$ErrorActionPreference='Stop'
$source=$env:RELEASE_SOURCE
if($source -notmatch '^(pr|manual)-[0-9]+$'){throw 'Invalid release source'}
function Invoke-RepoGit {
    $output=& git @args
    if($LASTEXITCODE -ne 0){throw "Git command failed: $($args[0])"}
    return $output
}
function Output-Release($version,$commit) {
    "version=$version" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
    "tag=v$version" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
    "commit=$commit" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
}
Invoke-RepoGit config user.name 'github-actions[bot]'
Invoke-RepoGit config user.email '41898282+github-actions[bot]@users.noreply.github.com'
if($env:GITHUB_EVENT_NAME -eq 'pull_request') {
    $event=Get-Content -LiteralPath $env:GITHUB_EVENT_PATH -Raw | ConvertFrom-Json
    $labels=@($event.pull_request.labels | ForEach-Object {$_.name})
    if('release:major' -in $labels){$Bump='major'}
    elseif('release:minor' -in $labels){$Bump='minor'}
}
for($attempt=1;$attempt -le 5;$attempt++) {
    Invoke-RepoGit fetch origin master --tags
    $existing=@(Invoke-RepoGit log origin/master --format=%H "--grep=^Release-Source: $source`$" -1)
    if($existing.Count -gt 0) {
        $commit=$existing[0]
        $manifest=(Invoke-RepoGit show "${commit}:package.json") -join "`n" | ConvertFrom-Json
        $version=$manifest.version
        $tagCommit=Invoke-RepoGit rev-list -n 1 "v$version"
        if($tagCommit -ne $commit){throw 'Existing release tag does not match its version commit'}
        Output-Release $version $commit
        exit 0
    }
    Invoke-RepoGit checkout -B release-work origin/master
    $version=& node scripts/release-version.mjs --bump $Bump
    if($LASTEXITCODE -ne 0){throw 'Version bump failed'}
    Invoke-RepoGit add -- package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock
    Invoke-RepoGit commit -m "chore(release): v$version" -m "Release-Source: $source"
    $commit=Invoke-RepoGit rev-parse HEAD
    # Atomic reservation means a newer master push cannot leave only half a release.
    & git push --atomic origin 'HEAD:refs/heads/master' "HEAD:refs/tags/v$version"
    if($LASTEXITCODE -eq 0){Output-Release $version $commit;exit 0}
    if($attempt -eq 5){throw 'Master kept changing; rerun this release workflow'}
    Start-Sleep -Seconds 2
}
