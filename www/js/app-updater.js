(function (root) {
    'use strict';
    function create(options) {
        const utils = root.SolarlessVersionUtils;
        const plugin = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.AppUpdate;
        const native = !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform() && plugin);
        const byId = id => document.getElementById(id);
        const modal = byId('update-modal');
        const button = byId('btn-download-update');
        const status = byId('update-status');
        let candidate = null, phase = 'idle', deferred = false, busy = false, cancelled = false;
        let manualDisplay = false, dismissed = false, previousFocus = null, installedVersion = '';
        let startupChecked = false;
        const ko = () => options.language().startsWith('ko');
        const text = (kr, en) => ko() ? kr : en;
        function message(value) {
            status.textContent = value;
            byId('update-check-status').textContent = value;
        }
        function refreshActions() {
            button.hidden = !candidate;
            button.disabled = busy || !candidate || options.isDriving();
            const restriction = byId('update-driving-status');
            if (restriction) {
                restriction.hidden = !candidate || !options.isDriving();
                restriction.textContent = text('버전 확인은 완료했습니다. 주행 안내를 종료한 뒤 다운로드·설치할 수 있습니다.', 'Version checked. End navigation before downloading or installing.');
            }
            const retry = byId('btn-retry-update');
            if (retry) { retry.hidden = phase !== 'error'; retry.disabled = busy; retry.textContent = text('다시 확인', 'Try again'); }
        }
        function setPhase(value) {
            phase = value;
            modal.dataset.updateState = value;
            refreshActions();
            byId('btn-cancel-update').hidden = value !== 'downloading';
            byId('update-progress').hidden = value !== 'downloading';
            byId('update-download-btn-text').textContent = value === 'ready'
                ? text('업데이트 설치', 'Install update') : text('업데이트 다운로드', 'Download update');
        }
        function failure(error) {
            const code = String(error && error.message || error);
            const descriptions = {
                SIGNATURE_MISMATCH: text('설치된 앱과 업데이트의 서명이 다릅니다. 기존 앱을 삭제하지 말고 원래 서명키로 만든 업데이트를 사용하세요.', 'The signing certificates differ. Keep the installed app and use an update signed with its original key.'),
                CANCELLED: text('다운로드를 취소했습니다.', 'Download cancelled.'),
                ANDROID_TOO_OLD: text('이 업데이트는 더 최신 Android가 필요합니다.', 'This update requires a newer Android version.'),
                DRIVING: text('주행 안내를 종료한 뒤 업데이트할 수 있습니다.', 'End navigation before updating.'),
                HASH_MISMATCH: text('파일 검증에 실패했습니다. 다시 다운로드해 주세요.', 'File verification failed. Download again.'),
                VERSION_MISMATCH: text('APK 버전이 일치하지 않아 설치를 중단했습니다.', 'The APK version did not match; installation was stopped.'),
                INVALID_UPDATE: text('업데이트 정보가 올바르지 않습니다.', 'Invalid update information.'),
                TIMEOUT: text('업데이트 확인 시간이 초과되었습니다. 연결을 확인한 뒤 다시 시도해 주세요.', 'Update check timed out. Check your connection and try again.'),
                VERSION_READ_FAILED: text('설치된 앱 버전을 확인하지 못했습니다.', 'Could not read the installed app version.')
            };
            message(descriptions[code] || text('업데이트 서버에 연결하거나 파일을 처리하지 못했습니다. 다시 시도해 주세요.', 'Could not reach the update service or process the file. Try again.'));
        }
        async function bounded(operation, onTimeout = () => {}) {
            let timer;
            try {
                return await Promise.race([operation, new Promise((_, reject) => {
                    timer = setTimeout(() => { onTimeout(); reject(new Error('TIMEOUT')); }, options.timeoutMs || 15000);
                })]);
            } finally { clearTimeout(timer); }
        }
        async function json(url) {
            const controller = new AbortController();
            return bounded((async () => {
                const response = await fetch(url, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
                if (!response.ok) throw new Error('HTTP_' + response.status);
                const body = await response.text();
                if (body.length > 2 * 1024 * 1024) throw new Error('INVALID_UPDATE');
                return JSON.parse(body);
            })(), () => controller.abort());
        }
        function show(manual = false) {
            if (dismissed) return;
            if (document.visibilityState === 'hidden' || (!manual && options.isDriving())) { deferred = true; return; }
            if (!candidate && !manual) return;
            deferred = false;
            manualDisplay = manual;
            if (byId('update-modal-title')) byId('update-modal-title').textContent = candidate
                ? text('새 버전이 있습니다', 'An update is available') : text('업데이트 확인', 'Check for updates');
            if (byId('update-modal-sub')) byId('update-modal-sub').textContent = text('SolarLess Navi 앱 업데이트', 'SolarLess Navi app update');
            if (byId('update-later-btn-text')) byId('update-later-btn-text').textContent = text('일단 계속 사용', 'Continue for now');
            byId('update-info-msg').textContent = candidate
                ? text(`${installedVersion} → ${candidate.versionName}`, `${installedVersion} → ${candidate.versionName}`)
                : (installedVersion ? text(`현재 버전 ${installedVersion}`, `Installed version ${installedVersion}`) : 'SolarLess Navi');
            byId('update-release-notes').textContent = String(candidate?.releaseNotes || '').slice(0, 4000);
            if (modal.classList.contains('hidden')) previousFocus = document.activeElement;
            modal.classList.remove('hidden');
            refreshActions();
            byId('btn-close-update-modal').focus({ preventScroll: true });
        }
        function close() {
            dismissed = true; deferred = false; manualDisplay = false;
            modal.classList.add('hidden');
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        }
        async function check(manual = false) {
            if (manual && busy) { dismissed = false; show(true); return; }
            if (busy) return;
            if (!manual && startupChecked) return;
            if (!manual && document.visibilityState === 'hidden') { deferred = true; return; }
            if (!manual) startupChecked = true;
            dismissed = false;
            if (manual && phase === 'ready' && candidate) { show(true); return; }
            if (!native) {
                if (manual) { setPhase('idle'); message(text('업데이트 설치는 Android 앱에서 사용할 수 있습니다.', 'Update installation is available in the Android app.')); show(true); }
                return;
            }
            manualDisplay = manual;
            busy = true; candidate = null; setPhase('checking');
            byId('btn-check-update').setAttribute('aria-busy', 'true');
            message(text('업데이트 확인 중…', 'Checking for updates…'));
            if (manual) show(true);
            try {
                const installed = await bounded(plugin.getInstalledInfo());
                installedVersion = installed.versionName;
                if (byId('about-app-version')) byId('about-app-version').textContent = `${installed.versionName} (${installed.versionCode})`;
                const releases = [];
                for (let page = 1; page <= 5; page++) {
                    const data = await json(`https://api.github.com/repos/${utils.repository}/releases?per_page=100&page=${page}`);
                    if (!Array.isArray(data)) throw new Error('INVALID_UPDATE');
                    releases.push(...data);
                    if (data.length < 100) break;
                }
                const available = utils.updateReleases(releases);
                if (!available.length) {
                    setPhase('idle');
                    message(text('게시된 앱 업데이트가 없습니다.', 'No app update has been published.'));
                } else {
                    const latest = available[0];
                    const asset = latest.assets.find(item => item.name === 'update.json');
                    const manifest = await json(asset.browser_download_url);
                    const result = utils.validateUpdate(manifest, installed, latest.tag_name);
                    if (result.available) { candidate = manifest; setPhase('available'); message(text('새 버전을 다운로드할 수 있습니다.', 'A new version is ready to download.')); show(manualDisplay); }
                    else { setPhase('idle'); message(text(`최신 버전입니다 (${installed.versionName}).`, `Up to date (${installed.versionName}).`)); }
                }
                if (manualDisplay && !dismissed) show(true);
            } catch (error) { setPhase('error'); failure(error); }
            finally { busy = false; refreshActions(); byId('btn-check-update').removeAttribute('aria-busy'); }
        }
        async function install() {
            if (options.isDriving()) { failure(new Error('DRIVING')); return; }
            busy = true; button.disabled = true;
            try {
                const result = await plugin.installUpdate();
                message(result.installerOpened
                    ? text('Android 설치 화면에서 업데이트를 확인해 주세요.', 'Confirm the update in the Android installer.')
                    : result.permissionGranted
                        ? text('설치가 허용되었습니다. 업데이트 설치를 다시 눌러 주세요.', 'Installation is allowed. Tap Install update again.')
                        : text('설치 권한이 허용되지 않았습니다. 기존 앱은 유지됩니다.', 'Installation permission was not granted. Your existing app is unchanged.'));
            } catch (error) {
                if (['DOWNLOAD_REQUIRED', 'HASH_MISMATCH', 'VERSION_MISMATCH', 'SIGNATURE_MISMATCH'].includes(error.message)) setPhase('available');
                failure(error);
            }
            finally { busy = false; refreshActions(); }
        }
        button.addEventListener('click', async event => {
            event.preventDefault();
            if (busy || !candidate || !native) return;
            if (options.isDriving()) { failure(new Error('DRIVING')); return; }
            if (phase === 'ready') return install();
            busy = true; cancelled = false; setPhase('downloading');
            byId('update-progress').value = 0;
            message(text('다운로드 중…', 'Downloading…'));
            let listener;
            try {
                listener = await plugin.addListener('downloadProgress', progress => {
                    const total = Number(progress.totalBytes), received = Number(progress.receivedBytes);
                    if (total > 0 && Number.isFinite(received)) byId('update-progress').value = Math.min(100, Math.round(received / total * 100));
                });
                const result = await plugin.downloadUpdate({ url: candidate.apkUrl, sha256: candidate.sha256,
                    sizeBytes: candidate.sizeBytes, versionCode: candidate.versionCode });
                if (cancelled) throw new Error('CANCELLED');
                if (!result.verified) throw new Error('HASH_MISMATCH');
                setPhase('ready'); message(text('서명과 파일 검증 완료. 설치를 눌러 주세요.', 'Signature and file verified. Tap Install update.'));
            } catch (error) { setPhase('available'); failure(error); }
            finally {
                try { if (listener) await listener.remove(); } catch { /* A stale listener must not lock the controls. */ }
                busy = false; refreshActions();
            }
        });
        byId('btn-check-update').addEventListener('click', () => check(true));
        byId('btn-cancel-update').addEventListener('click', () => { cancelled = true; plugin.cancelDownload().catch(failure); });
        byId('btn-close-update-modal').addEventListener('click', close);
        byId('btn-retry-update')?.addEventListener('click', () => check(true));
        modal.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            if (event.key === 'Tab') {
                const controls = [...modal.querySelectorAll('button:not([disabled]):not([hidden])')].filter(el => el.getClientRects().length);
                if (!controls.length) return;
                if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
                else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
            }
        });
        const timer = setInterval(() => {
            refreshActions();
            if (options.isDriving()) {
                if (!manualDisplay && !modal.classList.contains('hidden')) { modal.classList.add('hidden'); deferred = !dismissed; }
                return;
            }
            if (deferred && !busy && !dismissed && document.visibilityState !== 'hidden') {
                deferred = false;
                if (candidate) show(); else check(false);
            }
        }, 1000);
        root.addEventListener('pagehide', event => { if (!event.persisted) clearInterval(timer); });
        return { check };
    }
    root.SolarlessUpdater = { create };
})(window);
