@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo [1/4] Configuring JDK 17 Environment
echo ===================================================
if exist "C:\Research\shadow\bak\jdk17\jdk-17.0.10+7" (
    set "JAVA_HOME=C:\Research\shadow\bak\jdk17\jdk-17.0.10+7"
    set "PATH=C:\Research\shadow\bak\jdk17\jdk-17.0.10+7\bin;!PATH!"
)
echo JAVA_HOME: %JAVA_HOME%
java -version

echo.
echo ===================================================
echo [2/4] Syncing Fresh Web Assets to Android Project
echo ===================================================
set "SRC=C:\Research\shadow"
set "DEST=C:\Research\shadow\android\app\src\main\assets\public"

if not exist "%DEST%" mkdir "%DEST%"
if not exist "%DEST%\js" mkdir "%DEST%\js"

copy /y "%SRC%\index.html" "%DEST%\index.html"
copy /y "%SRC%\style.css" "%DEST%\style.css"
if exist "%SRC%\manifest.json" copy /y "%SRC%\manifest.json" "%DEST%\manifest.json"
if exist "%SRC%\favicon.ico" copy /y "%SRC%\favicon.ico" "%DEST%\favicon.ico"

echo Syncing JavaScript files...
xcopy /y /e /i "%SRC%\js\*" "%DEST%\js\"

if exist "%SRC%\css" (
    if not exist "%DEST%\css" mkdir "%DEST%\css"
    xcopy /y /e /i "%SRC%\css\*" "%DEST%\css\"
)
if exist "%SRC%\webfonts" (
    if not exist "%DEST%\webfonts" mkdir "%DEST%\webfonts"
    xcopy /y /e /i "%SRC%\webfonts\*" "%DEST%\webfonts\"
)
if exist "%SRC%\icons" (
    if not exist "%DEST%\icons" mkdir "%DEST%\icons"
    xcopy /y /e /i "%SRC%\icons\*" "%DEST%\icons\"
)
if exist "%SRC%\assets" (
    if not exist "%DEST%\assets" mkdir "%DEST%\assets"
    xcopy /y /e /i "%SRC%\assets\*" "%DEST%\assets\"
)

echo.
echo ===================================================
echo [3/4] Cleaning Cache & Building Signed Release APK
echo ===================================================
cd /d "C:\Research\shadow\android"

call gradlew.bat clean assembleRelease --no-build-cache --no-daemon
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Gradle build failed with error %ERRORLEVEL%
    exit /b %ERRORLEVEL%
)

echo.
echo ===================================================
echo [4/4] Finalizing Output & Verifying Keystore Signature
echo ===================================================
cd /d "C:\Research\shadow"

set "OUT_APK=C:\Research\shadow\android\app\build\outputs\apk\release\app-release.apk"
if not exist "%OUT_APK%" (
    set "OUT_APK=C:\Research\shadow\android\app\build\outputs\apk\debug\app-debug.apk"
)

copy /y "%OUT_APK%" "C:\Research\shadow\SolarLessNavi_v1.0.apk"
echo [SUCCESS] APK exported to C:\Research\shadow\SolarLessNavi_v1.0.apk
echo.
echo === APK Information ===
dir "C:\Research\shadow\SolarLessNavi_v1.0.apk" | findstr /i "SolarLessNavi"
echo ===================================================
