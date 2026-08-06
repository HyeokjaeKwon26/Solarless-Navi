/**
 * TTSVoice - Dynamic Context-Aware Turn-by-Turn Voice Navigation Engine
 * Proactive 200m Sun Glare Chime Warning, Native Android TTS, Automotive Web Audio Chime & Instant Language Switch.
 */

window.TTSVoice = (function () {
    let isMuted = false;
    let currentLang = 'ko-KR'; // 'ko-KR' | 'en-US'
    let lastSpokenText = '';
    let lastSpokenTime = 0;
    let lastAnnouncedBucket = "";
    let lastProactiveGlareTime = 0;
    let audioCtx = null;

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
        if (isMuted) {
            stopSpeech();
        }
        return isMuted;
    }

    function stopSpeech() {
        try {
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech) {
                window.Capacitor.Plugins.TextToSpeech.stop();
            }
            if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
        } catch (e) {
            console.warn("Stop speech warning:", e);
        }
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
            toast.innerHTML = `<i class="fa-solid fa-volume-high"></i> <span>${text}</span>`;
            toast.classList.add('active');

            clearTimeout(toast.timer);
            toast.timer = setTimeout(() => {
                toast.classList.remove('active');
            }, 4500);
        }
    }

    async function speak(text, force = false, playChimeType = null) {
        if (!text || isMuted) return;

        if (playChimeType) {
            playWarningChime(playChimeType);
        }

        showVoiceToast(text);

        const now = Date.now();
        if (!force && text === lastSpokenText && (now - lastSpokenTime) < 4000) {
            return;
        }
        lastSpokenText = text;
        lastSpokenTime = now;

        stopSpeech();

        // 1. Native Android Capacitor TextToSpeech Plugin
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech) {
            try {
                await window.Capacitor.Plugins.TextToSpeech.speak({
                    text: text,
                    lang: currentLang,
                    rate: 1.0,
                    pitch: 1.0,
                    volume: 1.0,
                    category: 'ambient'
                });
                return;
            } catch (err) {
                console.warn("Capacitor Native TTS fallback to Web Speech:", err);
            }
        }

        // 2. Web Speech API Fallback
        if (window.speechSynthesis) {
            try {
                window.speechSynthesis.resume();

                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = currentLang;
                utterance.rate = 1.0;
                utterance.pitch = 1.0;

                const voices = window.speechSynthesis.getVoices();
                if (voices && voices.length > 0) {
                    const match = voices.find(v => v.lang.includes(currentLang) || v.lang.startsWith(currentLang.split('-')[0]));
                    if (match) utterance.voice = match;
                }

                window.speechSynthesis.speak(utterance);
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
        const msg = isKorean ?
            `⚠️ 200미터 앞 서쪽 도로 진입 시 강한 태양 정면 직사광선 발생! 햇빛 가리개를 미리 내려주세요.` :
            `⚠️ Strong direct sun glare ahead in 200 meters! Please lower your sun visor in advance.`;

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

        if (glareRisk > 0.45) {
            if (bucket === "now") {
                msg = isKorean ? `잠시 후 역광 우회 도로 진입입니다. 직사광선 주의하세요.` : `Entering glare avoidance route now. Watch out for direct sunlight.`;
            } else if (bucket === "near") {
                msg = isKorean ? `100미터 앞 역광 위험 구간입니다. 햇빛 가리개를 내려주세요.` : `Heavy sun glare in 100 meters. Please lower your sun visor.`;
            } else {
                msg = isKorean ? `300미터 앞 서쪽 역광 우회 도로로 진입합니다.` : `In 300 meters, enter the glare avoidance route.`;
            }
        } else {
            if (bucket === "now") {
                msg = isKorean ? `잠시 후 직진 주행입니다.` : `Continue straight ahead now.`;
            } else if (bucket === "near") {
                msg = isKorean ? `100미터 앞 쾌적한 그늘 도로로 진행합니다.` : `In 100 meters, continue on shaded route.`;
            } else {
                msg = isKorean ? `300미터 앞 안전 주행 구간입니다.` : `In 300 meters, clear and safe road segment.`;
            }
        }

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

    return {
        setLanguage: setLanguage,
        toggleMute: toggleMute,
        speak: speak,
        playWarningChime: playWarningChime,
        announceProactiveGlareWarning: announceProactiveGlareWarning,
        announceNavHazard: announceNavHazard,
        announceRoadEnvironment: announceRoadEnvironment,
        isMuted: () => isMuted,
        getLanguage: () => currentLang
    };
})();
