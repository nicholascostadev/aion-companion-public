$ErrorActionPreference = 'Stop'
Start-Process -FilePath (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AionCompanionDev/Aion Companion Dev.exe') -ArgumentList '--standalone' -WindowStyle Hidden
