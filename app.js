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

  const loadingTextElement = btnLoading.querySelector('span');
  const originalLoadingText = loadingTextElement ? loadingTextElement.textContent : 'Generating...';

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

    // Split text into chunks (increased to ~1000 characters to reduce API requests and avoid rate limits)
    let chunks = splitTextIntoChunks(text, 1000);
    if (chunks.length === 0) {
      chunks = [text];
    }
    
    const chunkBuffers = [];
    let sampleRate = 24000;
    let mimeType = 'audio/L16;rate=24000';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${state.apiKey}`;

    // Loop through chunks sequentially
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      
      // Update dynamic loading text
      if (loadingTextElement) {
        loadingTextElement.textContent = `Generating chunk ${i + 1} of ${chunks.length}...`;
      }

      // Prepend style directions into the text prompt for each chunk
      let finalText = chunkText;
      if (systemParts.length > 0) {
        const directions = systemParts.join('. ');
        finalText = `[${directions}]\n\n${chunkText}`;
      }

      const contents = [{
        role: 'user',
        parts: [{ text: finalText }]
      }];

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

      let response;
      const retries = 3;
      let delay = 4000; // 4 seconds initial delay for rate limits

      for (let attempt = 0; attempt < retries; attempt++) {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (response.ok) {
          break;
        }

        const errorData = await response.json().catch(() => null);
        const errMsg = errorData?.error?.message || `API Error: ${response.status} ${response.statusText}`;

        // If it's a rate limit or quota error, wait and retry
        if (response.status === 429 || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate limit')) {
          if (attempt < retries - 1) {
            console.warn(`Rate limit / Quota exceeded. Retrying chunk ${i + 1} (Attempt ${attempt + 1}/${retries}) in ${delay/1000}s...`);
            if (loadingTextElement) {
              loadingTextElement.textContent = `Rate limit hit. Retrying in ${delay/1000}s...`;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay += 4000; // Linear backoff (4s, then 8s)
            continue;
          }
        }

        throw new Error(`Chunk ${i + 1} failed: ${errMsg}`);
      }

      const data = await response.json();

      // Extract audio data
      const candidate = data.candidates?.[0];
      if (!candidate) {
        throw new Error(`No response candidate returned from the API for chunk ${i + 1}`);
      }

      const audioPart = candidate.content?.parts?.find(p => p.inlineData);
      if (!audioPart) {
        throw new Error(`No audio data in the response for chunk ${i + 1}. The model may not support audio output.`);
      }

      const audioBase64 = audioPart.inlineData.data;
      const currentMimeType = audioPart.inlineData.mimeType || 'audio/L16;rate=24000';
      if (i === 0) {
        mimeType = currentMimeType;
        sampleRate = extractSampleRate(mimeType);
      }

      // Decode audio chunk
      const rawBytes = base64ToArrayBuffer(audioBase64);

      // Strip WAV header (44 bytes) if it exists, otherwise keep whole raw PCM bytes
      if (currentMimeType.includes('wav')) {
        chunkBuffers.push(rawBytes.slice(44));
      } else {
        chunkBuffers.push(rawBytes);
      }
    }

    // Dynamic loading text final status
    if (loadingTextElement) {
      loadingTextElement.textContent = 'Assembling final audio...';
    }

    // Concatenate all PCM chunks
    const concatenatedPCM = concatenateBuffers(chunkBuffers);

    // Rebuild WAV header from raw PCM
    const wavBuffer = pcmToWav(concatenatedPCM, sampleRate, 1, 16);
    const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });

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
    // Restore original loading text
    if (loadingTextElement) {
      loadingTextElement.textContent = originalLoadingText;
    }
  }
}

// ── TTS Chunking & Concatenation Helpers ────────────────
function splitTextIntoChunks(text, maxChars = 400) {
  if (text.length <= maxChars) {
    return [text];
  }
  
  // Split using sentence-ending punctuation (including newlines) as delimiters, keeping the delimiters
  const parts = text.split(/([။\.\?\!\n]+)/);
  const sentences = [];
  
  for (let i = 0; i < parts.length; i += 2) {
    const textPart = parts[i] || "";
    const delim = parts[i + 1] || "";
    const sentence = textPart + delim;
    if (sentence.trim().length > 0) {
      sentences.push(sentence);
    }
  }

  const chunks = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChars) {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk);
      }
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk);
  }

  // Fallback: If any chunk is still larger than maxChars * 1.5 (e.g. no punctuation),
  // split it by spaces or word boundaries to stay safe.
  const finalChunks = [];
  for (const chunk of chunks) {
    if (chunk.length > maxChars * 1.5) {
      const words = chunk.split(/(\s+)/);
      let subChunk = "";
      for (const word of words) {
        if ((subChunk + word).length > maxChars) {
          if (subChunk.trim().length > 0) {
            finalChunks.push(subChunk);
          }
          subChunk = word;
        } else {
          subChunk += word;
        }
      }
      if (subChunk.trim().length > 0) {
        finalChunks.push(subChunk);
      }
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks.filter(c => c.trim().length > 0);
}

function concatenateBuffers(buffers) {
  let totalLength = 0;
  for (const buf of buffers) {
    totalLength += buf.byteLength;
  }
  
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  
  return result.buffer;
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

// ══════════════════════════════════════════════════════
// VO TRANSLATE TAB
// ══════════════════════════════════════════════════════

// ── Tab Switching ──────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const tabId = 'tab-' + btn.dataset.tab;
    document.getElementById(tabId).classList.add('active');
  });
});

// ── Translate DOM Elements ─────────────────────────────
const translateInput = $('#translate-input');
const translateFileInput = $('#translate-file-input');
const translateUploadZone = $('#translate-upload-zone');
const translateFileInfo = $('#translate-file-info');
const translateFileName = $('#translate-file-name');
const translateFileRemove = $('#translate-file-remove');
const translateCharCount = $('#translate-char-count');
const translateClear = $('#translate-clear');
const translateModelSelect = $('#translate-model-select');
const translateBtn = $('#translate-btn');
const translateBtnContent = $('#translate-btn-content');
const translateBtnLoading = $('#translate-btn-loading');
const translateOutputEmpty = $('#translate-output-empty');
const translateOutput = $('#translate-output');
const translateResultWrapper = $('#translate-result-wrapper');
const translateCopyBtn = $('#translate-copy-btn');
const translateDownloadBtn = $('#translate-download-btn');
const translateError = $('#translate-error');
const translateErrorMessage = $('#translate-error-message');

let translateResultText = '';

// ── File Upload ────────────────────────────────────────
translateUploadZone.addEventListener('click', () => translateFileInput.click());

translateUploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  translateUploadZone.classList.add('drag-over');
});

translateUploadZone.addEventListener('dragleave', () => {
  translateUploadZone.classList.remove('drag-over');
});

translateUploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  translateUploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleTranslateFile(file);
});

translateFileInput.addEventListener('change', () => {
  const file = translateFileInput.files[0];
  if (file) handleTranslateFile(file);
});

function handleTranslateFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    translateInput.value = e.target.result;
    updateTranslateCharCount();
    translateFileName.textContent = file.name;
    translateFileInfo.style.display = 'flex';
    translateUploadZone.style.display = 'none';
    showToast(`Loaded: ${file.name}`, 'success');
  };
  reader.readAsText(file);
}

translateFileRemove.addEventListener('click', () => {
  translateFileInput.value = '';
  translateFileInfo.style.display = 'none';
  translateUploadZone.style.display = 'block';
  translateInput.value = '';
  updateTranslateCharCount();
});

translateInput.addEventListener('input', updateTranslateCharCount);
translateClear.addEventListener('click', () => {
  translateInput.value = '';
  updateTranslateCharCount();
  translateInput.focus();
});

function updateTranslateCharCount() {
  const len = translateInput.value.length;
  translateCharCount.textContent = `${len.toLocaleString()} character${len !== 1 ? 's' : ''}`;
}

// ── VO Translation Prompt ──────────────────────────────
const VO_TRANSLATE_PROMPT = `သင်သည် ကျွမ်းကျင်သော Voice-over Script ဘာသာပြန်ဆရာ တစ်ဦးဖြစ်သည်။ ပေးထားသော စာသားကို မြန်မာဘာသာ Voice-over Script အဖြစ် ပြောင်းလဲပေးပါ။

