/**
 * Gemini TTS Studio — Client-Side Application
 * Calls the Gemini REST API directly from the browser.
 * Audio is returned as raw PCM and converted to WAV for playback.
 */

// ── State ──────────────────────────────────────────────
const state = {
  apiKey: '',
  isGenerating: false,
  currentAudioBlob: null,
  history: [],
};

// ── DOM Elements ───────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const apiKeyInput = $('#api-key-input');
const toggleKeyBtn = $('#toggle-key-visibility');
const textInput = $('#text-input');
const charCount = $('#char-count');
const clearTextBtn = $('#clear-text');
const stylePrompt = $('#style-prompt');
const audioProfile = $('#audio-profile');
const styleSelect = $('#style-select');
const paceSelect = $('#pace-select');
const accentSelect = $('#accent-select');
const voiceSelect = $('#voice-select');
const modelSelect = $('#model-select');
const multiSpeakerToggle = $('#multi-speaker-toggle');
const audioTagsToggle = $('#audio-tags-toggle');
const generateBtn = $('#generate-btn');
const btnContent = $('.btn-content');
const btnLoading = $('.btn-loading');
const outputEmpty = $('#output-empty');
const audioPlayerWrapper = $('#audio-player-wrapper');
const audioPlayer = $('#audio-player');
const downloadBtn = $('#download-btn');
const outputError = $('#output-error');
const errorMessage = $('#error-message');
const historySection = $('#history-section');
const historyList = $('#history-list');
const toastContainer = $('#toast-container');

// ── Init ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSavedState();
  setupEventListeners();
  updateCharCount();
});

function loadSavedState() {
  const savedKey = localStorage.getItem('gemini-tts-api-key');
  if (savedKey) {
    apiKeyInput.value = savedKey;
    state.apiKey = savedKey;
  }

  const savedVoice = localStorage.getItem('gemini-tts-voice');
  if (savedVoice) voiceSelect.value = savedVoice;

  const savedModel = localStorage.getItem('gemini-tts-model');
  if (savedModel) modelSelect.value = savedModel;

  const savedHistory = localStorage.getItem('gemini-tts-history');
  if (savedHistory) {
    try {
      state.history = JSON.parse(savedHistory);
      renderHistory();
    } catch (e) { /* ignore */ }
  }
}

function saveState() {
  localStorage.setItem('gemini-tts-api-key', state.apiKey);
  localStorage.setItem('gemini-tts-voice', voiceSelect.value);
  localStorage.setItem('gemini-tts-model', modelSelect.value);
  localStorage.setItem('gemini-tts-history', JSON.stringify(state.history.slice(0, 20)));
}

// ── Event Listeners ────────────────────────────────────
function setupEventListeners() {
  // API Key
  apiKeyInput.addEventListener('input', () => {
    state.apiKey = apiKeyInput.value.trim();
    saveState();
  });

  toggleKeyBtn.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    $('#eye-icon').style.display = isPassword ? 'none' : 'block';
    $('#eye-off-icon').style.display = isPassword ? 'block' : 'none';
  });

  // Text Input
  textInput.addEventListener('input', updateCharCount);
  clearTextBtn.addEventListener('click', () => {
    textInput.value = '';
    updateCharCount();
    textInput.focus();
  });

  // Settings persistence
  voiceSelect.addEventListener('change', saveState);
  modelSelect.addEventListener('change', saveState);

  // Generate
  generateBtn.addEventListener('click', generateSpeech);

  // Download
  downloadBtn.addEventListener('click', downloadAudio);

  // Keyboard shortcut: Ctrl+Enter to generate
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      generateSpeech();
    }
  });
}

function updateCharCount() {
  const len = textInput.value.length;
  charCount.textContent = `${len.toLocaleString()} character${len !== 1 ? 's' : ''}`;
}

