@echo off
setlocal enabledelayedexpansion

rem Build from the directory containing this script. No checkout-specific
rem absolute paths are required, so the repository can be moved elsewhere.
set "ROOT_DIR=%~dp0"
set "ANDROID_DIR=%ROOT_DIR%android"
set "PUBLIC_DIR=%ANDROID_DIR%\app\src\main\assets\public"
set "WWW_DIR=%ROOT_DIR%www"

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
if not exist "%WWW_DIR%\js" mkdir "%WWW_DIR%\js"
if not exist "%WWW_DIR%\css" mkdir "%WWW_DIR%\css"
if not exist "%WWW_DIR%\webfonts" mkdir "%WWW_DIR%\webfonts"

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

rem Existence alone is not proof of a signed release. Verify v1/v2/v3 with
rem the Android SDK apksigner before exporting anything to the repository root.
set "APKSIGNER="
if defined ANDROID_SDK_ROOT if exist "%ANDROID_SDK_ROOT%\build-tools\35.0.0\apksigner.bat" set "APKSIGNER=%ANDROID_SDK_ROOT%\build-tools\35.0.0\apksigner.bat"
if not defined APKSIGNER if defined ANDROID_HOME if exist "%ANDROID_HOME%\build-tools\35.0.0\apksigner.bat" set "APKSIGNER=%ANDROID_HOME%\build-tools\35.0.0\apksigner.bat"
if not defined APKSIGNER if defined ANDROID_SDK_ROOT for /f "delims=" %%D in ('dir /b /ad /o-n "%ANDROID_SDK_ROOT%\build-tools" 2^>nul') do if exist "%ANDROID_SDK_ROOT%\build-tools\%%D\apksigner.bat" if not defined APKSIGNER set "APKSIGNER=%ANDROID_SDK_ROOT%\build-tools\%%D\apksigner.bat"
if not defined APKSIGNER if defined ANDROID_HOME for /f "delims=" %%D in ('dir /b /ad /o-n "%ANDROID_HOME%\build-tools" 2^>nul') do if exist "%ANDROID_HOME%\build-tools\%%D\apksigner.bat" if not defined APKSIGNER set "APKSIGNER=%ANDROID_HOME%\build-tools\%%D\apksigner.bat"
if not defined APKSIGNER (
    echo [ERROR] Android SDK apksigner was not found. Refusing to export an unverified APK.
    exit /b 4
)
set "VERIFY_LOG=%TEMP%\solarless-apksigner-%RANDOM%.txt"
call "%APKSIGNER%" verify --verbose --print-certs "%OUT_APK%" > "%VERIFY_LOG%" 2>&1
if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] apksigner rejected the release APK. It may be unsigned or corrupt.
    type "%VERIFY_LOG%"
    del /q "%VERIFY_LOG%" >nul 2>&1
    exit /b 5
)
if defined EXPECTED_SIGNING_CERT_SHA256 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$expected=$env:EXPECTED_SIGNING_CERT_SHA256; $text=Get-Content -Raw -LiteralPath '%VERIFY_LOG%'; $m=[regex]::Match($text, 'certificate SHA-256 digest:\s*([0-9a-f:]+)', 'IgnoreCase'); if ($m.Success -eq $false -or (($m.Groups[1].Value -replace ':','').ToLower() -ne ($expected -replace ':','').ToLower())) { exit 1 }"
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] Release certificate fingerprint does not match EXPECTED_SIGNING_CERT_SHA256.
        type "%VERIFY_LOG%"
        del /q "%VERIFY_LOG%" >nul 2>&1
        exit /b 6
    )
)
del /q "%VERIFY_LOG%" >nul 2>&1

copy /y "%OUT_APK%" "%ROOT_DIR%SolarLessNavi_v1.0.apk" >nul
echo [SUCCESS] Signed release APK exported to %ROOT_DIR%SolarLessNavi_v1.0.apk
dir "%ROOT_DIR%SolarLessNavi_v1.0.apk" | findstr /i "SolarLessNavi"
echo ===================================================
exit /b 0
