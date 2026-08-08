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
if not defined JAVA_HOME if exist "%ROOT_DIR%bak\jdk17\jdk-17.0.10+7" (
    set "JAVA_HOME=%ROOT_DIR%bak\jdk17\jdk-17.0.10+7"
)
if defined JAVA_HOME set "PATH=%JAVA_HOME%\bin;%PATH%"
echo JAVA_HOME: %JAVA_HOME%
java -version
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Java 17 or a configured JAVA_HOME is required.
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
copy /y "%ROOT_DIR%style.css" "%PUBLIC_DIR%\style.css" >nul
xcopy /y /e /i "%ROOT_DIR%js\*" "%PUBLIC_DIR%\js\" >nul
xcopy /y /e /i "%ROOT_DIR%css\*" "%PUBLIC_DIR%\css\" >nul
xcopy /y /e /i "%ROOT_DIR%webfonts\*" "%PUBLIC_DIR%\webfonts\" >nul

rem Capacitor webDir is www; keep this tracked copy in lockstep with root sources.
copy /y "%ROOT_DIR%index.html" "%WWW_DIR%\index.html" >nul
copy /y "%ROOT_DIR%style.css" "%WWW_DIR%\style.css" >nul
xcopy /y /e /i "%ROOT_DIR%js\*" "%WWW_DIR%\js\" >nul
xcopy /y /e /i "%ROOT_DIR%css\*" "%WWW_DIR%\css\" >nul
xcopy /y /e /i "%ROOT_DIR%webfonts\*" "%WWW_DIR%\webfonts\" >nul

echo.
echo ===================================================
echo [3/4] Building Signed Release APK
echo ===================================================
pushd "%ANDROID_DIR%"
call gradlew.bat clean assembleRelease --no-build-cache --no-daemon
set "BUILD_EXIT=%ERRORLEVEL%"
popd
if %BUILD_EXIT% NEQ 0 (
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

copy /y "%OUT_APK%" "%ROOT_DIR%SolarLessNavi_v1.0.apk" >nul
echo [SUCCESS] Signed release APK exported to %ROOT_DIR%SolarLessNavi_v1.0.apk
dir "%ROOT_DIR%SolarLessNavi_v1.0.apk" | findstr /i "SolarLessNavi"
echo ===================================================
exit /b 0