// ── Generate Speech ────────────────────────────────────
async function generateSpeech() {
  // Validation
  if (!state.apiKey) {
    showToast('Please enter your API key first', 'error');
    apiKeyInput.focus();
    return;
  }

  const text = textInput.value.trim();
  if (!text) {
    showToast('Please enter some text to convert', 'error');
    textInput.focus();
    return;
  }

  if (state.isGenerating) return;

  // Start
  setGenerating(true);
  hideError();
  hidePlayer();

  try {
    const model = modelSelect.value;
    const voiceName = voiceSelect.value;
    const customStyle = stylePrompt.value.trim();
    const profile = audioProfile.value.trim();
    const styleVal = styleSelect.value;
    const paceVal = paceSelect.value;
    const accentVal = accentSelect.value;
    const isMultiSpeaker = multiSpeakerToggle.checked;
    const useAudioTags = audioTagsToggle.checked;

    // Build the system instruction from all settings
    const systemParts = [];

    // Audio Profile
    if (profile) {
      systemParts.push(`Voice persona: ${profile}`);
    }

    // Director's Note: Style
    if (styleVal) {
      systemParts.push(`Delivery style — ${styleVal}`);
    }

    // Director's Note: Pace
    if (paceVal) {
      systemParts.push(`Speaking pace — ${paceVal}`);
    }

    // Director's Note: Accent
    if (accentVal) {
      systemParts.push(accentVal);
    }

    // Custom style prompt
    if (customStyle) {
      systemParts.push(customStyle);
    }

    if (isMultiSpeaker) {
      systemParts.push('This is a multi-speaker dialogue. Please voice each speaker distinctly based on their speaker labels.');
    }
    if (useAudioTags) {
      systemParts.push('Use audio tags for granular control of tone, pacing, and expression as appropriate for the content.');
    }

    const contents = [];

    // TTS models don't support system_instruction.
    // Prepend style directions into the text prompt instead.
    let finalText = text;
    if (systemParts.length > 0) {
      const directions = systemParts.join('. ');
      finalText = `[${directions}]\n\n${text}`;
    }

    // User content
    contents.push({
      role: 'user',
      parts: [{ text: finalText }]
    });

    const requestBody = {
      contents: contents,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName
            }
          }
        }
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${state.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errMsg = errorData?.error?.message || `API Error: ${response.status} ${response.statusText}`;
      throw new Error(errMsg);
    }

    const data = await response.json();

    // Extract audio data
    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new Error('No response candidate returned from the API');
    }

    const audioPart = candidate.content?.parts?.find(p => p.inlineData);
    if (!audioPart) {
      throw new Error('No audio data in the response. The model may not support audio output with the current configuration.');
    }

    const audioBase64 = audioPart.inlineData.data;
    const mimeType = audioPart.inlineData.mimeType || 'audio/L16;rate=24000';

    // Decode audio
    const rawBytes = base64ToArrayBuffer(audioBase64);

    // Determine if we need to add WAV headers
    let audioBlob;
    if (mimeType.includes('wav')) {
      audioBlob = new Blob([rawBytes], { type: 'audio/wav' });
    } else {
      // Raw PCM — add WAV header
      const sampleRate = extractSampleRate(mimeType);
      const wavBuffer = pcmToWav(rawBytes, sampleRate, 1, 16);
      audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
    }

    state.currentAudioBlob = audioBlob;

    // Show player
    const audioUrl = URL.createObjectURL(audioBlob);
    audioPlayer.src = audioUrl;
    showPlayer();

    // Auto play
    try {
      await audioPlayer.play();
    } catch (e) {
      // Autoplay might be blocked, that's ok
    }

    // Add to history
    addToHistory(text, voiceName, model);

    showToast('Speech generated successfully!', 'success');

  } catch (err) {
    console.error('TTS Error:', err);
    showError(err.message);
    showToast('Generation failed', 'error');
  } finally {
    setGenerating(false);
  }
}

// ── Audio Utilities ────────────────────────────────────
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function extractSampleRate(mimeType) {
  const match = mimeType.match(/rate=(\d+)/);
  return match ? parseInt(match[1]) : 24000;
}

function pcmToWav(pcmBuffer, sampleRate, numChannels, bitsPerSample) {
  const pcmData = new Uint8Array(pcmBuffer);
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);           // Sub-chunk size
  view.setUint16(20, 1, true);            // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM data
  const outputBytes = new Uint8Array(buffer, headerSize);
  outputBytes.set(pcmData);

  return buffer;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// ── UI Helpers ─────────────────────────────────────────
function setGenerating(isGenerating) {
  state.isGenerating = isGenerating;
  generateBtn.disabled = isGenerating;
  btnContent.style.display = isGenerating ? 'none' : 'flex';
  btnLoading.style.display = isGenerating ? 'flex' : 'none';
}

function showPlayer() {
  outputEmpty.style.display = 'none';
  outputError.style.display = 'none';
  audioPlayerWrapper.style.display = 'flex';
}

function hidePlayer() {
  audioPlayerWrapper.style.display = 'none';
}

function showError(msg) {
  outputEmpty.style.display = 'none';
  audioPlayerWrapper.style.display = 'none';
  outputError.style.display = 'flex';
  errorMessage.textContent = msg;
}

function hideError() {
  outputError.style.display = 'none';
}

function downloadAudio() {
  if (!state.currentAudioBlob) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const voice = voiceSelect.value;
  const filename = `gemini-tts-${voice}-${timestamp}.wav`;

  const url = URL.createObjectURL(state.currentAudioBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Audio downloaded!', 'success');
}

// ── History ────────────────────────────────────────────
function addToHistory(text, voice, model) {
  const entry = {
    text: text.substring(0, 100),
    voice,
    model,
    timestamp: Date.now(),
  };

  state.history.unshift(entry);
  if (state.history.length > 20) state.history.pop();
  saveState();
  renderHistory();
}

function renderHistory() {
  if (state.history.length === 0) {
    historySection.style.display = 'none';
    return;
  }

  historySection.style.display = 'block';
  historyList.innerHTML = state.history.map((item, i) => `
    <div class="history-item" data-index="${i}" onclick="loadHistoryItem(${i})">
      <div class="history-play">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </div>
      <div class="history-info">
        <div class="history-text">${escapeHtml(item.text)}</div>
        <div class="history-meta">${item.voice} · ${formatTime(item.timestamp)}</div>
      </div>
    </div>
  `).join('');
}

function loadHistoryItem(index) {
  const item = state.history[index];
  if (!item) return;

  textInput.value = item.text;
  voiceSelect.value = item.voice;
  if (item.model) modelSelect.value = item.model;
  updateCharCount();
  textInput.focus();

  showToast('Text loaded from history', 'success');
}

// Make it globally accessible for onclick
window.loadHistoryItem = loadHistoryItem;

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Toast Notifications ────────────────────────────────
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${type === 'success' ? '#34d399' : type === 'error' ? '#f87171' : '#818cf8'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${type === 'success'
        ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
        : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
      }
    </svg>
    <span>${escapeHtml(message)}</span>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}
