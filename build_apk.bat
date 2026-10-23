@echo off
setlocal enabledelayedexpansion

rem Build from the directory containing this script. No checkout-specific
rem absolute paths are required, so the repository can be moved elsewhere.
set "ROOT_DIR=%~dp0"
set "ANDROID_DIR=%ROOT_DIR%android"
set "PUBLIC_DIR=%ANDROID_DIR%\app\src\main\assets\public"
set "WWW_DIR=%ROOT_DIR%www"
set "LICENSES_DIR=%ROOT_DIR%licenses"

echo ===================================================
echo [1/4] Configuring optional JDK 17 Environment
echo ===================================================
if not defined JAVA_HOME (
    if exist "%ROOT_DIR%bak\jdk17\jdk-17.0.10+7\bin\java.exe" set "JAVA_HOME=%ROOT_DIR%bak\jdk17\jdk-17.0.10+7"
)
if not defined JAVA_HOME (
    echo [ERROR] JDK 17 is required. Set JAVA_HOME to a JDK 17 installation.
    exit /b 1
)
if not exist "%JAVA_HOME%\bin\java.exe" (
    echo [ERROR] JAVA_HOME does not point to a valid JDK: %JAVA_HOME%
    exit /b 1
)
set "PATH=%JAVA_HOME%\bin;%PATH%"
echo JAVA_HOME: %JAVA_HOME%
"%JAVA_HOME%\bin\java.exe" -version
if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] Unable to execute the configured JDK.
    exit /b 1
)

echo.
echo ===================================================
echo [2/4] Syncing Web Assets to Android Project
echo ===================================================
if not exist "%PUBLIC_DIR%\js" mkdir "%PUBLIC_DIR%\js"
if not exist "%PUBLIC_DIR%\css" mkdir "%PUBLIC_DIR%\css"
if not exist "%PUBLIC_DIR%\webfonts" mkdir "%PUBLIC_DIR%\webfonts"
if not exist "%PUBLIC_DIR%\licenses" mkdir "%PUBLIC_DIR%\licenses"
if not exist "%WWW_DIR%\js" mkdir "%WWW_DIR%\js"
if not exist "%WWW_DIR%\css" mkdir "%WWW_DIR%\css"
if not exist "%WWW_DIR%\webfonts" mkdir "%WWW_DIR%\webfonts"
if not exist "%WWW_DIR%\licenses" mkdir "%WWW_DIR%\licenses"

copy /y "%ROOT_DIR%index.html" "%PUBLIC_DIR%\index.html" >nul
if errorlevel 1 (echo [ERROR] Failed to copy index.html to Android assets.& exit /b 2)
copy /y "%ROOT_DIR%style.css" "%PUBLIC_DIR%\style.css" >nul
if errorlevel 1 (echo [ERROR] Failed to copy style.css to Android assets.& exit /b 2)
copy /y "%ROOT_DIR%capacitor.config.json" "%ANDROID_DIR%\app\src\main\assets\capacitor.config.json" >nul
if errorlevel 1 (echo [ERROR] Failed to copy Capacitor configuration to Android assets.& exit /b 2)
xcopy /y /e /i "%ROOT_DIR%js\*" "%PUBLIC_DIR%\js\" >nul
if errorlevel 1 (echo [ERROR] Failed to copy JavaScript assets to Android assets.& exit /b 2)
xcopy /y /e /i "%ROOT_DIR%css\*" "%PUBLIC_DIR%\css\" >nul
if errorlevel 1 (echo [ERROR] Failed to copy CSS assets to Android assets.& exit /b 2)
xcopy /y /e /i "%ROOT_DIR%webfonts\*" "%PUBLIC_DIR%\webfonts\" >nul
if errorlevel 1 (echo [ERROR] Failed to copy fonts to Android assets.& exit /b 2)
xcopy /y /e /i "%LICENSES_DIR%\*" "%PUBLIC_DIR%\licenses\" >nul
if errorlevel 1 (echo [ERROR] Failed to copy third-party licenses to Android assets.& exit /b 2)

rem Capacitor webDir is www; keep this tracked copy in lockstep with root sources.
copy /y "%ROOT_DIR%index.html" "%WWW_DIR%\index.html" >nul
if errorlevel 1 (echo [ERROR] Failed to copy index.html to www.& exit /b 2)
copy /y "%ROOT_DIR%style.css" "%WWW_DIR%\style.css" >nul
if errorlevel 1 (echo [ERROR] Failed to copy style.css to www.& exit /b 2)
xcopy /y /e /i "%ROOT_DIR%js\*" "%WWW_DIR%\js\" >nul
if errorlevel 1 (echo [ERROR] Failed to copy JavaScript assets to www.& exit /b 2)
xcopy /y /e /i "%ROOT_DIR%css\*" "%WWW_DIR%\css\" >nul
if errorlevel 1 (echo [ERROR] Failed to copy CSS assets to www.& exit /b 2)
xcopy /y /e /i "%ROOT_DIR%webfonts\*" "%WWW_DIR%\webfonts\" >nul
if errorlevel 1 (echo [ERROR] Failed to copy fonts to www.& exit /b 2)
xcopy /y /e /i "%LICENSES_DIR%\*" "%WWW_DIR%\licenses\" >nul
if errorlevel 1 (echo [ERROR] Failed to copy third-party licenses to www.& exit /b 2)

echo.
echo ===================================================
echo [3/4] Building Signed Release APK
echo ===================================================
pushd "%ANDROID_DIR%"
call gradlew.bat clean assembleRelease --no-build-cache --no-daemon
set "BUILD_EXIT=%ERRORLEVEL%"
popd
if !BUILD_EXIT! NEQ 0 (
    echo [ERROR] Gradle release build failed with error %BUILD_EXIT%.
    exit /b %BUILD_EXIT%
)

echo.
echo ===================================================
echo [4/4] Verifying Release Output
echo ===================================================
set "OUT_APK=%ANDROID_DIR%\app\build\outputs\apk\release\app-release.apk"
if not exist "%OUT_APK%" (
    echo [ERROR] A signed release APK was not produced.
    echo         Configure releaseStoreFile/releaseStorePassword/releaseKeyAlias/releaseKeyPassword
    echo         in user Gradle properties or RELEASE_* environment variables.
    echo         Debug builds are intentionally not copied as release APKs.
    exit /b 3
)

rem Enforce the pinned release certificate, version and package from app-release.json.
rem Preserve the original v1.0 APK; new outputs belong in dist-release.
pushd "%ROOT_DIR%"
node tools/generate-update.mjs "%OUT_APK%" "dist-release"
set "VERIFY_EXIT=!ERRORLEVEL!"
popd
if !VERIFY_EXIT! NEQ 0 (
    echo [ERROR] Release verification failed. No verified release was exported.
    exit /b !VERIFY_EXIT!
)
echo [SUCCESS] Verified APK and update manifest exported to %ROOT_DIR%dist-release
exit /b 0
