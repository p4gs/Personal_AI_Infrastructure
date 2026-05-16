@echo off
:: PAI Bootstrap for Windows
:: Finds git bash and runs install.sh. Installs Git via winget if needed.

setlocal EnableDelayedExpansion
set SCRIPT_DIR=%~dp0

:: ── Locate bash ──────────────────────────────────────────────────────────────
set BASH_EXE=

:: Check Git for Windows locations FIRST — WSL bash (C:\Windows\System32\bash.exe)
:: may appear on PATH but cannot run native Windows tools (schtasks, reg, etc.)
if exist "%PROGRAMFILES%\Git\bin\bash.exe"          set BASH_EXE=%PROGRAMFILES%\Git\bin\bash.exe          & goto :found_bash
if exist "%PROGRAMFILES(X86)%\Git\bin\bash.exe"     set BASH_EXE=%PROGRAMFILES(X86)%\Git\bin\bash.exe     & goto :found_bash
if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" set BASH_EXE=%LOCALAPPDATA%\Programs\Git\bin\bash.exe  & goto :found_bash

:: Fall back to PATH — only if the found bash is NOT the WSL stub
where bash >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('where bash 2^>nul') do (
        :: Skip C:\Windows\System32\bash.exe (WSL stub)
        echo %%i | findstr /i "System32\bash.exe" >nul 2>&1
        if errorlevel 1 (
            set BASH_EXE=%%i
            goto :found_bash
        )
    )
)

:: ── No bash — install Git for Windows via winget ─────────────────────────────
echo [PAI Bootstrap] Git Bash not found. Installing Git for Windows via winget...
where winget >nul 2>&1
if %errorlevel% neq 0 (
    echo [PAI Bootstrap] ERROR: winget not found.
    echo   Install Git for Windows from: https://git-scm.com/download/win
    echo   Then re-run this script.
    pause
    exit /b 1
)

winget install --id Git.Git --source winget --silent --accept-package-agreements --accept-source-agreements
if %errorlevel% neq 0 (
    echo [PAI Bootstrap] WARNING: winget install may have failed or Git was already installed.
)

:: Re-check after install
if exist "%PROGRAMFILES%\Git\bin\bash.exe"       set BASH_EXE=%PROGRAMFILES%\Git\bin\bash.exe       & goto :found_bash
if exist "%PROGRAMFILES(X86)%\Git\bin\bash.exe"  set BASH_EXE=%PROGRAMFILES(X86)%\Git\bin\bash.exe  & goto :found_bash

echo [PAI Bootstrap] ERROR: Could not find bash even after installing Git.
echo   Please install Git for Windows manually: https://git-scm.com/download/win
echo   Then run:  bash install.sh
pause
exit /b 1

:found_bash
echo [PAI Bootstrap] Using bash: %BASH_EXE%
cd /d "%SCRIPT_DIR%"
"%BASH_EXE%" install.sh %*
exit /b %errorlevel%