အရေးကြီးသော စည်းမျဉ်းများ -
- မူရင်းစာသားကို တိုက်ရိုက်ဘာသာပြန်ခြင်းမျိုး လုံးဝမလုပ်ပါနှင့်။ မြန်မာလူမျိုးတစ်ယောက် သူ့ဘာသာစကားနဲ့ သဘာဝကျကျ ပြောပြသလိုမျိုး ပြန်ရေးပေးပါ။
- VO Script စာသားကို စာကြောင်းမခြားဘဲ တဆက်တည်း စီးဆင်းစွာ ရေးပေးပါ။ စာပိုဒ်ခွဲခြင်း၊ နံပါတ်တပ်ခြင်း၊ ခေါင်းစဉ်ထည့်ခြင်း မလုပ်ပါနှင့်။
- အသံသွင်းမည့်သူ လိုက်ဆိုရလွယ်ကူစေရန် သင့်တော်သောနေရာများတွင် [slowly], [seriously], [warmly], [sadly], [excitedly], [laughs], [music], [pause], [whisper], [loud] စသည့် Audio Tags များကို ထည့်သွင်းပေးရန်။
- "ခွေး" ဟူသော စကားလုံးကို "ဝုလေး" ဟု အစားထိုးသုံးစွဲရန်။
- VO script အဆုံးတွင် စာကြောင်းတစ်ကြောင်းခြားပြီး VO အကြောင်းအရာ၏ အဓိပ္ပါယ်နှင့် သက်ဆိုင်သော English Disclaimer တစ်ခု ထည့်ပေးပါ။
- Output format: VO script စာသား + audio tags (တဆက်တည်း) ပြီးမှ English Disclaimer။ အခြားအပိုစာသား မပါစေရ။`;


// ── Translate Function ─────────────────────────────────
translateBtn.addEventListener('click', translateVO);

async function translateVO() {
  if (!state.apiKey) {
    showToast('Please enter your API key first', 'error');
    apiKeyInput.focus();
    document.getElementById('tab-btn-tts').click(); // switch to see API field
    return;
  }

  const sourceText = translateInput.value.trim();
  if (!sourceText) {
    showToast('Please enter or upload source text', 'error');
    translateInput.focus();
    return;
  }

  // UI: loading state
  translateBtn.disabled = true;
  translateBtnContent.style.display = 'none';
  translateBtnLoading.style.display = 'flex';
  translateError.style.display = 'none';
  translateOutputEmpty.style.display = 'none';
  translateResultWrapper.style.display = 'none';

  try {
    const model = translateModelSelect.value;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${state.apiKey}`;

    const requestBody = {
      system_instruction: {
        parts: [{ text: VO_TRANSLATE_PROMPT }]
      },
      contents: [{
        role: 'user',
        parts: [{ text: sourceText }]
      }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 8192
      }
    };

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
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error('No response candidate returned');

    const textPart = candidate.content?.parts?.find(p => p.text);
    if (!textPart) throw new Error('No text in response');

    translateResultText = textPart.text;
    translateOutput.textContent = translateResultText;
    translateResultWrapper.style.display = 'block';

    showToast('Translation completed!', 'success');

  } catch (err) {
    console.error('Translate Error:', err);
    translateError.style.display = 'flex';
    translateErrorMessage.textContent = err.message;
    showToast('Translation failed', 'error');
  } finally {
    translateBtn.disabled = false;
    translateBtnContent.style.display = 'flex';
    translateBtnLoading.style.display = 'none';
  }
}

// ── Copy & Download ────────────────────────────────────
translateCopyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(translateResultText).then(() => {
    showToast('Copied to clipboard!', 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = translateResultText;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Copied to clipboard!', 'success');
  });
});

translateDownloadBtn.addEventListener('click', () => {
  if (!translateResultText) return;
  const blob = new Blob([translateResultText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = `vo-script-${ts}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Script downloaded!', 'success');
});
