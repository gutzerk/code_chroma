# Deprecated forwarder: the Windows installer now lives in distribution/install.ps1.
# Options (-Silent -Force -Uninstall -Purge) are passed through.
$ErrorActionPreference = 'Stop'
Write-Warning 'install_desktop.ps1 is deprecated; forwarding to distribution/install.ps1'
$source = Invoke-RestMethod 'https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.ps1'
& ([scriptblock]::Create($source)) @args
