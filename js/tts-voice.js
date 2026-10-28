/**
 * TTSVoice - Dynamic Context-Aware Turn-by-Turn Voice Navigation Engine
 * Proactive 200m Sun Glare Chime Warning, Native Android TTS, Automotive Web Audio Chime & Instant Language Switch.
 */

window.TTSVoice = (function () {
    let isMuted = false;
    try { isMuted = window.localStorage?.getItem('solarless_voice_muted') === 'true'; } catch (e) {}
    // Auto-detect browser language at load time to match I18n initial detection
    let currentLang = (navigator.language || navigator.userLanguage || '').toLowerCase().startsWith('ko') ? 'ko-KR' : 'en-US';
    let lastSpokenText = '';
    let lastSpokenTime = 0;
    let lastAnnouncedBucket = "";
    let lastProactiveGlareTime = 0;
    let lastTurnAnnounceTime = 0;
    let audioCtx = null;
    let interruptionActive = false;
    let speechGeneration = 0;
    let stopBarrier = Promise.resolve();
    let turnProtectedUntil = 0;
    const spokenStages = new Map();
    let guidancePaused = false;
    let voiceFallbackNotified = false;
    const spokenDistance = meters => window.NavigationUnits.distance(meters, { speech: true, language: currentLang });

    function resetGuidance() {
        guidancePaused = false;
        stopSpeech();
        spokenStages.clear();
        turnProtectedUntil = 0;
        lastTurnAnnounceTime = 0;
        lastSpokenText = '';
    }
    function pauseGuidance() {
        if (guidancePaused) return;
        guidancePaused = true;
        stopSpeech();
        spokenStages.clear();
        turnProtectedUntil = 0;
        lastTurnAnnounceTime = 0;
    }

    function getAudioContext() {
        if (!audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) audioCtx = new AudioContext();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(e => {});
        }
        return audioCtx;
    }

    /* Synthesize Crisp Automotive 2-Tone Warning Chime (Ding-Dong / Beep-Beep) */
    function playWarningChime(type = 'speeding') {
        if (isMuted) return;
        try {
            const ctx = getAudioContext();
            if (!ctx) return;

            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';

            if (type === 'speeding') {
                // High alert two-pitch chime: 987.77Hz (B5) -> 1318.51Hz (E6)
                osc.frequency.setValueAtTime(987.77, now);
                osc.frequency.setValueAtTime(1318.51, now + 0.12);

                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(now);
                osc.stop(now + 0.45);
            } else {
                // Gentle sun glare notification chime: 587.33Hz (D5) -> 880Hz (A5)
                osc.frequency.setValueAtTime(587.33, now);
                osc.frequency.setValueAtTime(880.0, now + 0.15);

                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(now);
                osc.stop(now + 0.5);
            }
        } catch (e) {
            console.warn("Chime synth warning:", e);
        }
    }

    function setLanguage(lang) {
        if (window.NativeNavigation) window.NativeNavigation.invalidate();
        stopSpeech();
        if (lang === 'en' || lang === 'en-US') {
            currentLang = 'en-US';
        } else {
            currentLang = 'ko-KR';
        }
        lastSpokenText = '';
        lastAnnouncedBucket = '';
    }

    function toggleMute() {
        isMuted = !isMuted;
        try { window.localStorage?.setItem('solarless_voice_muted', String(isMuted)); } catch (e) {}
        const native = window.Capacitor?.Plugins?.Pip;
        if (native?.setGuidanceMuted) native.setGuidanceMuted({ muted: isMuted }).catch(() => {});
        if (isMuted) {
            stopSpeech();
        }
        return isMuted;
    }

    function stopSpeech() {
        speechGeneration++;
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech;
        // Serialize native stop operations. A delayed stop must not cut off a
        // newer utterance, and a rejected stop must not become unhandled.
        stopBarrier = stopBarrier.then(() => window.Capacitor?.Plugins?.Pip?.stopFocusedSpeech
            ? window.Capacitor.Plugins.Pip.stopFocusedSpeech() : plugin ? plugin.stop() : undefined).catch(() => {});
        return stopBarrier;
    }

    function handleInterruptionStart() {
        interruptionActive = true;
        stopSpeech();
    }

    function handleInterruptionEnd() {
        interruptionActive = false;
        // Permit the next accepted GPS fix to repeat the current maneuver.
        // A call or another full-screen interruption may have hidden or
        // silenced the instruction that was emitted immediately beforehand.
        lastSpokenText = '';
        lastSpokenTime = 0;
        lastTurnAnnounceTime = 0;
        lastAnnouncedBucket = '';
        spokenStages.clear();
        turnProtectedUntil = 0;
    }

    function showVoiceToast(text) {
        if (typeof document === 'undefined') return;
        let toast = document.getElementById('voice-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'voice-toast';
            toast.className = 'voice-toast-banner';
            if (document.body) document.body.appendChild(toast);
        }

        if (toast) {
            toast.replaceChildren();
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-volume-high';
            const message = document.createElement('span');
            // Voice text may include an external road/place name. Keep it as
            // text so it cannot become executable markup in the toast.
            message.textContent = String(text);
            toast.append(icon, document.createTextNode(' '), message);
            toast.classList.add('active');

            clearTimeout(toast.timer);
            toast.timer = setTimeout(() => {
                toast.classList.remove('active');
            }, 4500);
        }
    }

    async function speak(text, force = false, playChimeType = null, priority = 0, roadNames = [], options = {}) {
        if (!text || isMuted || interruptionActive) return false;
        const now = Date.now();
        if (priority < 2 && now < turnProtectedUntil) return false;
        if (!force && text === lastSpokenText && now - lastSpokenTime < 4000) return false;
        lastSpokenText = text;
        lastSpokenTime = now;
        if (priority === 2) turnProtectedUntil = now + 6000;
        const stopped = stopSpeech();
        const generation = speechGeneration;
        const language = options.language || currentLang;
        let segments = window.NavigationGuidance.speechSegments(text, language, roadNames);
        const preferences = window.VoiceSettings?.get() || {rate:1,pitch:1,koVoice:'',enVoice:''};
        await stopped;
        if (generation !== speechGeneration || isMuted || interruptionActive) return false;
        if (playChimeType && !window.Capacitor?.Plugins?.Pip?.speakFocused) playWarningChime(playChimeType);
        showVoiceToast(text);
        if (window.dispatchEvent && window.CustomEvent) window.dispatchEvent(new CustomEvent('solarless:voice', { detail: { text, timestamp: now, priority, status: 'requested' } }));
        const focused = window.Capacitor?.Plugins?.Pip;
        if (focused?.speakFocused) {
            try {
                const result = await focused.speakFocused({ text, lang: language, segments });
                if (generation !== speechGeneration) return false;
                if (!result.accepted) { spokenStages.clear(); lastTurnAnnounceTime = 0; }
                if (result.languageFallback) showVoiceToast(currentLang.startsWith('ko') ? '영어 음성이 없어 한국어 음성으로 안내합니다. Android 음성 출력 설정에서 영어 음성을 설치해 주세요.' : 'English voice unavailable. Check Android text-to-speech settings.');
                else if(result.voiceFallback&&!voiceFallbackNotified){voiceFallbackNotified=true;showVoiceToast(currentLang.startsWith('ko')?'선택한 목소리가 없어 같은 언어의 기본 음성으로 안내합니다.':'Selected voice unavailable. Using the language default.');}
                if (window.dispatchEvent && window.CustomEvent) window.dispatchEvent(new CustomEvent('solarless:voice', { detail: { text, timestamp: Date.now(), status: result.accepted ? 'accepted' : 'denied', source: 'native-foreground' } }));
                return result.accepted === true;
            } catch (e) { spokenStages.clear(); return false; }
        }

        // The focused Android owner reads persisted settings itself, including
        // screen-off guidance. Browser/legacy fallback applies the same plan.
        segments = window.NavigationGuidance.voicePlan(segments, language, preferences.unifiedVoice);
        // 1. Native Android Capacitor TextToSpeech Plugin
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech) {
            let completed = 0;
            try {
                for (const segment of segments) {
                    if (generation !== speechGeneration || isMuted || interruptionActive) return false;
                    await window.Capacitor.Plugins.TextToSpeech.speak({
                    text: segment.text,
                    lang: segment.lang,
                    rate: preferences.rate,
                    pitch: preferences.pitch,
                    volume: 1.0,
                    category: 'ambient'
                });
                    completed++;
                }
                return true;
            } catch (err) {
                if (generation !== speechGeneration || isMuted || interruptionActive) return false;
                if (completed) { spokenStages.clear(); return false; }
                console.warn("Capacitor Native TTS fallback to Web Speech:", err);
            }
        }

        // 2. Web Speech API Fallback
        if (window.speechSynthesis) {
            try {
                window.speechSynthesis.resume();

                for (const segment of segments) {
                const utterance = new SpeechSynthesisUtterance(segment.text);
                utterance.lang = segment.lang;
                utterance.rate = preferences.rate;
                utterance.pitch = preferences.pitch;

                const voices = window.speechSynthesis.getVoices();
                if (voices && voices.length > 0) {
                    const id=segment.lang.startsWith('ko')?preferences.koVoice:preferences.enVoice;
                    const compatible=v=>v.lang.replace('_','-').split('-')[0]===segment.lang.split('-')[0];
                    const match = voices.find(v=>'web:'+v.voiceURI===id&&compatible(v)) || voices.find(v=>compatible(v)&&v.lang===segment.lang) || voices.find(compatible);
                    if (match) utterance.voice = match;
                }

                window.speechSynthesis.speak(utterance);
                }
                return true;
            } catch (err) {
                console.warn("Web Speech API Error:", err);
            }
        }
    }

    /* Proactive 200m Sun Glare Chime Warning */
    function announceProactiveGlareWarning(heading, glareRisk) {
        if (isMuted || glareRisk <= 0.45) return;
        const now = Date.now();
        if ((now - lastProactiveGlareTime) < 15000) return;
        lastProactiveGlareTime = now;

        const isKorean = currentLang.startsWith('ko');
        const msg = isKorean ? '현재 구간에 눈부심이 예상됩니다. 전방 시야를 확인하세요.' : 'Sun glare is predicted on this section. Check visibility ahead.';

        speak(msg, true, 'glare');
    }

    function announceNavHazard(distanceMeters, heading, glareRisk, stepName = "") {
        if (isMuted) return;

        let bucket = "far";
        if (distanceMeters <= 50) bucket = "now";
        else if (distanceMeters <= 150) bucket = "near";
        else if (distanceMeters <= 350) bucket = "mid";

        const isKorean = currentLang.startsWith('ko');
        const bucketKey = `${currentLang}_${bucket}_${stepName}_${Math.round(glareRisk * 10)}`;
        if (bucketKey === lastAnnouncedBucket) return;
        lastAnnouncedBucket = bucketKey;

        let msg = "";

        // Do not invent a distance, westbound road, avoidance turn or safe
        // shaded section from a scalar current-segment estimate.
        if (glareRisk <= 0.45) return;
        msg = isKorean ? '현재 구간에 눈부심이 예상됩니다. 전방 시야를 확인하세요.' : 'Sun glare is predicted on this section. Check visibility ahead.';

        speak(msg, false, glareRisk > 0.45 ? 'glare' : null);
    }

    let lastRoadTypeState = 'normal'; // 'normal' | 'free_highway' | 'toll_road' | 'toll_highway'
    let lastRoadAnnounceTime = 0;
    let lastTollBoothAnnounceTime = 0;

    /* 3-Tier Highway & Toll Road Entry & Toll Booth Voice Engine */
    function announceRoadEnvironment(roadData) {
        if (isMuted || !roadData) return;
        const now = Date.now();
        const isKorean = currentLang.startsWith('ko');

        // 1. Toll Booth (요금소/톨게이트) 80~100m Ahead Alert
        if (roadData.isTollBoothAhead) {
            if (now - lastTollBoothAnnounceTime > 60000) {
                lastTollBoothAnnounceTime = now;
                const msg = isKorean ?
                    "잠시 후 요금소(톨게이트)가 있습니다." :
                    "Toll booth ahead. Please prepare toll payment.";
                speak(msg, true, 'glare');
                return;
            }
        }

        // 2. 3-Tier Classification
        const isMotorway = !!roadData.isMotorway;
        const isToll = !!roadData.isToll;

        let currentType = 'normal';
        if (isMotorway && isToll) {
            currentType = 'toll_highway'; // 3. 유료 고속도로
        } else if (isMotorway && !isToll) {
            currentType = 'free_highway'; // 1. 무료 고속도로
        } else if (!isMotorway && isToll) {
            currentType = 'toll_road';    // 2. 일반 유료도로
        }

        // Only announce on entry transition (진입 시점 1회 안내 with 90s cooldown)
        if (currentType !== 'normal' && currentType !== lastRoadTypeState) {
            if (now - lastRoadAnnounceTime > 90000) {
                lastRoadAnnounceTime = now;
                lastRoadTypeState = currentType;

                let msg = "";
                if (currentType === 'toll_highway') {
                    msg = isKorean ? "유료 고속도로에 진입합니다." : "Entering toll highway.";
                } else if (currentType === 'free_highway') {
                    msg = isKorean ? "고속도로에 진입합니다. 안전 운전하세요." : "Entering highway. Drive safely.";
                } else if (currentType === 'toll_road') {
                    msg = isKorean ? "유료 도로에 진입합니다." : "Entering toll road.";
                }

                speak(msg, true);
            }
        } else if (currentType === 'normal') {
            lastRoadTypeState = 'normal'; // Reset state so next highway/toll entry triggers cleanly
        }
    }

    /**
     * Convert OSRM maneuver type+modifier to localized turn instruction text.
     */
    function getManeuverText(type, modifier) {
        const isKo = currentLang.startsWith('ko');

        // Map OSRM modifier to i18n key
        const modifierMap = {
            'left': 'turnLeft',
            'right': 'turnRight',
            'slight left': 'turnSlightLeft',
            'slight right': 'turnSlightRight',
            'sharp left': 'turnSharpLeft',
            'sharp right': 'turnSharpRight',
            'uturn': 'turnUturn',
            'straight': 'turnStraight'
        };

        const typeMap = {
            'roundabout': 'turnRoundabout',
            'rotary': 'turnRoundabout',
            'merge': 'turnMerge',
            'fork': 'turnFork',
            'end of road': 'turnEndOfRoad',
            'arrive': 'turnArrive'
        };

        // Priority: specific type overrides, then modifier-based
        if (type === 'arrive') {
            return window.I18n ? window.I18n.getText('turnArrive') : (isKo ? '도착' : 'Arrive');
        }

        if (typeMap[type] && !modifier) {
            return window.I18n ? window.I18n.getText(typeMap[type]) : type;
        }

        const modKey = modifierMap[modifier];
        if (modKey) {
            return window.I18n ? window.I18n.getText(modKey) : modifier;
        }

        // Fallback for roundabout with modifier
        if (type === 'roundabout' || type === 'rotary') {
            const base = window.I18n ? window.I18n.getText('turnRoundabout') : (isKo ? '로터리' : 'Roundabout');
            if (modifier && modifierMap[modifier]) {
                const dir = window.I18n ? window.I18n.getText(modifierMap[modifier]) : modifier;
                return `${base} ${dir}`;
            }
            return base;
        }

        return window.I18n ? window.I18n.getText('turnStraight') : (isKo ? '직진' : 'Continue straight');
    }

    // Announce each maneuver phase once; speed changes cannot replay an older phase.
    function announceTurnManeuver(maneuver, distanceMeters, speedKmh = 0) {
        if (isMuted || interruptionActive || !maneuver || maneuver.type === 'arrive' || !Number.isFinite(distanceMeters)) return;
        const now = Date.now();
        guidancePaused = false;
        const limits = window.NavigationGuidance.thresholds(speedKmh, maneuver);
        const stage = distanceMeters <= limits.execute ? 3 : distanceMeters <= limits.prepare ? 2 : distanceMeters <= limits.preview ? 1 : 0;
        if (!stage) return;
        const key = `${maneuver.sequence ?? ''}|${maneuver.location}|${maneuver.type}|${maneuver.modifier}`;
        if ((spokenStages.get(key) || 0) >= stage) return;
        // A newly reached close turn can supersede the prior turn's cooldown.
        if (stage !== 3 && now - lastTurnAnnounceTime < 2500) return;
        spokenStages.set(key, stage);
        if (spokenStages.size > 128) spokenStages.delete(spokenStages.keys().next().value);
        lastTurnAnnounceTime = now;
        const isKo = currentLang.startsWith('ko');
        let turn = getManeuverText(maneuver.type, maneuver.modifier);
        if (maneuver.exit && /roundabout|rotary/.test(maneuver.type)) {
            turn += isKo ? `, ${maneuver.exit}번째 출구` : `, take exit ${maneuver.exit}`;
        }
        const road = stage === 3 ? window.NavigationGuidance.shortRoad(maneuver, isKo) : window.NavigationGuidance.roadLabel(maneuver, isKo);
        const dist = spokenDistance(distanceMeters);
        const action = road ? (isKo ? `${road} 방면 ${turn}` : `${turn} toward ${road}`) : turn;
        let message = isKo
            ? (stage === 3 ? `곧 ${action}입니다.` : stage === 2 ? `잠시 후 ${action}입니다.` : `${dist} 앞에서 ${action}입니다.`)
            : (stage === 3 ? `${action} ahead.` : stage === 2 ? `Shortly, ${action}.` : `In ${dist}, ${action}.`);
        const following = maneuver.following;
        if (stage >= 2 && following && following.distanceAfter <= 180) {
            const nextRoad = window.NavigationGuidance.shortRoad(following, isKo);
            const nextTurn = getManeuverText(following.type, following.modifier) + (nextRoad ? (isKo ? `, ${nextRoad} 방면` : ` toward ${nextRoad}`) : '');
            message += isKo ? ` 이어서 ${spokenDistance(following.distanceAfter)} 후 ${nextTurn}입니다.`
                : ` Then in ${spokenDistance(following.distanceAfter)}, ${nextTurn}.`;
        }
        speak(message, true, null, 2, [maneuver.name, maneuver.ref, maneuver.destinations, following?.name, following?.ref]);
    }

    function preview() {
        const message = currentLang.startsWith('ko') ? '잠시 후 Lee St.에서 우회전하세요. 이어서 Harvard Ave. 방면으로 좌회전하세요.'
            : 'Shortly, turn right onto Lee St. Then turn left toward Harvard Ave.';
        return speak(message, true, null, 0, ['Lee St.', 'Harvard Ave.']);
    }
    function previewLanguage(language) {
        const lang=language==='ko-KR'?'ko-KR':'en-US';
        const text=lang==='ko-KR'?'잠시 후 Harvard Ave.에서 우회전하세요. 목적지까지 안내하겠습니다.':'Shortly, turn right onto Lee Street. Then continue toward Harvard Avenue.';
        return speak(text,true,null,0,['Harvard Ave.'],{language:lang});
    }

    return {
        resetGuidance, pauseGuidance, refreshUnits: stopSpeech, preview, previewLanguage,
        setLanguage: setLanguage,
        toggleMute: toggleMute,
        speak: speak,
        handleInterruptionStart: handleInterruptionStart,
        handleInterruptionEnd: handleInterruptionEnd,
        playWarningChime: playWarningChime,
        announceProactiveGlareWarning: announceProactiveGlareWarning,
        announceNavHazard: announceNavHazard,
        announceRoadEnvironment: announceRoadEnvironment,
        announceTurnManeuver: announceTurnManeuver,
        getManeuverText: getManeuverText,
        isMuted: () => isMuted,
        getLanguage: () => currentLang
    };
})();
