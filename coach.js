const LIMIT = 2000;
const WORD_LIMIT = 12;

export function coachWords(text) {
    return [...new Set((String(text).match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).map(word => word.toLowerCase()))].slice(0, WORD_LIMIT);
}

export function sentenceDraft(text) {
    const cleaned = String(text).trim().replace(/\s+/g, ' ').slice(0, LIMIT);
    if (!cleaned) return '';
    const draft = cleaned.split(/\s+/).length <= 3 ? `I am learning about ${cleaned.replace(/[.!?]+$/, '')}` : cleaned;
    return draft.charAt(0).toUpperCase() + draft.slice(1).replace(/\bi\b/g, 'I') + (/[.!?।]$/.test(draft) ? '' : '.');
}

export async function coachJson(url, signal, fetcher = fetch) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 10000);
    try {
        const response = await fetcher(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error('The word service is unavailable. Try again.');
        return await response.json();
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
    }
}

export async function dictionaryAgent(word, signal, fetcher) {
    if (!word || !/^[a-z]+(?:['’-][a-z]+)*$/i.test(word)) throw new Error('Select an English word for the dictionary.');
    const entries = await coachJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, signal, fetcher);
    if (!Array.isArray(entries) || !entries.length) return { title: word, lines: ['No dictionary entry found. Try another word or the Spelling agent.'] };
    const lines = [];
    for (const entry of entries.slice(0, 2)) {
        if (entry.phonetic) lines.push(`Pronunciation: ${entry.phonetic}`);
        for (const meaning of (entry.meanings || []).slice(0, 3)) {
            const definition = meaning.definitions?.[0];
            if (definition?.definition) lines.push(`${meaning.partOfSpeech || 'Meaning'}: ${definition.definition}`);
            if (definition?.example) lines.push(`Example: ${definition.example}`);
        }
    }
    return { title: word, lines: lines.length ? lines : ['No definitions available for this entry.'] };
}

export async function spellingAgent(text, signal, fetcher) {
    const words = coachWords(text);
    if (!words.length) throw new Error('Enter English words to check spelling.');
    const lines = [];
    for (let start = 0; start < words.length; start += 3) {
        const batch = await Promise.all(words.slice(start, start + 3).map(async word => {
            const entries = await coachJson(`https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&max=5`, signal, fetcher);
            if (!Array.isArray(entries)) throw new Error('Spelling suggestions are unavailable. Try again.');
            if (entries.some(entry => String(entry.word).toLowerCase() === word)) return `${word}: found in the word list.`;
            const suggestions = entries.map(entry => entry.word).filter(value => typeof value === 'string').slice(0, 4);
            return suggestions.length ? `${word}: possible alternatives — ${suggestions.join(', ')}.` : `${word}: not found. Check names and specialist words yourself.`;
        }));
        lines.push(...batch);
    }
    return { title: 'Spelling suggestions', lines: [...lines, 'Checks up to 12 unique English words. Suggestions are not automatic corrections.'] };
}

export function initializePracticeCoach({ isPracticeMode, generateSentence = async () => null }) {
    const root = document.getElementById('practiceCoach');
    const selectionButton = document.getElementById('coachSelectionAction');
    const launcher = document.getElementById('coachLauncher');
    const panel = document.getElementById('coachPanel');
    const input = document.getElementById('coachText');
    const wordSelect = document.getElementById('coachWord');
    const status = document.getElementById('coachStatus');
    const transcript = document.getElementById('coachTranscript');
    const speechStatus = document.getElementById('coachSpeechStatus');
    const startSpeech = document.getElementById('coachStartSpeech');
    const stopSpeech = document.getElementById('coachStopSpeech');
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let selectedText = '';
    let selectionTimer;
    let recognition = null;
    let available = false;
    let expanded = false;
    let speechGeneration = 0;
    let coachUtterance = null;
    const tasks = new Map();

    const cancelTasks = () => { tasks.forEach(controller => controller.abort()); tasks.clear(); };
    const clearResults = () => {
        cancelTasks();
        root.querySelectorAll('[data-coach-result]').forEach(card => { card.hidden = true; card.replaceChildren(); });
    };
    const stopListening = () => {
        speechGeneration += 1;
        const active = recognition;
        recognition = null;
        if (active) { try { active.abort(); } catch { /* Already stopped. */ } }
        startSpeech.disabled = !Recognition || !window.isSecureContext;
        stopSpeech.disabled = true;
        if (active) speechStatus.textContent = 'Microphone stopped.';
    };
    function setExpanded(value, focus = false) {
        expanded = value && available;
        panel.hidden = !expanded;
        launcher.setAttribute('aria-expanded', String(expanded));
        launcher.textContent = expanded ? 'Collapse Coach' : 'Practice Coach';
        if (!expanded) {
            stopListening(); clearResults();
            if (coachUtterance) window.speechSynthesis?.cancel();
            coachUtterance = null;
        }
        if (focus) (expanded ? input : launcher).focus();
    }
    function updateWords() {
        const previous = wordSelect.value;
        wordSelect.replaceChildren();
        const words = coachWords(input.value);
        for (const word of words) {
            const option = document.createElement('option');
            option.value = word;
            option.textContent = word;
            wordSelect.append(option);
        }
        if (words.includes(previous)) wordSelect.value = previous;
        wordSelect.disabled = !words.length;
    }
    function useText(text) {
        input.value = String(text).slice(0, LIMIT);
        clearResults();
        updateWords();
        status.textContent = 'Choose an agent, or run all three text agents.';
    }
    function syncAvailability() {
        const next = !!isPracticeMode();
        if (next === available) return;
        available = next;
        root.hidden = !available;
        selectionButton.hidden = true;
        if (available) speechStatus.textContent = !Recognition ? 'Speech recognition is unavailable here. You can type a transcript below.'
            : !window.isSecureContext ? 'Speech recognition needs HTTPS or localhost.' : 'Start the microphone to dictate. Your browser may use an online speech service.';
        if (!available) {
            setExpanded(false);
            clearResults();
            selectedText = '';
            input.value = '';
            transcript.value = '';
            status.textContent = '';
            speechStatus.textContent = '';
            updateWords();
        }
    }
    function captureSelection() {
        if (!available || !isPracticeMode()) { selectionButton.hidden = true; return; }
        const selection = window.getSelection();
        const active = document.activeElement;
        let text = '';
        let bounds;
        if (active && document.getElementById('quizView').contains(active)
            && ['TEXTAREA', 'INPUT'].includes(active.tagName) && typeof active.selectionStart === 'number') {
            text = active.value.slice(active.selectionStart, active.selectionEnd);
            bounds = active.getBoundingClientRect();
        } else if (selection?.rangeCount && !selection.isCollapsed) {
            const range = selection.getRangeAt(0);
            const node = range.commonAncestorContainer;
            if (!document.getElementById('quizView').contains(node) || root.contains(node)) { selectionButton.hidden = true; return; }
            text = selection.toString();
            bounds = range.getBoundingClientRect();
        }
        if (!text.trim()) { selectionButton.hidden = true; return; }
        selectedText = text.trim().slice(0, LIMIT);
        selectionButton.hidden = false;
        const viewport = window.visualViewport;
        const width = viewport?.width || window.innerWidth;
        const height = viewport?.height || window.innerHeight;
        selectionButton.style.left = `${Math.max(8, Math.min(bounds.left, width - 160))}px`;
        selectionButton.style.top = `${Math.max(8, Math.min(bounds.bottom + 8, height - 54))}px`;
    }
    const scheduleSelection = () => {
        clearTimeout(selectionTimer);
        selectionTimer = setTimeout(captureSelection, 100);
    };
    document.addEventListener('selectionchange', scheduleSelection);
    document.addEventListener('pointerup', scheduleSelection);
    document.addEventListener('keyup', event => { if (event.key !== 'Escape') scheduleSelection(); });
    selectionButton.addEventListener('pointerdown', event => event.preventDefault());
    selectionButton.addEventListener('click', () => {
        if (!available || !isPracticeMode()) return;
        useText(selectedText);
        selectionButton.hidden = true;
        setExpanded(true, true);
    });
    launcher.addEventListener('click', () => setExpanded(!expanded, true));
    document.getElementById('coachCollapse').addEventListener('click', () => setExpanded(false, true));
    input.addEventListener('input', () => { clearResults(); updateWords(); status.textContent = ''; });
    wordSelect.addEventListener('change', () => {
        tasks.get('dictionary')?.abort();
        tasks.delete('dictionary');
        document.querySelector('[data-coach-result="dictionary"]').hidden = true;
    });
    function showResult(agent, title, lines, busy = false) {
        const card = root.querySelector(`[data-coach-result="${agent}"]`);
        card.replaceChildren();
        card.hidden = false;
        card.setAttribute('aria-busy', String(busy));
        const heading = document.createElement('h3');
        heading.textContent = title;
        card.append(heading);
        for (const text of lines) {
            const p = document.createElement('p');
            p.textContent = text;
            card.append(p);
        }
    }
    async function runAgent(agent) {
        if (!available || !expanded || !isPracticeMode()) return;
        const text = input.value.trim().slice(0, LIMIT);
        if (!text) { status.textContent = 'Select or enter some text first.'; input.focus(); return; }
        tasks.get(agent)?.abort();
        const controller = new AbortController();
        tasks.set(agent, controller);
        const current = () => tasks.get(agent) === controller && !controller.signal.aborted && available && expanded && isPracticeMode();
        const names = { dictionary: 'Dictionary', spelling: 'Spelling', sentence: 'Sentence Formation' };
        showResult(agent, names[agent], ['Working...'], true);
        status.textContent = '';
        try {
            let result;
            if (agent === 'dictionary') result = await dictionaryAgent(wordSelect.value, controller.signal);
            else if (agent === 'spelling') result = await spellingAgent(text, controller.signal);
            else {
                let generated = null;
                try { generated = await generateSentence(text); } catch { /* Use local writing guidance. */ }
                result = generated
                    ? { title: 'Sentence Formation · browser AI', lines: [String(generated).slice(0, LIMIT), 'Review this suggestion: a small language model may change the intended meaning.'] }
                    : { title: 'Sentence Formation · local guidance', lines: [sentenceDraft(text), 'This is a sentence starter or punctuation draft. Check: who or what + an action + a complete thought. Add detail with because, when, or where. The AI writing model is not ready; this draft uses local rules.'] };
            }
            if (current()) showResult(agent, result.title, result.lines);
        } catch (error) {
            if (current()) showResult(agent, names[agent], [error.name === 'AbortError' ? 'The lookup timed out. Try again.' : error.message || 'This agent is unavailable. Try again.']);
        } finally {
            if (tasks.get(agent) === controller) tasks.delete(agent);
        }
    }
    root.querySelectorAll('[data-coach-agent]').forEach(button => button.addEventListener('click', () => runAgent(button.dataset.coachAgent)));
    document.getElementById('coachRunAll').addEventListener('click', () => Promise.allSettled(['dictionary', 'spelling', 'sentence'].map(runAgent)));
    document.getElementById('coachReadText').addEventListener('click', () => {
        if (!available || !expanded || !isPracticeMode() || !input.value.trim()) return;
        if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { status.textContent = 'Read aloud is unavailable in this browser.'; return; }
        stopListening();
        window.speechSynthesis.cancel();
        const utterance = new window.SpeechSynthesisUtterance(input.value.slice(0, LIMIT));
        utterance.lang = document.getElementById('coachSpeechLanguage').value;
        coachUtterance = utterance;
        utterance.onend = utterance.onerror = () => { if (coachUtterance === utterance) coachUtterance = null; };
        window.speechSynthesis.speak(utterance);
    });
    startSpeech.disabled = !Recognition || !window.isSecureContext;
    speechStatus.textContent = !Recognition ? 'Speech recognition is unavailable here. You can type a transcript below.'
        : !window.isSecureContext ? 'Speech recognition needs HTTPS or localhost.' : 'Start the microphone to dictate. Your browser may use an online speech service.';
    startSpeech.addEventListener('click', () => {
        if (!available || !expanded || !isPracticeMode() || !Recognition || recognition) return;
        const instance = new Recognition();
        const generation = ++speechGeneration;
        recognition = instance;
        instance.lang = document.getElementById('coachSpeechLanguage').value;
        instance.continuous = true;
        instance.interimResults = true;
        let finalText = transcript.value.trim();
        instance.onresult = event => {
            if (recognition !== instance || generation !== speechGeneration || !isPracticeMode()) return;
            let interim = '';
            for (let index = event.resultIndex; index < event.results.length; index++) {
                const text = event.results[index][0].transcript;
                if (event.results[index].isFinal) finalText = `${finalText} ${text}`.trim().slice(0, LIMIT);
                else interim += text;
            }
            transcript.value = `${finalText} ${interim}`.trim().slice(0, LIMIT);
        };
        instance.onerror = event => {
            if (generation !== speechGeneration) return;
            speechStatus.textContent = event.error === 'not-allowed' || event.error === 'service-not-allowed'
                ? 'Microphone access was denied. Allow it in your browser or type below.'
                : `Speech recognition stopped (${event.error || 'unknown error'}). Try again or type below.`;
        };
        instance.onend = () => {
            if (generation !== speechGeneration) return;
            recognition = null;
            startSpeech.disabled = false;
            stopSpeech.disabled = true;
            if (speechStatus.textContent === 'Listening...') speechStatus.textContent = 'Microphone stopped. Review your transcript.';
        };
        try {
            instance.start();
            startSpeech.disabled = true;
            stopSpeech.disabled = false;
            speechStatus.textContent = 'Listening...';
        } catch {
            stopListening();
            speechStatus.textContent = 'Unable to start the microphone. Try again or type below.';
        }
    });
    stopSpeech.addEventListener('click', stopListening);
    document.getElementById('coachUseTranscript').addEventListener('click', () => { stopListening(); useText(transcript.value); input.focus(); });
    document.getElementById('coachSpeechLanguage').addEventListener('change', stopListening);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && expanded) { selectionButton.hidden = true; setExpanded(false, true); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopListening(); });
    window.addEventListener('pagehide', () => { stopListening(); cancelTasks(); });
    window.addEventListener('scroll', () => { selectionButton.hidden = true; }, { passive: true });
    const observer = new MutationObserver(syncAvailability);
    observer.observe(document.getElementById('quizView'), { attributes: true, attributeFilter: ['hidden'] });
    syncAvailability();
    return { syncAvailability, setExpanded };
}
