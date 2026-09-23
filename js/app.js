/**
 * ============================================================================
 * MIMI - CORE JAVASCRIPT APPLICATION ENGINE
 * Flagship Real-World SaaS Architecture with Fresh Clean State & Local DB Sync
 * ============================================================================
 */

(function() {
  'use strict';

  // Storage Keys
  const STORAGE_KEY = 'bloomflow_state_v2';
  const ONBOARDING_KEY = 'bloomflow_onboarding_dismissed';

  // Default Categories & Tags
  const DEFAULT_TAGS = [
    { id: 'work', name: 'Work', color: 'var(--tag-work)', bg: 'var(--tag-work-bg)', icon: '💼' },
    { id: 'personal', name: 'Personal', color: 'var(--tag-personal)', bg: 'var(--tag-personal-bg)', icon: '🌸' },
    { id: 'study', name: 'Study', color: 'var(--tag-study)', bg: 'var(--tag-study-bg)', icon: '📚' },
    { id: 'health', name: 'Health', color: 'var(--tag-health)', bg: 'var(--tag-health-bg)', icon: '🧘' },
    { id: 'creative', name: 'Creative', color: 'var(--tag-creative)', bg: 'var(--tag-creative-bg)', icon: '🎨' }
  ];

  // Default Focus & Break Settings
  const DEFAULT_POMO_SETTINGS = {
    work: 25,
    shortBreak: 5,
    longBreak: 15
  };

  // Default Alarm Ring Tones (Customizable)
  const DEFAULT_ALARM_SOUNDS = {
    task: 'melody',        // for Task Reminders
    shortBreak: 'bell',    // for Short Break finished
    longBreak: 'triumph',  // for Long Break finished
    focus: 'gentle'        // for Focus Session finished
  };

  // Fresh Initial State Template (100% Clean Start)
  const defaultState = {
    tasks: [],
    theme: 'blossom',
    soundEnabled: true,
    streak: { count: 0, lastDate: '' },
    focusMinutesToday: 0,
    tags: DEFAULT_TAGS,
    pomoSettings: DEFAULT_POMO_SETTINGS,
    alarmSounds: DEFAULT_ALARM_SOUNDS,
    onboardingDismissed: false
  };

  // State Store
  let state = loadState();

  // Runtime View / UI State
  let currentView = 'today';
  let activeFilter = 'all';
  let activeSort = 'created';
  let searchQuery = '';
  let activeTag = null;
  let editingTaskId = null;
  let drawerSubtasks = [];
  let calendarDate = new Date();
  let selectedCalendarDateStr = new Date().toISOString().slice(0, 10);

  // Helper: Get Pomodoro Duration in seconds dynamically
  function getPomoDurationSeconds(mode) {
    const s = state.pomoSettings || DEFAULT_POMO_SETTINGS;
    if (mode === 'shortBreak') return (s.shortBreak || 5) * 60;
    if (mode === 'longBreak') return (s.longBreak || 15) * 60;
    return (s.work || 25) * 60;
  }

  // Pomodoro Runtime State
  let pomoMode = 'work';
  let pomoTimeLeft = getPomoDurationSeconds('work');
  let pomoInterval = null;
  let pomoActiveTaskId = null;
  let currentAmbientSound = 'off';

  // Alarm Runtime State
  let alarmInterval = null;
  let activeAlarmTask = null;
  let activeAlarmSoundType = 'melody';

  // Backend Server Config & Sync State
  const API_BASE = window.location.protocol.startsWith('http') ? '' : 'http://localhost:3000';
  let isServerOnline = false;

  // DOM Helpers
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  /* --------------------------------------------------------------------------
     1. STATE MANAGEMENT & BACKEND DATABASE SYNC
     -------------------------------------------------------------------------- */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          ...defaultState,
          ...parsed,
          pomoSettings: { ...DEFAULT_POMO_SETTINGS, ...(parsed.pomoSettings || {}) },
          alarmSounds: { ...DEFAULT_ALARM_SOUNDS, ...(parsed.alarmSounds || {}) },
          tags: (parsed.tags && parsed.tags.length > 0) ? parsed.tags : DEFAULT_TAGS,
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks : []
        };
      }
    } catch (e) {
      console.error('Failed to load state from localStorage:', e);
    }
    return { ...defaultState, pomoSettings: { ...DEFAULT_POMO_SETTINGS }, alarmSounds: { ...DEFAULT_ALARM_SOUNDS } };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      syncToServerBackground();
    } catch (e) {
      console.error('Failed to save state:', e);
    }
  }

  function updateSyncIndicator(status, message) {
    const indicator = $('syncIndicator');
    const textEl = $('syncText');
    if (!indicator || !textEl) return;

    indicator.classList.remove('offline', 'syncing');
    if (status === 'online') {
      textEl.textContent = message || 'Local DB Synced';
      indicator.title = 'Connected to Local Database Server (data/database.json)';
    } else if (status === 'syncing') {
      indicator.classList.add('syncing');
      textEl.textContent = 'Syncing...';
    } else {
      indicator.classList.add('offline');
      textEl.textContent = message || 'Offline Storage';
      indicator.title = 'Running on phone/browser local storage (100% offline)';
    }
  }

  async function syncToServerBackground() {
    if (!isServerOnline) return;
    try {
      await fetch(`${API_BASE}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      });
      updateSyncIndicator('online', 'Local DB Synced');
    } catch (e) {
      // Offline fallback
    }
  }

  async function checkServerAndSync() {
    updateSyncIndicator('syncing');
    try {
      const healthRes = await fetch(`${API_BASE}/api/health`, { method: 'GET', cache: 'no-store' });
      if (healthRes.ok) {
        isServerOnline = true;

        const syncRes = await fetch(`${API_BASE}/api/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state)
        });

        if (syncRes.ok) {
          const syncData = await syncRes.json();
          if (syncData && syncData.state) {
            state = { ...defaultState, ...syncData.state };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            renderAll();
          }
        }
        updateSyncIndicator('online', 'Local DB Synced');
      } else {
        isServerOnline = false;
        updateSyncIndicator('offline', 'Offline Mode');
      }
    } catch (err) {
      isServerOnline = false;
      updateSyncIndicator('offline', 'Offline Mode');
    }
  }

  /* --------------------------------------------------------------------------
     2. AUDIO SYNTHESIZER & AMBIENT SOUNDSCAPES (Web Audio API)
     -------------------------------------------------------------------------- */
  let audioCtx = null;
  let ambientSourceNode = null;
  let ambientGainNode = null;

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playSound(type) {
    if (state.soundEnabled === false) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      if (type === 'click') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.04);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.04);
      } else if (type === 'complete') {
        const notes = [1046.50, 1318.51, 1567.98];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteTime = now + (idx * 0.06);

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, noteTime);
          gain.gain.setValueAtTime(0.12, noteTime);
          gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(noteTime);
          osc.stop(noteTime + 0.35);
        });
      } else if (type === 'triumph') {
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteTime = now + (idx * 0.08);

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, noteTime);
          gain.gain.setValueAtTime(0.15, noteTime);
          gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.6);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(noteTime);
          osc.stop(noteTime + 0.6);
        });
      } else if (type === 'bell') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 1.2);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 1.2);
      }
    } catch (e) {
      console.log('Audio playback notice:', e);
    }
  }

  /* --------------------------------------------------------------------------
     3. MULTI-TONE ALARM SYNTHESIZER & CUSTOM SOUND ENGINE
     -------------------------------------------------------------------------- */
  function playAlarmTone(soundType) {
    if (state.soundEnabled === false) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const type = soundType || 'melody';

      if (type === 'digital') {
        // High-clarity twin electronic beeps
        [0, 0.12].forEach(offset => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(920, now + offset);
          gain.gain.setValueAtTime(0.18, now + offset);
          gain.gain.linearRampToValueAtTime(0.01, now + offset + 0.08);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.08);
        });
      } else if (type === 'bell') {
        // Deep crystal resonant bell
        const freqs = [880, 1760];
        freqs.forEach(freq => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);
          osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + 1.2);
          gain.gain.setValueAtTime(0.25, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 1.2);
        });
      } else if (type === 'triumph') {
        // Joyous victory arpeggio (C5 -> E5 -> G5 -> C6)
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteTime = now + (idx * 0.10);
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, noteTime);
          gain.gain.setValueAtTime(0.22, noteTime);
          gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.45);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(noteTime);
          osc.stop(noteTime + 0.45);
        });
      } else if (type === 'gentle') {
        // Warm soft bloom chord (E4, A4, C#5, E5)
        const notes = [329.63, 440.00, 554.37, 659.25];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteTime = now + (idx * 0.08);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, noteTime);
          gain.gain.setValueAtTime(0.20, noteTime);
          gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.55);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(noteTime);
          osc.stop(noteTime + 0.55);
        });
      } else if (type === 'urgent') {
        // Fast dual siren pulses
        [0, 0.18].forEach(offset => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(800, now + offset);
          osc.frequency.linearRampToValueAtTime(1200, now + offset + 0.12);
          gain.gain.setValueAtTime(0.18, now + offset);
          gain.gain.linearRampToValueAtTime(0.01, now + offset + 0.12);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.12);
        });
      } else {
        // Default: Melody chime (D5 -> A5 -> D6 -> A5)
        const notes = [587.33, 880.00, 1174.66, 880.00];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteTime = now + (idx * 0.14);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, noteTime);
          gain.gain.setValueAtTime(0.22, noteTime);
          gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(noteTime);
          osc.stop(noteTime + 0.35);
        });
      }
    } catch (e) {
      console.log('Alarm tone synthesis notice:', e);
    }
  }

  function previewSelectedSound(soundType) {
    playAlarmTone(soundType);
    triggerHaptic();
    const names = {
      melody: '🎵 Melody Chime',
      digital: '⏰ Digital Alarm Beep',
      bell: '🔔 Crystal Bell',
      triumph: '🎺 Triumph Fanfare',
      gentle: '🌸 Gentle Bloom',
      urgent: '🚨 Urgent Pulse'
    };
    showToast(`Testing: ${names[soundType] || soundType}`, '🔊', 2200);
  }

  function startContinuousAlarm(soundType) {
    activeAlarmSoundType = soundType || 'melody';
    stopAlarmRingingSound();
    playAlarmTone(activeAlarmSoundType);
    alarmInterval = setInterval(() => {
      playAlarmTone(activeAlarmSoundType);
    }, 1800);
  }

  function updateAlarmSoundSetting(key, val) {
    if (!state.alarmSounds) state.alarmSounds = { ...DEFAULT_ALARM_SOUNDS };
    state.alarmSounds[key] = val;
    saveState();
    previewSelectedSound(val);
  }

  function syncAlarmSoundInputsUI() {
    const sounds = state.alarmSounds || DEFAULT_ALARM_SOUNDS;
    if ($('settingAlarmTask')) $('settingAlarmTask').value = sounds.task || 'melody';
    if ($('settingAlarmShortBreak')) $('settingAlarmShortBreak').value = sounds.shortBreak || 'bell';
    if ($('settingAlarmLongBreak')) $('settingAlarmLongBreak').value = sounds.longBreak || 'triumph';
    if ($('settingAlarmFocus')) $('settingAlarmFocus').value = sounds.focus || 'gentle';

    if ($('customPomoShortSound')) $('customPomoShortSound').value = sounds.shortBreak || 'bell';
    if ($('customPomoLongSound')) $('customPomoLongSound').value = sounds.longBreak || 'triumph';
    if ($('customPomoWorkSound')) $('customPomoWorkSound').value = sounds.focus || 'gentle';
  }

  function startAlarmRinging(task) {
    activeAlarmTask = task;
    const modal = $('alarmModalOverlay');
    const iconEl = $('alarmModalIcon');
    const headerEl = $('alarmModalHeader');
    const titleEl = $('alarmTaskTitle');
    const metaEl = $('alarmTaskMeta');
    const actionsEl = $('alarmActionsContainer');

    const soundToPlay = task.alarmSound || (state.alarmSounds ? state.alarmSounds.task : 'melody') || 'melody';

    if (iconEl) iconEl.textContent = '⏰';
    if (headerEl) headerEl.textContent = 'Task Alarm Reminder!';
    if (titleEl) titleEl.textContent = `${task.emoji || '🌷'} ${task.title}`;
    if (metaEl) metaEl.textContent = `Scheduled for ${task.time || '18:00'} • Priority: ${task.priority.toUpperCase()}`;

    if (actionsEl) {
      actionsEl.innerHTML = `
        <button class="nav-btn" onclick="window.BloomFlow.snoozeAlarm()" style="flex: 1; min-width: 130px; border: 1px solid var(--border-subtle); justify-content: center; padding: 11px;">💤 Snooze 5m</button>
        <button class="btn-primary" onclick="window.BloomFlow.completeAlarmTask()" style="flex: 1; min-width: 130px; justify-content: center; padding: 11px;">✅ Mark Done</button>
      `;
    }

    if (modal) modal.classList.add('active');

    startContinuousAlarm(soundToPlay);
    triggerHapticAlarm();

    if (Notification.permission === 'granted') {
      try {
        new Notification(`⏰ Reminder: ${task.title}`, {
          body: task.description || `It's time for: ${task.title}`,
          icon: 'icons/icon.svg',
          vibrate: [400, 200, 400, 200, 500]
        });
      } catch (e) {}
    }

    showToast(`⏰ Alarm: ${task.title}`, task.emoji || '🔔', 10000);
  }

  function stopAlarmRingingSound() {
    if (alarmInterval) {
      clearInterval(alarmInterval);
      alarmInterval = null;
    }
  }

  function dismissAlarmModal() {
    stopAlarmRingingSound();
    const modal = $('alarmModalOverlay');
    if (modal) modal.classList.remove('active');
    activeAlarmTask = null;
    playSound('click');
  }

  function snoozeAlarm() {
    stopAlarmRingingSound();
    const modal = $('alarmModalOverlay');
    if (modal) modal.classList.remove('active');

    if (activeAlarmTask) {
      const now = new Date();
      const snoozeDate = new Date(now.getTime() + 5 * 60000);
      const hh = String(snoozeDate.getHours()).padStart(2, '0');
      const mm = String(snoozeDate.getMinutes()).padStart(2, '0');
      activeAlarmTask.time = `${hh}:${mm}`;
      activeAlarmTask.lastNotified = '';
      saveState();
      renderAll();
      showToast(`Snoozed for 5 minutes until ${hh}:${mm}`, '💤');
    }
    playSound('click');
  }

  function completeAlarmTask() {
    stopAlarmRingingSound();
    const modal = $('alarmModalOverlay');
    if (modal) modal.classList.remove('active');

    if (activeAlarmTask) {
      toggleTaskDone(activeAlarmTask.id);
    }
    playSound('complete');
  }

  function startBreakAfterFocus(breakMode) {
    dismissAlarmModal();
    switchPomodoroMode(breakMode);
    startPomodoroInterval();
    $('btnPomoMain').textContent = 'Pause';
    showToast(`Started ${breakMode === 'longBreak' ? 'Long Break' : 'Short Break'}! Relax & recharge.`, '☕');
  }

  function startFocusAfterBreak() {
    dismissAlarmModal();
    switchPomodoroMode('work');
    startPomodoroInterval();
    $('btnPomoMain').textContent = 'Pause';
    showToast('Focus session started! Deep flow begins.', '🍅');
  }

  function setAmbientSound(soundType) {
    currentAmbientSound = soundType;

    // Update UI buttons
    $$('.ambient-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sound === soundType);
    });

    stopAmbientSound();

    if (soundType === 'off') {
      showToast('Ambient soundscape off', '🔇');
      return;
    }

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);

      if (soundType === 'rain') {
        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          output[i] = (lastOut + (0.02 * white)) / 1.02;
          lastOut = output[i];
          output[i] *= 3.5;
        }
      } else if (soundType === 'ocean') {
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
          output[i] *= 0.11;
          b6 = white * 0.115926;
        }
      } else {
        for (let i = 0; i < bufferSize; i++) {
          output[i] = (Math.random() * 2 - 1) * 0.15;
        }
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      const filter = ctx.createBiquadFilter();
      if (soundType === 'rain') {
        filter.type = 'lowpass';
        filter.frequency.value = 850;
      } else if (soundType === 'ocean') {
        filter.type = 'lowpass';
        filter.frequency.value = 500;
      } else if (soundType === 'forest') {
        filter.type = 'bandpass';
        filter.frequency.value = 1200;
        filter.Q.value = 2.0;
      } else {
        filter.type = 'lowpass';
        filter.frequency.value = 650;
      }

      ambientGainNode = ctx.createGain();
      ambientGainNode.gain.setValueAtTime(0.08, ctx.currentTime);

      whiteNoise.connect(filter);
      filter.connect(ambientGainNode);
      ambientGainNode.connect(ctx.destination);

      whiteNoise.start(0);
      ambientSourceNode = whiteNoise;

      const labels = { rain: '🌧️ Gentle Rain', ocean: '🌊 Ocean Waves', forest: '🌲 Forest Breeze', cafe: '☕ Cozy Cafe' };
      showToast(`Playing ${labels[soundType] || soundType}`, '🎵');
    } catch (err) {
      console.log('Ambient sound initialization error:', err);
    }
  }

  function stopAmbientSound() {
    if (ambientSourceNode) {
      try {
        ambientSourceNode.stop();
        ambientSourceNode.disconnect();
      } catch (e) {}
      ambientSourceNode = null;
    }
    if (ambientGainNode) {
      try {
        ambientGainNode.disconnect();
      } catch (e) {}
      ambientGainNode = null;
    }
  }

  function toggleSound() {
    state.soundEnabled = !(state.soundEnabled !== false);
    saveState();
    updateSoundUI();
    playSound('click');
    showToast(`Sound effects ${state.soundEnabled ? 'Enabled' : 'Muted'}`, state.soundEnabled ? '🔊' : '🔇');
  }

  function updateSoundUI() {
    const statusEl = $('soundToggleStatus');
    if (statusEl) {
      const isEnabled = state.soundEnabled !== false;
      statusEl.textContent = isEnabled ? 'ON' : 'OFF';
      statusEl.style.color = isEnabled ? 'var(--accent-primary)' : 'var(--text-muted)';
    }
  }

  function triggerHaptic() {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(15);
      } catch (e) {}
    }
  }

  function triggerHapticAlarm() {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate([400, 200, 400, 200, 500]);
      } catch (e) {}
    }
  }

  /* --------------------------------------------------------------------------
     3. CONFETTI CELEBRATION ENGINE
     -------------------------------------------------------------------------- */
  function triggerConfetti() {
    const canvas = $('confettiCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#f472b6', '#ec4899', '#db2777', '#a855f7', '#6366f1', '#38bdf8', '#facc15', '#4ade80'];
    const particles = [];
    const count = 90;

    for (let i = 0; i < count; i++) {
      particles.push({
        x: canvas.width * (0.3 + Math.random() * 0.4),
        y: canvas.height * 0.6,
        vx: (Math.random() - 0.5) * 16,
        vy: -Math.random() * 14 - 6,
        size: Math.random() * 8 + 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rSpeed: (Math.random() - 0.5) * 12,
        opacity: 1,
        shape: Math.random() > 0.4 ? 'rect' : 'circle'
      });
    }

    let frameId;
    function render() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;

      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.4;
        p.rotation += p.rSpeed;
        p.opacity -= 0.012;

        if (p.opacity > 0 && p.y < canvas.height + 20) {
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = Math.max(0, p.opacity);
          ctx.fillStyle = p.color;

          if (p.shape === 'rect') {
            ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          } else {
            ctx.beginPath();
            ctx.arc(0, 0, p.size / 3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      });

      if (alive) {
        frameId = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        cancelAnimationFrame(frameId);
      }
    }
    render();
  }

  /* --------------------------------------------------------------------------
     4. TOAST NOTIFICATION SYSTEM
     -------------------------------------------------------------------------- */
  function showToast(message, icon = '✨', duration = 3200) {
    const stack = $('toastStack');
    if (!stack) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <span style="font-size: 1.2rem;">${icon}</span>
      <span style="flex: 1;">${escapeHtml(message)}</span>
    `;

    stack.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /* --------------------------------------------------------------------------
     5. ONBOARDING & STREAK SYSTEM
     -------------------------------------------------------------------------- */
  function dismissOnboarding() {
    state.onboardingDismissed = true;
    saveState();
    const banner = $('onboardingBanner');
    if (banner) {
      banner.style.opacity = '0';
      banner.style.transform = 'translateY(-10px)';
      setTimeout(() => banner.remove(), 250);
    }
    playSound('click');
  }

  function checkAndUpdateStreak() {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    if (!state.streak || !state.streak.lastDate) {
      state.streak = { count: 1, lastDate: today };
      saveState();
      renderStreak();
      return;
    }

    if (state.streak.lastDate === today) {
      return;
    }

    if (state.streak.lastDate === yesterday) {
      state.streak.count += 1;
      state.streak.lastDate = today;
    } else {
      state.streak.count = 1;
      state.streak.lastDate = today;
    }
    saveState();
    renderStreak();
  }

  function renderStreak() {
    const el = $('streakCount');
    if (el) {
      const count = state.streak ? state.streak.count : 0;
      el.textContent = count > 0 ? `${count} Day Streak` : '0 Day Streak';
    }
  }

  /* --------------------------------------------------------------------------
     6. TASK MANAGEMENT & ACCURATE TIME / TAG QUICK-ADD
     -------------------------------------------------------------------------- */
  function parseNaturalLanguageTask(rawText) {
    let text = rawText.trim();
    let priority = null;
    let tag = null;
    let time = null;
    let dueDate = null;

    // Priority regex: !p1, !p2, !p3, !p4, !urgent, !high, !low
    if (/!p1|!urgent/i.test(text)) {
      priority = 'p1';
      text = text.replace(/!p1|!urgent/gi, '');
    } else if (/!p2|!high/i.test(text)) {
      priority = 'p2';
      text = text.replace(/!p2|!high/gi, '');
    } else if (/!p3|!med/i.test(text)) {
      priority = 'p3';
      text = text.replace(/!p3|!med/gi, '');
    } else if (/!p4|!low/i.test(text)) {
      priority = 'p4';
      text = text.replace(/!p4|!low/gi, '');
    }

    // Tag regex: #work, #study, #health, #personal, #creative, etc.
    const tagMatch = text.match(/#(\w+)/i);
    if (tagMatch) {
      const matchName = tagMatch[1].toLowerCase();
      const foundTag = state.tags.find(t => t.id.toLowerCase() === matchName || t.name.toLowerCase() === matchName);
      if (foundTag) {
        tag = foundTag.id;
      }
      text = text.replace(/#\w+/gi, '');
    }

    // Time regex: @17:00, @5pm, @9:30am
    const timeMatch = text.match(/@(\d{1,2}(?::\d{2})?(?:am|pm)?)/i);
    if (timeMatch) {
      const timeVal = timeMatch[1].toLowerCase();
      if (timeVal.includes('am') || timeVal.includes('pm')) {
        const isPm = timeVal.includes('pm');
        const numPart = timeVal.replace(/am|pm/g, '');
        let [h, m = '00'] = numPart.split(':');
        let hour = parseInt(h, 10);
        if (isPm && hour < 12) hour += 12;
        if (!isPm && hour === 12) hour = 0;
        time = `${String(hour).padStart(2, '0')}:${m.padStart(2, '0')}`;
      } else if (timeVal.includes(':')) {
        let [h, m = '00'] = timeVal.split(':');
        time = `${String(parseInt(h, 10)).padStart(2, '0')}:${m.padStart(2, '0')}`;
      }
      text = text.replace(/@\S+/gi, '');
    }

    // Date regex: @today, @tomorrow
    if (/@tomorrow/i.test(rawText)) {
      const tmrw = new Date(Date.now() + 86400000);
      dueDate = tmrw.toISOString().slice(0, 10);
      text = text.replace(/@tomorrow/gi, '');
    } else if (/@today/i.test(rawText)) {
      dueDate = new Date().toISOString().slice(0, 10);
      text = text.replace(/@today/gi, '');
    }

    return {
      title: text.trim(),
      priority,
      tag,
      time,
      dueDate
    };
  }

  function addTask({ title, description = '', emoji = '🌷', priority = 'p3', tag = 'personal', dueDate = '', time = '18:00', recurrence = 'once', subtasks = [], status = 'todo', alarmSound = 'melody' }) {
    if (!title || !title.trim()) {
      showToast('Please enter a task name', '⚠️');
      return null;
    }

    // Normalize time to HH:MM format
    let normalizedTime = time || '18:00';
    if (normalizedTime.includes(':')) {
      const [th, tm = '00'] = normalizedTime.split(':');
      normalizedTime = `${String(parseInt(th, 10)).padStart(2, '0')}:${tm.padStart(2, '0')}`;
    }

    const defaultSound = (state.alarmSounds ? state.alarmSounds.task : 'melody') || 'melody';
    const today = new Date().toISOString().slice(0, 10);
    const newTask = {
      id: 'task_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: title.trim(),
      description: (description || '').trim(),
      emoji: emoji || '🌷',
      priority: priority || 'p3',
      tag: tag || (state.tags[0] ? state.tags[0].id : 'personal'),
      status: status || 'todo',
      done: status === 'done',
      dueDate: dueDate || today,
      time: normalizedTime,
      alarmSound: alarmSound || defaultSound,
      recurrence: recurrence || 'once',
      subtasks: Array.isArray(subtasks) ? [...subtasks] : [],
      pomodorosEstimated: 1,
      pomodorosCompleted: status === 'done' ? 1 : 0,
      createdAt: new Date().toISOString(),
      completedAt: status === 'done' ? new Date().toISOString() : null,
      lastNotified: ''
    };

    state.tasks.unshift(newTask);
    saveState();
    playSound('click');
    triggerHaptic();
    showToast(`Added "${newTask.title}"`, newTask.emoji);
    renderAll();
    return newTask;
  }

  function toggleTaskDone(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;

    task.done = !task.done;
    if (task.done) {
      task.status = 'done';
      task.completedAt = new Date().toISOString();
      playSound('complete');
      triggerHaptic();
      triggerConfetti();
      checkAndUpdateStreak();
      showToast(`Completed: ${task.title}`, '🎉');
    } else {
      task.status = 'todo';
      task.completedAt = null;
      playSound('click');
      triggerHaptic();
    }

    saveState();
    renderAll();
  }

  function duplicateTask(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;

    const cloned = JSON.parse(JSON.stringify(task));
    cloned.id = 'task_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    cloned.title = `${task.title} (Copy)`;
    cloned.done = false;
    cloned.status = 'todo';
    cloned.createdAt = new Date().toISOString();
    cloned.completedAt = null;

    state.tasks.unshift(cloned);
    saveState();
    playSound('click');
    showToast(`Duplicated "${task.title}"`, '📋');
    renderAll();
  }

  function deleteTask(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;

    state.tasks = state.tasks.filter(t => t.id !== id);
    saveState();
    playSound('click');
    showToast(`Removed task`, '🗑️');
    renderAll();
  }

  function clearCompletedTasks() {
    const initialCount = state.tasks.length;
    state.tasks = state.tasks.filter(t => !t.done);
    const removedCount = initialCount - state.tasks.length;
    saveState();
    renderAll();
    playSound('click');
    showToast(`Cleared ${removedCount} completed task${removedCount === 1 ? '' : 's'}`, '🧹');
  }

  /* --------------------------------------------------------------------------
     7. FILTERING & SORTING ENGINE
     -------------------------------------------------------------------------- */
  function getFilteredTasks() {
    const today = new Date().toISOString().slice(0, 10);
    let list = [...state.tasks];

    // Filter by View
    if (currentView === 'today') {
      list = list.filter(t => {
        if (t.recurrence === 'daily') return true;
        if (t.recurrence === 'weekdays') {
          const day = new Date().getDay();
          return day >= 1 && day <= 5;
        }
        if (t.recurrence === 'weekend') {
          const day = new Date().getDay();
          return day === 0 || day === 6;
        }
        return t.dueDate === today || (!t.done && t.dueDate < today);
      });
    } else if (currentView === 'inbox') {
      // All tasks
    } else if (currentView === 'upcoming') {
      list = list.filter(t => t.dueDate > today || (t.recurrence && t.recurrence !== 'once'));
    }

    // Filter by Tag
    if (activeTag) {
      list = list.filter(t => t.tag === activeTag);
    }

    // Filter by Status / Priority Chip
    if (activeFilter === 'active') {
      list = list.filter(t => !t.done);
    } else if (activeFilter === 'completed') {
      list = list.filter(t => t.done);
    } else if (activeFilter === 'p1') {
      list = list.filter(t => t.priority === 'p1');
    } else if (activeFilter === 'p2') {
      list = list.filter(t => t.priority === 'p2');
    }

    // Filter by Search Query
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(t => 
        (t.title && t.title.toLowerCase().includes(q)) || 
        (t.description && t.description.toLowerCase().includes(q)) || 
        (t.tag && t.tag.toLowerCase().includes(q))
      );
    }

    // Sort Tasks
    if (activeSort === 'priority') {
      const pOrder = { p1: 1, p2: 2, p3: 3, p4: 4 };
      list.sort((a, b) => (pOrder[a.priority] || 3) - (pOrder[b.priority] || 3));
    } else if (activeSort === 'due') {
      list.sort((a, b) => {
        const da = (a.dueDate || '') + ' ' + (a.time || '');
        const db = (b.dueDate || '') + ' ' + (b.time || '');
        return da.localeCompare(db);
      });
    } else if (activeSort === 'title') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else {
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    }

    return list;
  }

  function setSort(sortType) {
    activeSort = sortType;
    renderListView();
    playSound('click');
  }

  function switchView(viewName) {
    currentView = viewName;
    activeTag = null;

    $$('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    $$('.tag-nav-btn').forEach(btn => btn.classList.remove('active'));
    $$('.mobile-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    $$('.view-pane').forEach(pane => pane.classList.remove('active'));

    if (['today', 'inbox', 'upcoming'].includes(viewName)) {
      const listPane = $('view-today');
      if (listPane) listPane.classList.add('active');
    } else {
      const targetPane = $(`view-${viewName}`);
      if (targetPane) targetPane.classList.add('active');
    }

    const sidebar = $('sidebar');
    if (sidebar) sidebar.classList.remove('open');
    const backdrop = $('sidebarBackdrop');
    if (backdrop) backdrop.classList.remove('active');

    playSound('click');
    renderAll();
  }

  function switchTag(tagId) {
    activeTag = tagId;
    currentView = 'inbox';

    $$('.nav-btn').forEach(btn => btn.classList.remove('active'));
    $$('.tag-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tag === tagId);
    });

    $$('.view-pane').forEach(pane => pane.classList.remove('active'));
    const listPane = $('view-today');
    if (listPane) listPane.classList.add('active');

    playSound('click');
    renderAll();
  }

  /* --------------------------------------------------------------------------
     8. RENDERING: LIST VIEW & PROGRESS (Clean Empty State)
     -------------------------------------------------------------------------- */
  function renderListView() {
    const container = $('taskListContainer');
    if (!container) return;

    const tasks = getFilteredTasks();
    const totalCount = tasks.length;
    const completedCount = tasks.filter(t => t.done).length;
    const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    // Update Progress Card
    const progressCard = $('progressCard');
    if (progressCard) {
      progressCard.style.display = totalCount > 0 ? 'flex' : 'none';
      $('progressRatioText').textContent = `${completedCount} of ${totalCount} completed`;
      $('progressPercentText').textContent = `${progressPercent}%`;
      $('progressBarFill').style.width = `${progressPercent}%`;
    }

    // Update Title & Subtitle
    const titleMap = {
      today: "☀️ Today's Flow",
      inbox: '📥 All Tasks & Inbox',
      upcoming: '📅 Upcoming Schedule'
    };

    if ($('currentViewTitle')) {
      if (activeTag) {
        const foundTag = state.tags.find(t => t.id === activeTag);
        $('currentViewTitle').textContent = `${foundTag ? foundTag.icon : '🏷️'} ${foundTag ? foundTag.name : activeTag} Tasks`;
      } else {
        $('currentViewTitle').textContent = titleMap[currentView] || 'Tasks';
      }
    }

    if ($('currentViewSub')) {
      if (currentView === 'today') {
        const todayText = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        $('currentViewSub').textContent = `${todayText} • ${tasks.length} tasks scheduled`;
      } else if (currentView === 'inbox') {
        $('currentViewSub').textContent = `Full workspace repository • ${tasks.length} total tasks`;
      } else if (currentView === 'upcoming') {
        $('currentViewSub').textContent = `Upcoming deadlines and recurring routines • ${tasks.length} tasks`;
      }
    }

    // Clean Empty State: Only bold text and icon
    if (tasks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🌷</div>
          <h3>Clean workspace, ready to bloom!</h3>
        </div>
      `;
      return;
    }

    container.innerHTML = tasks.map(t => {
      const tagObj = state.tags.find(tg => tg.id === t.tag) || { name: t.tag || 'General', bg: 'var(--bg-secondary)', color: 'var(--text-secondary)', icon: '🏷️' };
      const priorityLabels = { p1: '🔴 Urgent', p2: '🟠 High', p3: '🟡 Medium', p4: '🟢 Low' };
      const subtaskRatio = t.subtasks && t.subtasks.length > 0
        ? `<span class="task-meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> ${t.subtasks.filter(s=>s.done).length}/${t.subtasks.length}</span>`
        : '';
      const pomoInfo = t.pomodorosEstimated > 0
        ? `<span class="task-meta-item">🍅 ${t.pomodorosCompleted || 0}/${t.pomodorosEstimated}</span>`
        : '';
      const recurrenceBadge = t.recurrence && t.recurrence !== 'once'
        ? `<span class="task-meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> ${capitalize(t.recurrence)}</span>`
        : '';

      return `
        <div class="task-item priority-${t.priority} ${t.done ? 'done' : ''}" data-id="${t.id}">
          <div class="custom-checkbox" onclick="window.BloomFlow.toggleTask('${t.id}')">
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
          <div class="task-content" onclick="window.BloomFlow.openTaskDrawer('${t.id}')">
            <div class="task-title-row">
              <span class="task-emoji">${t.emoji || '🌷'}</span>
              <span class="task-title">${escapeHtml(t.title)}</span>
            </div>
            <div class="task-meta-row">
              <span class="badge-tag" style="background: ${tagObj.bg}; color: ${tagObj.color};">${tagObj.icon || '🏷️'} ${tagObj.name}</span>
              <span class="badge-tag badge-${t.priority}">${priorityLabels[t.priority]}</span>
              <span class="task-meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${t.time || '18:00'}</span>
              ${recurrenceBadge}
              ${subtaskRatio}
              ${pomoInfo}
            </div>
          </div>
          <div class="task-actions">
            <button class="task-action-btn" title="Focus with Pomodoro" onclick="window.BloomFlow.startFocusTask('${t.id}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
            </button>
            <button class="task-action-btn" title="Duplicate Task" onclick="window.BloomFlow.duplicateTask('${t.id}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="task-action-btn" title="Edit Task" onclick="window.BloomFlow.openTaskDrawer('${t.id}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="task-action-btn delete" title="Delete Task" onclick="window.BloomFlow.deleteTask('${t.id}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  /* --------------------------------------------------------------------------
     9. RENDERING: KANBAN BOARD VIEW
     -------------------------------------------------------------------------- */
  function renderKanbanBoard() {
    const statuses = ['todo', 'inprogress', 'review', 'done'];
    statuses.forEach(status => {
      const container = $(`kanban-col-${status}`);
      const countBadge = $(`kanban-count-${status}`);
      if (!container) return;

      const tasks = state.tasks.filter(t => (t.status || 'todo') === status);
      if (countBadge) countBadge.textContent = tasks.length;

      if (tasks.length === 0) {
        container.innerHTML = `<div class="kanban-empty-drop">Drop tasks here</div>`;
        return;
      }

      container.innerHTML = tasks.map(t => {
        const tagObj = state.tags.find(tg => tg.id === t.tag) || { name: t.tag, bg: 'var(--bg-secondary)', color: 'var(--text-secondary)' };
        return `
          <div class="kanban-card priority-${t.priority}" draggable="true" ondragstart="window.BloomFlow.handleDragStart(event, '${t.id}')" onclick="window.BloomFlow.openTaskDrawer('${t.id}')">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <span style="font-size: 1.1rem;">${t.emoji || '🌷'}</span>
              <span class="badge-tag badge-${t.priority}">${t.priority.toUpperCase()}</span>
            </div>
            <div style="font-weight: 700; font-size: 0.92rem; margin-bottom: 8px; color: var(--text-primary);">${escapeHtml(t.title)}</div>
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted);">
              <span class="badge-tag" style="background: ${tagObj.bg}; color: ${tagObj.color};">${tagObj.name}</span>
              <span>⏰ ${t.time || '18:00'}</span>
            </div>
          </div>
        `;
      }).join('');
    });
  }

  function openQuickAddColumn(status) {
    editingTaskId = 'new';
    openTaskDrawer('new');
    const taskStatus = status || 'todo';
    $('modalTaskId').dataset.initialStatus = taskStatus;
  }

  /* --------------------------------------------------------------------------
     10. RENDERING: CALENDAR VIEW & DAY POPOVER
     -------------------------------------------------------------------------- */
  function renderCalendar() {
    const container = $('calendarGrid');
    const titleEl = $('calendarMonthTitle');
    if (!container || !titleEl) return;

    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();

    titleEl.textContent = calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const todayStr = new Date().toISOString().slice(0, 10);
    let cellsHtml = '';

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    days.forEach(d => {
      cellsHtml += `<div class="calendar-day-header">${d}</div>`;
    });

    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = prevMonthDays - i;
      cellsHtml += `
        <div class="calendar-cell other-month">
          <span class="cell-day-num">${dayNum}</span>
        </div>
      `;
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const monthFormatted = String(month + 1).padStart(2, '0');
      const dayFormatted = String(day).padStart(2, '0');
      const dateStr = `${year}-${monthFormatted}-${dayFormatted}`;
      const isToday = dateStr === todayStr;

      const dayTasks = state.tasks.filter(t => {
        if (t.dueDate === dateStr) return true;
        if (t.recurrence === 'daily') return true;
        return false;
      });

      const taskDotsHtml = dayTasks.slice(0, 3).map(t => `
        <div class="cell-task-dot" title="${escapeHtml(t.title)}">${t.emoji || '🌷'} ${escapeHtml(t.title)}</div>
      `).join('');

      const moreIndicator = dayTasks.length > 3 ? `<div style="font-size: 0.68rem; color: var(--text-muted); font-weight: 700;">+${dayTasks.length - 3} more</div>` : '';

      cellsHtml += `
        <div class="calendar-cell ${isToday ? 'today' : ''}" onclick="window.BloomFlow.handleDateClick('${dateStr}')">
          <span class="cell-day-num">${day}</span>
          <div class="cell-tasks">${taskDotsHtml}${moreIndicator}</div>
        </div>
      `;
    }

    container.innerHTML = cellsHtml;
  }

  function handleDateClick(dateStr) {
    selectedCalendarDateStr = dateStr;
    const formattedDate = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    $('calendarDayModalTitle').textContent = `📅 Plans for ${formattedDate}`;

    const dayTasks = state.tasks.filter(t => t.dueDate === dateStr || t.recurrence === 'daily');
    const container = $('calendarDayTasksList');

    if (dayTasks.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">No tasks scheduled for this day.</div>`;
    } else {
      container.innerHTML = dayTasks.map(t => `
        <div class="calendar-day-task-item">
          <span>${t.emoji || '🌷'}</span>
          <span style="flex: 1; ${t.done ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${escapeHtml(t.title)}</span>
          <span class="badge-tag badge-${t.priority}">${t.priority.toUpperCase()}</span>
          <span style="font-size: 0.78rem; color: var(--text-muted);">⏰ ${t.time || '18:00'}</span>
        </div>
      `).join('');
    }

    const addBtn = $('btnCalendarAddDayTask');
    if (addBtn) {
      addBtn.onclick = () => {
        $('calendarDayModal').classList.remove('active');
        openTaskDrawer('new');
        $('modalTaskDueDate').value = dateStr;
      };
    }

    $('calendarDayModal').classList.add('active');
    playSound('click');
  }

  function goToTodayCalendar() {
    calendarDate = new Date();
    renderCalendar();
    playSound('click');
  }

  /* --------------------------------------------------------------------------
     11. POMODORO FOCUS TIMER ENGINE WITH CUSTOM DURATIONS & ALARMS
     -------------------------------------------------------------------------- */
  function updatePomodoroModeButtons() {
    const s = state.pomoSettings || DEFAULT_POMO_SETTINGS;
    const btnWork = $('btnPomoModeWork');
    const btnShort = $('btnPomoModeShort');
    const btnLong = $('btnPomoModeLong');

    if (btnWork) btnWork.textContent = `🍅 Focus (${s.work || 25}m)`;
    if (btnShort) btnShort.textContent = `☕ Short Break (${s.shortBreak || 5}m)`;
    if (btnLong) btnLong.textContent = `🌴 Long Break (${s.longBreak || 15}m)`;
  }

  function openPomoSettingsModal() {
    const s = state.pomoSettings || DEFAULT_POMO_SETTINGS;
    const sounds = state.alarmSounds || DEFAULT_ALARM_SOUNDS;

    if ($('customPomoWork')) $('customPomoWork').value = s.work || 25;
    if ($('customPomoShort')) $('customPomoShort').value = s.shortBreak || 5;
    if ($('customPomoLong')) $('customPomoLong').value = s.longBreak || 15;

    if ($('customPomoShortSound')) $('customPomoShortSound').value = sounds.shortBreak || 'bell';
    if ($('customPomoLongSound')) $('customPomoLongSound').value = sounds.longBreak || 'triumph';
    if ($('customPomoWorkSound')) $('customPomoWorkSound').value = sounds.focus || 'gentle';

    const modal = $('pomoSettingsModalOverlay');
    if (modal) modal.classList.add('active');
    playSound('click');
  }

  function applyPomoPreset(work, shortBreak, longBreak) {
    if ($('customPomoWork')) $('customPomoWork').value = work;
    if ($('customPomoShort')) $('customPomoShort').value = shortBreak;
    if ($('customPomoLong')) $('customPomoLong').value = longBreak;
    playSound('click');
  }

  function savePomoSettings() {
    const work = Math.max(1, parseInt($('customPomoWork').value, 10) || 25);
    const shortBreak = Math.max(1, parseInt($('customPomoShort').value, 10) || 5);
    const longBreak = Math.max(1, parseInt($('customPomoLong').value, 10) || 15);

    state.pomoSettings = { work, shortBreak, longBreak };

    if (!state.alarmSounds) state.alarmSounds = { ...DEFAULT_ALARM_SOUNDS };
    if ($('customPomoShortSound')) state.alarmSounds.shortBreak = $('customPomoShortSound').value;
    if ($('customPomoLongSound')) state.alarmSounds.longBreak = $('customPomoLongSound').value;
    if ($('customPomoWorkSound')) state.alarmSounds.focus = $('customPomoWorkSound').value;

    saveState();
    syncAlarmSoundInputsUI();
    updatePomodoroModeButtons();

    if (!pomoInterval) {
      pomoTimeLeft = getPomoDurationSeconds(pomoMode);
      updatePomodoroDisplay();
    }

    const modal = $('pomoSettingsModalOverlay');
    if (modal) modal.classList.remove('active');
    showToast(`Focus & Break settings saved!`, '⏱️');
    playSound('click');
  }

  function switchPomodoroMode(mode) {
    pomoMode = mode;
    pomoTimeLeft = getPomoDurationSeconds(mode);
    stopPomodoroInterval();

    $$('.pomodoro-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    const labels = { work: 'Deep Work Session', shortBreak: 'Mindful Short Break', longBreak: 'Recharging Long Break' };
    if ($('pomoModeLabel')) $('pomoModeLabel').textContent = labels[mode];

    updatePomodoroDisplay();
  }

  function togglePomodoro() {
    if (pomoInterval) {
      stopPomodoroInterval();
      if ($('btnPomoMain')) $('btnPomoMain').textContent = 'Start Focus';
      playSound('click');
    } else {
      startPomodoroInterval();
      if ($('btnPomoMain')) $('btnPomoMain').textContent = 'Pause';
      playSound('click');
    }
  }

  function handlePomodoroComplete() {
    stopPomodoroInterval();
    const completedMode = pomoMode;
    const s = state.pomoSettings || DEFAULT_POMO_SETTINGS;
    const sounds = state.alarmSounds || DEFAULT_ALARM_SOUNDS;

    let soundToPlay = sounds.focus || 'gentle';
    if (completedMode === 'shortBreak') soundToPlay = sounds.shortBreak || 'bell';
    else if (completedMode === 'longBreak') soundToPlay = sounds.longBreak || 'triumph';

    // Trigger audible alarm sound loop & vibration
    triggerHapticAlarm();
    startContinuousAlarm(soundToPlay);

    const modal = $('alarmModalOverlay');
    const modalIcon = $('alarmModalIcon');
    const modalHeader = $('alarmModalHeader');
    const titleEl = $('alarmTaskTitle');
    const metaEl = $('alarmTaskMeta');
    const actionsEl = $('alarmActionsContainer');

    if (completedMode === 'work') {
      state.focusMinutesToday = (state.focusMinutesToday || 0) + (s.work || 25);
      if (pomoActiveTaskId) {
        const task = state.tasks.find(t => t.id === pomoActiveTaskId);
        if (task) {
          task.pomodorosCompleted = (task.pomodorosCompleted || 0) + 1;
        }
      }
      saveState();
      renderAnalytics();

      if (modalIcon) modalIcon.textContent = '🍅';
      if (modalHeader) modalHeader.textContent = 'Focus Session Complete!';
      if (titleEl) titleEl.textContent = '🎉 Awesome Deep Work!';
      if (metaEl) metaEl.textContent = `You finished ${s.work || 25} minutes of deep flow. Time to recharge! 🌸`;

      if (actionsEl) {
        actionsEl.innerHTML = `
          <button class="btn-primary" onclick="window.BloomFlow.startBreakAfterFocus('shortBreak')" style="flex: 1; min-width: 145px; justify-content: center; padding: 11px;">☕ Short Break (${s.shortBreak || 5}m)</button>
          <button class="nav-btn" onclick="window.BloomFlow.startBreakAfterFocus('longBreak')" style="flex: 1; min-width: 145px; border: 1px solid var(--border-subtle); justify-content: center; padding: 11px;">🌴 Long Break (${s.longBreak || 15}m)</button>
          <button class="nav-btn" onclick="window.BloomFlow.dismissAlarmModal()" style="width: 100%; border: 1px solid var(--border-subtle); justify-content: center; padding: 9px; margin-top: 4px;">✕ Dismiss</button>
        `;
      }

      if (Notification.permission === 'granted') {
        try {
          new Notification('🍅 Focus Session Complete!', {
            body: `Great focus! Time for a mindful ${s.shortBreak || 5}m break.`,
            icon: 'icons/icon.svg',
            vibrate: [400, 200, 400, 200, 500]
          });
        } catch (e) {}
      }

      showToast('Focus session complete! Take a mindful breath.', '🍅', 8000);
    } else {
      // Short Break or Long Break is Over!
      const isShort = completedMode === 'shortBreak';
      const breakName = isShort ? 'Short Break' : 'Long Break';

      if (modalIcon) modalIcon.textContent = isShort ? '☕' : '🌴';
      if (modalHeader) modalHeader.textContent = `${breakName} Finished!`;
      if (titleEl) titleEl.textContent = '⏰ Break Time is Over!';
      if (metaEl) metaEl.textContent = `Your ${breakName.toLowerCase()} has ended. Ready to dive back into deep flow? ✨`;

      if (actionsEl) {
        actionsEl.innerHTML = `
          <button class="btn-primary" onclick="window.BloomFlow.startFocusAfterBreak()" style="flex: 1; min-width: 160px; justify-content: center; padding: 11px;">🍅 Start Focus (${s.work || 25}m)</button>
          <button class="nav-btn" onclick="window.BloomFlow.dismissAlarmModal()" style="flex: 1; min-width: 100px; border: 1px solid var(--border-subtle); justify-content: center; padding: 11px;">✕ Dismiss</button>
        `;
      }

      if (Notification.permission === 'granted') {
        try {
          new Notification(`⏰ ${breakName} is Over!`, {
            body: `Break time is up! Ready for your ${s.work || 25}m focus session?`,
            icon: 'icons/icon.svg',
            vibrate: [400, 200, 400, 200, 500]
          });
        } catch (e) {}
      }

      showToast(`⏰ ${breakName} complete! Time to focus.`, isShort ? '☕' : '🌴', 8000);
    }

    if (modal) modal.classList.add('active');
    triggerConfetti();
  }

  function startPomodoroInterval() {
    if (pomoInterval) return;
    pomoInterval = setInterval(() => {
      if (pomoTimeLeft > 0) {
        pomoTimeLeft--;
        updatePomodoroDisplay();
      } else {
        handlePomodoroComplete();
      }
    }, 1000);
  }

  function stopPomodoroInterval() {
    if (pomoInterval) {
      clearInterval(pomoInterval);
      pomoInterval = null;
    }
    if ($('btnPomoMain')) $('btnPomoMain').textContent = 'Start Focus';
  }

  function resetPomodoro() {
    stopPomodoroInterval();
    pomoTimeLeft = getPomoDurationSeconds(pomoMode);
    updatePomodoroDisplay();
    playSound('click');
  }

  function updatePomodoroDisplay() {
    const mins = Math.floor(pomoTimeLeft / 60);
    const secs = pomoTimeLeft % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if ($('pomoTimeDisplay')) $('pomoTimeDisplay').textContent = timeStr;
    document.title = pomoInterval ? `(${timeStr}) Mimi Focus` : 'Mimi 🌷';

    const circle = $('pomoCircleProgress');
    if (circle) {
      const total = getPomoDurationSeconds(pomoMode);
      const circumference = 2 * Math.PI * 120;
      const offset = circumference - (pomoTimeLeft / total) * circumference;
      circle.style.strokeDasharray = `${circumference}`;
      circle.style.strokeDashoffset = `${offset}`;
    }
  }

  /* --------------------------------------------------------------------------
     12. RENDERING: ANALYTICS & CATEGORY BREAKDOWN
     -------------------------------------------------------------------------- */
  function renderAnalytics() {
    const totalCreated = state.tasks.length;
    const completedTasks = state.tasks.filter(t => t.done);
    const completionRate = totalCreated > 0 ? Math.round((completedTasks.length / totalCreated) * 100) : 0;

    if ($('statTotalCompleted')) $('statTotalCompleted').textContent = completedTasks.length;
    if ($('statCompletionRate')) $('statCompletionRate').textContent = `${completionRate}%`;
    if ($('statStreakCount')) $('statStreakCount').textContent = `${state.streak ? state.streak.count : 0} Days`;
    if ($('statFocusMinutes')) $('statFocusMinutes').textContent = `${state.focusMinutesToday || 0}m`;

    const barContainer = $('weeklyBarChart');
    if (barContainer) {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const todayDayIdx = (new Date().getDay() + 6) % 7; // Mon=0

      const counts = [0, 0, 0, 0, 0, 0, 0];
      counts[todayDayIdx] = completedTasks.length;

      const maxVal = Math.max(...counts, 6);

      barContainer.innerHTML = days.map((day, idx) => {
        const val = counts[idx];
        const heightPercent = Math.max(8, Math.round((val / maxVal) * 100));
        return `
          <div class="bar-col">
            <div class="bar-fill-track">
              <div class="bar-fill" style="height: ${heightPercent}%;"></div>
            </div>
            <span class="bar-label">${day}</span>
          </div>
        `;
      }).join('');
    }

    // Category Breakdown list
    const breakdownContainer = $('categoryBreakdownList');
    if (breakdownContainer) {
      if (totalCreated === 0) {
        breakdownContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 20px;">No task category data yet.</div>`;
      } else {
        breakdownContainer.innerHTML = state.tags.map(t => {
          const count = state.tasks.filter(tk => tk.tag === t.id).length;
          const pct = Math.round((count / totalCreated) * 100);
          return `
            <div class="category-breakdown-item">
              <div class="category-breakdown-meta">
                <span>${t.icon || '🏷️'} ${t.name}</span>
                <span>${count} tasks (${pct}%)</span>
              </div>
              <div class="category-breakdown-track">
                <div class="category-breakdown-bar" style="width: ${pct}%; background: ${t.color};"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }

  /* --------------------------------------------------------------------------
     13. CUSTOM CATEGORY / TAG MANAGER
     -------------------------------------------------------------------------- */
  function openTagModal() {
    $('tagModalOverlay').classList.add('active');
    renderTagsManagerList();
    playSound('click');
  }

  function renderTagsManagerList() {
    const list = $('customTagsManagerList');
    if (!list) return;

    list.innerHTML = state.tags.map(t => `
      <div class="custom-tag-manager-item">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.1rem;">${t.icon || '🏷️'}</span>
          <span style="font-weight: 700; color: var(--text-primary);">${escapeHtml(t.name)}</span>
        </div>
        ${state.tags.length > 1 ? `<button class="task-action-btn delete" onclick="window.BloomFlow.deleteCustomTag('${t.id}')">✕</button>` : ''}
      </div>
    `).join('');
  }

  function createCustomTag() {
    const nameInput = $('newTagName');
    const iconInput = $('newTagIcon');
    const name = nameInput.value.trim();
    const icon = iconInput.value.trim() || '✨';

    if (!name) {
      showToast('Please enter a category name', '⚠️');
      return;
    }

    const tagId = 'tag_' + Date.now().toString(36);
    const colors = ['#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#06b6d4'];
    const selectedColor = colors[state.tags.length % colors.length];

    state.tags.push({
      id: tagId,
      name: name,
      color: selectedColor,
      bg: 'var(--bg-secondary)',
      icon: icon
    });

    saveState();
    nameInput.value = '';
    renderTagsManagerList();
    renderAll();
    populateTagSelectOptions();
    showToast(`Added category "${name}"`, icon);
    playSound('click');
  }

  function deleteCustomTag(tagId) {
    if (state.tags.length <= 1) return;
    state.tags = state.tags.filter(t => t.id !== tagId);
    saveState();
    renderTagsManagerList();
    renderAll();
    populateTagSelectOptions();
    showToast('Category removed', '🗑️');
    playSound('click');
  }

  function populateTagSelectOptions() {
    const selects = ['quickAddTag', 'modalTaskTag'];
    selects.forEach(id => {
      const el = $(id);
      if (el) {
        const prevValue = el.value;
        el.innerHTML = state.tags.map(t => `
          <option value="${t.id}">${t.icon || '🏷️'} ${t.name}</option>
        `).join('');
        if (prevValue && state.tags.some(t => t.id === prevValue)) {
          el.value = prevValue;
        } else if (activeTag && state.tags.some(t => t.id === activeTag)) {
          el.value = activeTag;
        }
      }
    });
  }

  /* --------------------------------------------------------------------------
     14. TASK DRAWER & EDIT MODAL
     -------------------------------------------------------------------------- */
  function openTaskDrawer(id) {
    editingTaskId = id;
    populateTagSelectOptions();

    const modalTitleEl = $('drawerModalTitle');
    const modalSaveBtn = $('drawerSaveBtn');
    const defaultAlarmSound = (state.alarmSounds ? state.alarmSounds.task : 'melody') || 'melody';

    if (id === 'new') {
      if (modalTitleEl) modalTitleEl.textContent = '✨ Create New Task';
      if (modalSaveBtn) modalSaveBtn.textContent = '＋ Create Task';

      const now = new Date();
      const currentHH = String(now.getHours()).padStart(2, '0');
      const currentMM = String(now.getMinutes()).padStart(2, '0');

      $('modalTaskId').value = '';
      $('modalTaskTitle').value = '';
      $('modalTaskDesc').value = '';
      $('modalTaskEmoji').value = '🌷';
      $('modalTaskPriority').value = 'p3';
      const initialTag = activeTag || (state.tags[0] ? state.tags[0].id : 'personal');
      if ($('modalTaskTag')) $('modalTaskTag').value = initialTag;
      $('modalTaskDueDate').value = new Date().toISOString().slice(0, 10);
      $('modalTaskTime').value = `${currentHH}:${currentMM}`;
      $('modalTaskRecurrence').value = 'once';
      if ($('modalTaskAlarmSound')) $('modalTaskAlarmSound').value = defaultAlarmSound;
      $('newSubtaskText').value = '';

      drawerSubtasks = [];
      renderSubtasksList(drawerSubtasks);

      $('taskDrawerOverlay').classList.add('active');
      playSound('click');
      setTimeout(() => $('modalTaskTitle').focus(), 80);
      return;
    }

    const task = state.tasks.find(t => t.id === id);
    if (!task) return;

    if (modalTitleEl) modalTitleEl.textContent = '✏️ Edit Task Details';
    if (modalSaveBtn) modalSaveBtn.textContent = 'Save Changes';

    $('modalTaskId').value = task.id;
    $('modalTaskTitle').value = task.title;
    $('modalTaskDesc').value = task.description || '';
    $('modalTaskEmoji').value = task.emoji || '🌷';
    $('modalTaskPriority').value = task.priority || 'p3';
    $('modalTaskTag').value = task.tag || (state.tags[0] ? state.tags[0].id : 'personal');
    $('modalTaskDueDate').value = task.dueDate || '';
    $('modalTaskTime').value = task.time || '18:00';
    $('modalTaskRecurrence').value = task.recurrence || 'once';
    if ($('modalTaskAlarmSound')) $('modalTaskAlarmSound').value = task.alarmSound || defaultAlarmSound;
    $('newSubtaskText').value = '';

    drawerSubtasks = task.subtasks ? JSON.parse(JSON.stringify(task.subtasks)) : [];
    renderSubtasksList(drawerSubtasks);

    $('taskDrawerOverlay').classList.add('active');
    playSound('click');
    setTimeout(() => $('modalTaskTitle').focus(), 80);
  }

  function renderSubtasksList(subtasks) {
    const container = $('subtasksListContainer');
    const countBadge = $('subtasksCountBadge');
    if (!container) return;

    const completed = subtasks.filter(s => s.done).length;
    if (countBadge) countBadge.textContent = `${completed}/${subtasks.length}`;

    if (!subtasks || subtasks.length === 0) {
      container.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted); padding: 4px 0;">No subtasks added yet.</div>';
      return;
    }

    container.innerHTML = subtasks.map((st, idx) => `
      <div class="subtask-item">
        <input type="checkbox" class="check" ${st.done ? 'checked' : ''} onchange="window.BloomFlow.toggleSubtask(${idx})">
        <input type="text" class="subtask-input" value="${escapeHtml(st.text)}" onchange="window.BloomFlow.updateSubtaskText(${idx}, this.value)">
        <button class="task-action-btn delete" onclick="window.BloomFlow.removeSubtask(${idx})">✕</button>
      </div>
    `).join('');
  }

  function closeTaskDrawer() {
    $('taskDrawerOverlay').classList.remove('active');
    editingTaskId = null;
    drawerSubtasks = [];
  }

  function saveTaskDrawerForm() {
    if (!editingTaskId) return;

    const title = $('modalTaskTitle').value.trim();
    if (!title) {
      showToast('Task title cannot be empty', '⚠️');
      $('modalTaskTitle').focus();
      return;
    }

    const initialStatus = $('modalTaskId').dataset.initialStatus || 'todo';
    let chosenTime = $('modalTaskTime').value || '18:00';
    if (chosenTime.includes(':')) {
      const [th, tm = '00'] = chosenTime.split(':');
      chosenTime = `${String(parseInt(th, 10)).padStart(2, '0')}:${tm.padStart(2, '0')}`;
    }

    const chosenAlarmSound = $('modalTaskAlarmSound') ? $('modalTaskAlarmSound').value : ((state.alarmSounds ? state.alarmSounds.task : 'melody') || 'melody');

    if (editingTaskId === 'new') {
      addTask({
        title,
        description: $('modalTaskDesc').value.trim(),
        emoji: $('modalTaskEmoji').value,
        priority: $('modalTaskPriority').value,
        tag: $('modalTaskTag').value,
        dueDate: $('modalTaskDueDate').value,
        time: chosenTime,
        alarmSound: chosenAlarmSound,
        recurrence: $('modalTaskRecurrence').value,
        subtasks: drawerSubtasks,
        status: initialStatus
      });
      closeTaskDrawer();
      return;
    }

    const task = state.tasks.find(t => t.id === editingTaskId);
    if (!task) return;

    task.title = title;
    task.description = $('modalTaskDesc').value.trim();
    task.emoji = $('modalTaskEmoji').value;
    task.priority = $('modalTaskPriority').value;
    task.tag = $('modalTaskTag').value;
    task.dueDate = $('modalTaskDueDate').value;
    task.time = chosenTime;
    task.alarmSound = chosenAlarmSound;
    task.recurrence = $('modalTaskRecurrence').value;
    task.subtasks = drawerSubtasks;

    saveState();
    closeTaskDrawer();
    showToast('Task updated successfully', '💾');
    renderAll();
  }

  /* --------------------------------------------------------------------------
     15. COMMAND PALETTE (Ctrl+K) & SHORTCUTS MODAL
     -------------------------------------------------------------------------- */
  function openCommandPalette() {
    $('commandPaletteOverlay').classList.add('active');
    $('commandInput').value = '';
    $('commandInput').focus();
    renderCommandResults('');
    playSound('click');
  }

  function closeCommandPalette() {
    $('commandPaletteOverlay').classList.remove('active');
  }

  function openShortcutsModal() {
    $('shortcutsModalOverlay').classList.add('active');
    playSound('click');
  }

  function renderCommandResults(query) {
    const container = $('commandResults');
    if (!container) return;

    const q = query.toLowerCase().trim();

    const actions = [
      { id: 'view-today', title: "Go to Today's Flow", icon: '☀️', type: 'View', action: () => switchView('today') },
      { id: 'view-inbox', title: "View All Tasks & Inbox", icon: '📥', type: 'View', action: () => switchView('inbox') },
      { id: 'view-upcoming', title: "View Upcoming Schedule", icon: '📅', type: 'View', action: () => switchView('upcoming') },
      { id: 'view-kanban', title: 'Open Kanban Board', icon: '📋', type: 'View', action: () => switchView('kanban') },
      { id: 'view-calendar', title: 'Open Calendar Schedule', icon: '🗓️', type: 'View', action: () => switchView('calendar') },
      { id: 'view-pomo', title: 'Open Pomodoro Focus Timer', icon: '⏱️', type: 'Tool', action: () => switchView('pomodoro') },
      { id: 'view-analytics', title: 'View Productivity Analytics', icon: '📊', type: 'Analytics', action: () => switchView('analytics') },
      { id: 'theme-blossom', title: 'Switch to Soft Blossom Theme', icon: '🌸', type: 'Theme', action: () => setTheme('blossom') },
      { id: 'theme-dark', title: 'Switch to Midnight Dark Theme', icon: '🌙', type: 'Theme', action: () => setTheme('dark') },
      { id: 'theme-light', title: 'Switch to Modern Light Theme', icon: '☀️', type: 'Theme', action: () => setTheme('light') },
      { id: 'theme-ocean', title: 'Switch to Ocean Breeze Theme', icon: '🌊', type: 'Theme', action: () => setTheme('ocean') }
    ];

    const filteredActions = actions.filter(a => a.title.toLowerCase().includes(q));
    const matchingTasks = state.tasks.filter(t => t.title.toLowerCase().includes(q)).slice(0, 5);

    let html = '';

    if (matchingTasks.length > 0) {
      html += `<div class="command-group-title">Matching Tasks</div>`;
      html += matchingTasks.map(t => `
        <div class="command-item" onclick="window.BloomFlow.openTaskDrawer('${t.id}'); window.BloomFlow.closeCommandPalette();">
          <span>${t.emoji || '🌷'}</span>
          <span>${escapeHtml(t.title)}</span>
          <span class="command-item-badge">Task</span>
        </div>
      `).join('');
    }

    if (filteredActions.length > 0) {
      html += `<div class="command-group-title">Actions & Navigation</div>`;
      html += filteredActions.map(a => `
        <div class="command-item" onclick="window.BloomFlow.executeCommand('${a.id}'); window.BloomFlow.closeCommandPalette();">
          <span>${a.icon}</span>
          <span>${escapeHtml(a.title)}</span>
          <span class="command-item-badge">${a.type}</span>
        </div>
      `).join('');
    }

    if (!html) {
      html = `<div style="text-align: center; padding: 24px; color: var(--text-muted);">No matching commands or tasks</div>`;
    }

    container.innerHTML = html;
  }

  /* --------------------------------------------------------------------------
     16. THEME SWITCHER ENGINE
     -------------------------------------------------------------------------- */
  function setTheme(themeName) {
    state.theme = themeName;
    document.documentElement.setAttribute('data-theme', themeName);
    saveState();
    playSound('click');
    showToast(`Theme changed to ${capitalize(themeName)}`, '🎨');
  }

  /* --------------------------------------------------------------------------
     17. NOTIFICATIONS & PRECISE LIVE REMINDER ALARM DAEMON
     -------------------------------------------------------------------------- */
  async function requestNotificationPermission() {
    if (!('Notification' in window)) {
      showToast('Notifications are not supported in this browser.', '⚠️');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      try {
        new Notification('Mimi 🌷', {
          body: 'Gentle alarms and notifications are active!',
          icon: 'icons/icon.svg'
        });
      } catch (e) {}
      showToast('Alarms & notifications enabled!', '🔔');
    } else {
      showToast('Notifications permission was not granted.', '⚠️');
    }
  }

  function checkLiveReminders() {
    const now = new Date();
    const currentHH = String(now.getHours()).padStart(2, '0');
    const currentMM = String(now.getMinutes()).padStart(2, '0');
    const currentHHMM = `${currentHH}:${currentMM}`;
    const todayStr = now.toISOString().slice(0, 10);
    const dayOfWeek = now.getDay();
    const stamp = `${todayStr}_${currentHHMM}`;

    let updated = false;

    state.tasks.forEach(t => {
      if (t.done) return;
      if (t.lastNotified === stamp) return;

      // Normalize task time to HH:MM
      let taskTime = t.time || '18:00';
      if (taskTime.includes(':')) {
        const [th, tm = '00'] = taskTime.split(':');
        taskTime = `${String(parseInt(th, 10)).padStart(2, '0')}:${tm.padStart(2, '0')}`;
      }

      let isDue = false;
      if (taskTime === currentHHMM) {
        if (t.recurrence === 'daily') isDue = true;
        else if (t.recurrence === 'weekdays' && dayOfWeek >= 1 && dayOfWeek <= 5) isDue = true;
        else if (t.recurrence === 'weekend' && (dayOfWeek === 0 || dayOfWeek === 6)) isDue = true;
        else if (t.recurrence === 'once' && t.dueDate === todayStr) isDue = true;
        else if (!t.recurrence && t.dueDate === todayStr) isDue = true;
      }

      if (isDue) {
        t.lastNotified = stamp;
        updated = true;
        startAlarmRinging(t);
      }
    });

    if (updated) saveState();
  }

  /* --------------------------------------------------------------------------
     18. DATA BACKUP, EXPORT, MARKDOWN & IMPORT
     -------------------------------------------------------------------------- */
  function exportDailyAgendaMarkdown() {
    const today = new Date().toISOString().slice(0, 10);
    const dateFormatted = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    let md = `# 🌷 Daily Flow Agenda — ${dateFormatted}\n\n`;
    md += `*Generated by Mimi*\n\n`;
    md += `## ☀️ Active Tasks\n\n`;

    const activeList = state.tasks.filter(t => !t.done);
    if (activeList.length === 0) {
      md += `*No active tasks for today!*\n\n`;
    } else {
      activeList.forEach(t => {
        const priorityLabels = { p1: '🔴 Urgent', p2: '🟠 High', p3: '🟡 Medium', p4: '🟢 Low' };
        md += `- [ ] **${t.title}** ${t.emoji || '🌷'} — \`${t.time || '18:00'}\` | ${priorityLabels[t.priority] || 'Medium'}\n`;
        if (t.description) {
          md += `  > ${t.description}\n`;
        }
        if (t.subtasks && t.subtasks.length > 0) {
          t.subtasks.forEach(st => {
            md += `  - [${st.done ? 'x' : ' '}] ${st.text}\n`;
          });
        }
      });
      md += `\n`;
    }

    md += `## ✅ Completed Today\n\n`;
    const completedList = state.tasks.filter(t => t.done);
    if (completedList.length === 0) {
      md += `*No completed tasks yet.*\n\n`;
    } else {
      completedList.forEach(t => {
        md += `- [x] ~${t.title}~ ${t.emoji || '🌷'}\n`;
      });
      md += `\n`;
    }

    const dataStr = "data:text/markdown;charset=utf-8," + encodeURIComponent(md);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `daily_agenda_${today}.md`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Daily agenda downloaded as Markdown!', '📝');
  }

  function exportDataJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `mimi_backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Data exported successfully!', '📥');
  }

  function exportDataCSV() {
    let csv = "ID,Title,Priority,Tag,Status,Due Date,Time,Recurrence\n";
    state.tasks.forEach(t => {
      csv += `"${t.id}","${t.title.replace(/"/g, '""')}","${t.priority}","${t.tag}","${t.status}","${t.dueDate}","${t.time}","${t.recurrence}"\n`;
    });

    const dataStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `mimi_tasks_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Tasks exported to CSV!', '📊');
  }

  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const imported = JSON.parse(e.target.result);
        if (imported.tasks && Array.isArray(imported.tasks)) {
          state = { ...defaultState, ...imported };
          saveState();
          renderAll();
          showToast(`Imported ${state.tasks.length} tasks!`, '🎉');
        } else {
          showToast('Invalid backup file format', '⚠️');
        }
      } catch (err) {
        showToast('Failed to parse JSON backup', '⚠️');
      }
    };
    reader.readAsText(file);
  }

  function loadSampleData() {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    state.tasks = [
      {
        id: 'demo-1',
        title: 'Design high-converting SaaS landing page',
        description: 'Refine hero typography, glassmorphism cards, and interactive CTA buttons.',
        emoji: '✨',
        priority: 'p1',
        tag: 'work',
        status: 'inprogress',
        done: false,
        dueDate: today,
        time: '10:00',
        recurrence: 'once',
        subtasks: [
          { id: 'sub-1', text: 'Create wireframe layout', done: true },
          { id: 'sub-2', text: 'Craft theme color tokens', done: true },
          { id: 'sub-3', text: 'Implement responsive mobile nav', done: false }
        ],
        pomodorosEstimated: 3,
        pomodorosCompleted: 1,
        createdAt: new Date().toISOString(),
        completedAt: null,
        lastNotified: ''
      },
      {
        id: 'demo-2',
        title: '30-minute afternoon mindful meditation & walk',
        description: 'Step outside, breathe deeply, and disconnect from screens.',
        emoji: '🌸',
        priority: 'p3',
        tag: 'health',
        status: 'todo',
        done: false,
        dueDate: today,
        time: '17:30',
        recurrence: 'daily',
        subtasks: [],
        pomodorosEstimated: 1,
        pomodorosCompleted: 0,
        createdAt: new Date().toISOString(),
        completedAt: null,
        lastNotified: ''
      },
      {
        id: 'demo-3',
        title: 'Study TypeScript Generics and Design Patterns',
        description: 'Read Chapter 4 & build example polymorphic utility types.',
        emoji: '📚',
        priority: 'p2',
        tag: 'study',
        status: 'todo',
        done: false,
        dueDate: tomorrow,
        time: '20:00',
        recurrence: 'weekdays',
        subtasks: [
          { id: 'sub-4', text: 'Practice conditional types', done: false }
        ],
        pomodorosEstimated: 2,
        pomodorosCompleted: 0,
        createdAt: new Date().toISOString(),
        completedAt: null,
        lastNotified: ''
      }
    ];

    state.streak = { count: 1, lastDate: today };
    saveState();
    renderAll();
    triggerConfetti();
    playSound('triumph');
    showToast('Loaded demo dataset!', '🚀');
  }

  function resetAllData() {
    if (confirm('Are you sure you want to clear all tasks and start completely fresh?')) {
      state = { ...defaultState, tasks: [], streak: { count: 0, lastDate: '' }, focusMinutesToday: 0 };
      saveState();
      renderAll();
      showToast('All tasks cleared. Fresh start!', '🧹');
    }
  }

  /* --------------------------------------------------------------------------
     19. UTILITY HELPERS
     -------------------------------------------------------------------------- */
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m]));
  }

  function capitalize(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function updateSidebarBadges() {
    const todayTasks = state.tasks.filter(t => !t.done);
    if ($('inboxBadge')) $('inboxBadge').textContent = state.tasks.length;
    if ($('todayBadge')) $('todayBadge').textContent = todayTasks.length;
  }

  function renderTagsSidebar() {
    const container = $('tagsSidebarList');
    if (!container) return;

    container.innerHTML = state.tags.map(t => {
      const count = state.tasks.filter(tk => tk.tag === t.id && !tk.done).length;
      return `
        <button class="tag-nav-btn ${activeTag === t.id ? 'active' : ''}" data-tag="${t.id}" onclick="window.BloomFlow.switchTag('${t.id}')">
          <span class="tag-dot" style="background: ${t.color};"></span>
          <span>${t.icon || '🏷️'} ${t.name}</span>
          <span style="margin-left: auto; font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">${count}</span>
        </button>
      `;
    }).join('');
  }

  function renderAll() {
    renderListView();
    renderKanbanBoard();
    renderCalendar();
    renderAnalytics();
    renderStreak();
    renderTagsSidebar();
    populateTagSelectOptions();
    updateSidebarBadges();
    updateSoundUI();
    updatePomodoroModeButtons();
    syncAlarmSoundInputsUI();
  }

  /* --------------------------------------------------------------------------
     20. GLOBAL EVENT LISTENERS & INITIALIZATION
     -------------------------------------------------------------------------- */
  function initEventListeners() {
    // Check onboarding banner visibility
    if (state.onboardingDismissed && $('onboardingBanner')) {
      $('onboardingBanner').remove();
    }

    // Nav Click Listeners
    $$('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    $$('.mobile-nav-item').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Filter Chips
    $$('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeFilter = chip.dataset.filter;
        renderListView();
      });
    });

    // Quick Add Form: Accurate time & field detection
    const quickAddBtn = $('quickAddSubmit');
    const quickAddInput = $('quickAddTitle');

    function handleQuickAddSubmit() {
      const raw = quickAddInput.value.trim();
      if (!raw) return;

      const parsed = parseNaturalLanguageTask(raw);
      if (!parsed.title) return;

      // Accurate time: takes parsed @time or the exact chosen quickAddTime input
      const chosenTime = parsed.time || $('quickAddTime').value || '18:00';
      const chosenDueDate = parsed.dueDate || new Date().toISOString().slice(0, 10);
      const chosenPriority = parsed.priority || $('quickAddPriority').value || 'p3';
      const selectedDropdownTag = $('quickAddTag') ? $('quickAddTag').value : null;
      const chosenTag = parsed.tag || selectedDropdownTag || activeTag || (state.tags[0] ? state.tags[0].id : 'personal');

      // If user adds task while viewing completed tab, automatically switch to 'all' so task is visible immediately
      if (activeFilter === 'completed') {
        activeFilter = 'all';
        $$('.filter-chip').forEach(c => c.classList.toggle('active', c.dataset.filter === 'all'));
      }

      addTask({
        title: parsed.title,
        emoji: $('quickAddEmoji').value,
        priority: chosenPriority,
        tag: chosenTag,
        time: chosenTime,
        dueDate: chosenDueDate,
        recurrence: $('quickAddRecurrence').value
      });

      quickAddInput.value = '';
    }

    if (quickAddBtn) quickAddBtn.addEventListener('click', handleQuickAddSubmit);
    if (quickAddInput) {
      quickAddInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleQuickAddSubmit();
      });
    }

    // Global Hotkeys
    window.addEventListener('keydown', (e) => {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCommandPalette();
      } else if (e.key === 'Escape') {
        closeCommandPalette();
        closeTaskDrawer();
        const settingsModal = $('settingsModalOverlay');
        if (settingsModal) settingsModal.classList.remove('active');
        const calModal = $('calendarDayModal');
        if (calModal) calModal.classList.remove('active');
        const tagModal = $('tagModalOverlay');
        if (tagModal) tagModal.classList.remove('active');
        const shortcutsModal = $('shortcutsModalOverlay');
        if (shortcutsModal) shortcutsModal.classList.remove('active');
        const pomoSettingsModal = $('pomoSettingsModalOverlay');
        if (pomoSettingsModal) pomoSettingsModal.classList.remove('active');
        const alarmModal = $('alarmModalOverlay');
        if (alarmModal) {
          stopAlarmRingingSound();
          alarmModal.classList.remove('active');
        }
      } else if (!isInput) {
        if (e.key === '?') {
          openShortcutsModal();
        } else if (e.key.toLowerCase() === 'n') {
          e.preventDefault();
          openTaskDrawer('new');
        } else if (e.key.toLowerCase() === 'f') {
          switchView('pomodoro');
        } else if (['1', '2', '3', '4', '5', '6'].includes(e.key)) {
          const views = { '1': 'today', '2': 'inbox', '3': 'upcoming', '4': 'kanban', '5': 'calendar', '6': 'analytics' };
          switchView(views[e.key]);
        }
      }
    });

    const commandInput = $('commandInput');
    if (commandInput) {
      commandInput.addEventListener('input', (e) => {
        renderCommandResults(e.target.value);
      });
    }

    // Mobile Menu Toggle & Backdrop
    const mobileMenuBtn = $('mobileMenuToggle');
    const sidebarBackdrop = $('sidebarBackdrop');
    if (mobileMenuBtn) {
      mobileMenuBtn.addEventListener('click', () => {
        $('sidebar').classList.toggle('open');
        if (sidebarBackdrop) sidebarBackdrop.classList.toggle('active', $('sidebar').classList.contains('open'));
      });
    }

    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', () => {
        $('sidebar').classList.remove('open');
        sidebarBackdrop.classList.remove('active');
      });
    }

    // Pomodoro Controls
    $$('.pomodoro-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => switchPomodoroMode(btn.dataset.mode));
    });

    const pomoMainBtn = $('btnPomoMain');
    if (pomoMainBtn) pomoMainBtn.addEventListener('click', togglePomodoro);

    const pomoResetBtn = $('btnPomoReset');
    if (pomoResetBtn) pomoResetBtn.addEventListener('click', resetPomodoro);

    // Calendar Navigation
    const prevMonthBtn = $('calPrevMonth');
    if (prevMonthBtn) {
      prevMonthBtn.addEventListener('click', () => {
        calendarDate.setMonth(calendarDate.getMonth() - 1);
        renderCalendar();
        playSound('click');
      });
    }

    const nextMonthBtn = $('calNextMonth');
    if (nextMonthBtn) {
      nextMonthBtn.addEventListener('click', () => {
        calendarDate.setMonth(calendarDate.getMonth() + 1);
        renderCalendar();
        playSound('click');
      });
    }

    // Settings Modal
    const settingsBtn = $('settingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        $('settingsModalOverlay').classList.add('active');
        playSound('click');
      });
    }

    // Subtask Add Input
    const addSubtaskBtn = $('btnAddSubtask');
    if (addSubtaskBtn) {
      addSubtaskBtn.addEventListener('click', () => {
        const textInput = $('newSubtaskText');
        const text = textInput.value.trim();
        if (!text) return;

        drawerSubtasks.push({ id: 'st_' + Date.now(), text, done: false });
        renderSubtasksList(drawerSubtasks);
        textInput.value = '';
        textInput.focus();
        playSound('click');
      });
    }

    const subtaskTextInput = $('newSubtaskText');
    if (subtaskTextInput) {
      subtaskTextInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addSubtaskBtn.click();
        }
      });
    }

    // High-Frequency Alarm Reminder Daemon (Every 3 seconds)
    setInterval(checkLiveReminders, 3000);
  }

  /* --------------------------------------------------------------------------
     21. PWA & ANDROID INSTALL PROMPT HANDLER
     -------------------------------------------------------------------------- */
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  function triggerInstallPrompt() {
    if (!deferredPrompt) {
      showToast('To install on Android: Tap Chrome Menu (⋮) → "Add to Home screen" or "Install app".', '📱', 6000);
      return;
    }

    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        showToast('Thank you for installing Mimi! 🌸', '🎉');
      }
      deferredPrompt = null;
    });
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => console.log('Mimi Service Worker registered:', reg.scope))
          .catch(err => console.log('Service Worker registration failed:', err));
      });
    }
  }

  /* --------------------------------------------------------------------------
     22. PUBLIC API EXPORTS FOR DOM ONCLICK BINDINGS
     -------------------------------------------------------------------------- */
  window.BloomFlow = {
    toggleTask: toggleTaskDone,
    duplicateTask: duplicateTask,
    deleteTask: deleteTask,
    clearCompletedTasks: clearCompletedTasks,
    openTaskDrawer: openTaskDrawer,
    closeTaskDrawer: closeTaskDrawer,
    saveTaskDrawer: saveTaskDrawerForm,
    switchView: switchView,
    switchTag: switchTag,
    setSort: setSort,
    toggleSound: toggleSound,
    setAmbientSound: setAmbientSound,
    setTheme: setTheme,
    openCommandPalette: openCommandPalette,
    closeCommandPalette: closeCommandPalette,
    openShortcutsModal: openShortcutsModal,
    openTagModal: openTagModal,
    createCustomTag: createCustomTag,
    deleteCustomTag: deleteCustomTag,
    requestNotifications: requestNotificationPermission,
    exportDailyAgendaMarkdown: exportDailyAgendaMarkdown,
    exportJSON: exportDataJSON,
    exportCSV: exportDataCSV,
    importFile: handleImportFile,
    loadSampleData: loadSampleData,
    resetData: resetAllData,
    promptInstall: triggerInstallPrompt,
    syncNow: checkServerAndSync,
    dismissOnboarding: dismissOnboarding,
    openQuickAddColumn: openQuickAddColumn,
    handleDateClick: handleDateClick,
    goToTodayCalendar: goToTodayCalendar,
    snoozeAlarm: snoozeAlarm,
    completeAlarmTask: completeAlarmTask,
    dismissAlarmModal: dismissAlarmModal,
    openPomoSettingsModal: openPomoSettingsModal,
    savePomoSettings: savePomoSettings,
    applyPomoPreset: applyPomoPreset,
    startBreakAfterFocus: startBreakAfterFocus,
    startFocusAfterBreak: startFocusAfterBreak,
    previewSelectedSound: previewSelectedSound,
    updateAlarmSoundSetting: updateAlarmSoundSetting,
    testAlarmSound: (type) => {
      const sounds = state.alarmSounds || DEFAULT_ALARM_SOUNDS;
      previewSelectedSound(sounds[type] || 'melody');
    },

    startFocusTask: (id) => {
      pomoActiveTaskId = id;
      switchView('pomodoro');
      const task = state.tasks.find(t => t.id === id);
      if (task) {
        $('pomoActiveTaskTitle').textContent = `${task.emoji || '🌷'} ${task.title}`;
      }
    },

    toggleSubtask: (idx) => {
      if (drawerSubtasks && drawerSubtasks[idx]) {
        drawerSubtasks[idx].done = !drawerSubtasks[idx].done;
        renderSubtasksList(drawerSubtasks);
      }
    },

    updateSubtaskText: (idx, text) => {
      if (drawerSubtasks && drawerSubtasks[idx]) {
        drawerSubtasks[idx].text = text;
      }
    },

    removeSubtask: (idx) => {
      if (drawerSubtasks && drawerSubtasks[idx] !== undefined) {
        drawerSubtasks.splice(idx, 1);
        renderSubtasksList(drawerSubtasks);
        playSound('click');
      }
    },

    handleDragStart: (e, id) => {
      e.dataTransfer.setData('text/plain', id);
    },

    handleDrop: (e, newStatus) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const task = state.tasks.find(t => t.id === id);
      if (task) {
        task.status = newStatus;
        if (newStatus === 'done' && !task.done) {
          task.done = true;
          task.completedAt = new Date().toISOString();
          triggerConfetti();
          playSound('complete');
        } else if (newStatus !== 'done' && task.done) {
          task.done = false;
          task.completedAt = null;
        }
        saveState();
        renderAll();
        playSound('click');
        showToast(`Moved to ${capitalize(newStatus)}`, '📋');
      }
    },

    handleDragOver: (e) => {
      e.preventDefault();
    },

    executeCommand: (cmdId) => {
      if (cmdId === 'view-today') switchView('today');
      else if (cmdId === 'view-inbox') switchView('inbox');
      else if (cmdId === 'view-upcoming') switchView('upcoming');
      else if (cmdId === 'view-kanban') switchView('kanban');
      else if (cmdId === 'view-calendar') switchView('calendar');
      else if (cmdId === 'view-pomo') switchView('pomodoro');
      else if (cmdId === 'view-analytics') switchView('analytics');
      else if (cmdId === 'theme-blossom') setTheme('blossom');
      else if (cmdId === 'theme-dark') setTheme('dark');
      else if (cmdId === 'theme-light') setTheme('light');
      else if (cmdId === 'theme-ocean') setTheme('ocean');
    }
  };

  // Bootstrap Application on DOM Ready
  document.addEventListener('DOMContentLoaded', () => {
    if (state.theme) {
      document.documentElement.setAttribute('data-theme', state.theme);
    }
    initEventListeners();
    registerServiceWorker();
    updatePomodoroDisplay();
    renderAll();
    checkServerAndSync();
  });

})();
