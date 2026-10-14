import { maybePromptGuidedTour } from './tours.js';
import { initializeHeader, setHeaderStudent } from './header.js';
import { auth, db, loginUrl } from './firebase.js';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const COLLECTIONS = {
    classrooms: 'classrooms',
    classSections: 'classSections',
    questionLists: 'qb_lists_v1',
    questions: 'qb_questions_v1',
    taxonomy: 'qb_taxonomy_v1',
    submissions: 'qb_quiz_submissions_v1'
};

const TYPE_LABELS = {
    mcq: 'MCQ',
    true_false: 'True/False',
    fib: 'Fill in the Blank',
    short_answer: 'Short Answer'
};

let studentProfile = null;
let recentSessions = [];
let openingSession = false;
let authGeneration = 0;

let session = null;
let loadedQuestions = [];
let quiz = null;
let currentIndex = 0;
let toastTimer = null;
let timerInterval = null;
let hasSubmittedCurrentSession = false;
let taxonomyItems = [];
let taxonomyById = new Map();
let speechVoices = [];
const offlineAi = {
    status: 'idle',
    embedPipe: null,
    grammarPipe: null,
    loadPromise: null,
    models: {
        embed: { label: 'Similarity model', status: 'waiting', progress: 0, loaded: 0, total: 0, file: '', error: '' },
        grammar: { label: 'Writing model', status: 'waiting', progress: 0, loaded: 0, total: 0, file: '', error: '' }
    }
};

const SESSION_STORAGE_KEY = 'quizActivityVerifiedSession';
const SPEECH_VOICE_KEY = 'quizActivitySpeechVoice';
const SPEECH_RATE_KEY = 'quizActivitySpeechRate';
const APP_VERSION = '2026.10.14.6';
const SHORT_ANSWER_STOP_WORDS = new Set('a an the and or but if then so of to in on at by for with from as is are was were be been being am do does did have has had this that these those it its i you he she they we me my your his her their our not no nor can could will would shall should may might must there here what which who whom when where why how all any both each few more most other some such only own same than too very just also because after before while about into over under again once therefore then'.split(/\s+/));
initializeHeader({ page: 'dashboard', statusId: 'statusText', statusText: 'Loading your student dashboard...', tourPage: () => {
    if (!document.getElementById('quizView').hidden) return 'quiz';
    if (!document.getElementById('resultView').hidden) return 'result';
    if (!document.getElementById('setupView').hidden) return 'setup';
    return 'dashboard';
} });

const $ = (id) => document.getElementById(id);
const els = {
    statusText: $('statusText'),
    offlineAiStatus: $('offlineAiStatus'),
    offlineAiDetails: $('offlineAiDetails'),
    resetBtn: $('resetBtn'),
    viewSubmissionsBtn: $('viewSubmissionsBtn'),
    dashboardView: $('dashboardView'),
    setupView: $('setupView'),
    quizView: $('quizView'),
    resultView: $('resultView'),
    welcomeTitle: $('welcomeTitle'),
    classroomLabel: $('classroomLabel'),
    quizFilterControls: $('quizFilterControls'),
    quizFiltersGroup: $('quizFiltersGroup'),
    quizSettingsGroup: $('quizSettingsGroup'),
    instantFeedbackSetting: $('instantFeedbackSetting'),
    speakerButtonSetting: $('speakerButtonSetting'),
    listenRespondSetting: $('listenRespondSetting'),
    fibChoiceBankSetting: $('fibChoiceBankSetting'),
    shortAnswerWordBankSetting: $('shortAnswerWordBankSetting'),
    translatedShortAnswerSetting: $('translatedShortAnswerSetting'),
    voiceSetting: $('voiceSetting'),
    voiceSpeedSetting: $('voiceSpeedSetting'),
    subjectFilterField: $('subjectFilterField'),
    chapterFilterField: $('chapterFilterField'),
    questionLoadSummary: $('questionLoadSummary'),
    startQuizBtn: $('startQuizBtn'),
    quizPanel: $('quizPanel'),
    explanationFramePanel: $('explanationFramePanel'),
    explanationFrame: $('explanationFrame'),
    explanationOpenLink: $('explanationOpenLink'),
    progressSummary: $('progressSummary'),
    selectionMemoryPanel: $('selectionMemoryPanel'),
    selectionMemoryDetails: $('selectionMemoryDetails'),
    questionMeta: $('questionMeta'),
    questionTitle: $('questionTitle'),
    questionTypeLabel: $('questionTypeLabel'),
    questionAudioControls: $('questionAudioControls'),
    questionPrompt: $('questionPrompt'),
    answerArea: $('answerArea'),
    instantFeedbackPanel: $('instantFeedbackPanel'),
    resultSummary: $('resultSummary'),
    reviewList: $('reviewList'),
    timerLabel: $('timerLabel'),
    toast: $('toast')
};

if (window.mermaid) {
    window.mermaid.initialize({ startOnLoad: false, theme: 'default' });
}

bindEvents();
initializeSpeechControls();
preloadOfflineAiModels();
onAuthStateChanged(auth, handleStudentAuth);
function bindEvents() {
    $('refreshSessionsBtn').addEventListener('click', loadStudentSessions);
    $('sessionList').addEventListener('click', event => {
        const button = event.target.closest('[data-session-id]');
        if (button) openQuizSession(button.dataset.sessionId);
    });
    $('loadQuestionsBtn').addEventListener('click', loadPublishedQuestions);
    $('startQuizBtn').addEventListener('click', startQuiz);
    $('nextQuestionBtn').addEventListener('click', advanceQuestion);
    els.offlineAiStatus.addEventListener('click', toggleOfflineAiDetails);
    els.resetBtn.addEventListener('click', resetApp);
    document.addEventListener('click', event => {
        if (event.target.closest('[data-offline-ai-retry]')) {
            retryOfflineAiModels();
            return;
        }
        if (event.target.closest('[data-speak-question]')) {
            speakCurrentQuestion();
            return;
        }
        if (event.target.closest('[data-reveal-question]')) {
            revealCurrentQuestionText();
            return;
        }
        const fibChoice = event.target.closest('[data-fib-choice]');
        if (fibChoice) {
            toggleFibChoice(fibChoice.dataset.fibChoice);
            return;
        }
        const fibClear = event.target.closest('[data-fib-clear]');
        if (fibClear) {
            clearFibChoice(Number(fibClear.dataset.fibClear));
            return;
        }
        const shortChoice = event.target.closest('[data-short-choice-index]');
        if (shortChoice) {
            toggleShortAnswerChoice(Number(shortChoice.dataset.shortChoiceIndex));
            return;
        }
        const shortSelected = event.target.closest('[data-short-selected-index]');
        if (shortSelected) {
            removeShortAnswerChoice(Number(shortSelected.dataset.shortSelectedIndex));
            return;
        }
        const shortInsert = event.target.closest('[data-short-insert-index]');
        if (shortInsert) {
            setShortAnswerInsertIndex(Number(shortInsert.dataset.shortInsertIndex));
            return;
        }
        const shortMode = event.target.closest('[data-short-answer-mode]');
        if (shortMode) {
            setShortAnswerMode(shortMode.dataset.shortAnswerMode);
            return;
        }
        if (els.offlineAiDetails.hidden) return;
        if (els.offlineAiStatus.contains(event.target) || els.offlineAiDetails.contains(event.target)) return;
        setOfflineAiDetailsOpen(false);
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') setOfflineAiDetailsOpen(false);
    });
    $('classFilter').addEventListener('change', handleClassFilterChange);
    $('subjectFilter').addEventListener('change', handleSubjectFilterChange);
    $('chapterFilter').addEventListener('change', resetLoadedQuestionSelection);
    document.addEventListener('change', event => {
        if (event.target.id === 'translationSelect') {
            setQuestionTranslation(event.target.value);
        }
    });
    ['difficultyFilter', 'questionCountInput', 'explanationOnlyFilter', 'translationOnlyFilter', 'verifiedOnlyFilter'].forEach(id => {
        $(id).addEventListener('input', resetLoadedQuestionSelection);
        $(id).addEventListener('change', resetLoadedQuestionSelection);
    });
    $('voiceSelect').addEventListener('change', event => saveSpeechPreferences(event.target.value, currentSpeechRate()));
    $('voiceRateInput').addEventListener('input', event => handleVoiceRateChange(event.target.value));
    document.addEventListener('change', event => {
        if (event.target.id === 'liveVoiceSelect') saveSpeechPreferences(event.target.value, currentSpeechRate());
    });
    document.addEventListener('input', event => {
        if (event.target.id === 'liveVoiceRateInput') handleVoiceRateChange(event.target.value);
    });
    document.querySelectorAll('.question-type-filter').forEach(input => {
        input.addEventListener('change', resetLoadedQuestionSelection);
    });
}

function initializeSpeechControls() {
    const savedRate = Number(localStorage.getItem(SPEECH_RATE_KEY) || 1);
    $('voiceRateInput').value = Number.isFinite(savedRate) ? Math.min(Math.max(savedRate, 0.6), 1.4) : 1;
    updateVoiceRateLabels();
    populateVoiceSelect();
    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = populateVoiceSelect;
    }
}

function populateVoiceSelect() {
    const select = $('voiceSelect');
    const selectedVoice = localStorage.getItem(SPEECH_VOICE_KEY) || '';
    speechVoices = 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : [];
    select.innerHTML = voiceSelectOptions(selectedVoice);
    select.value = speechVoices.some(voice => speechVoiceId(voice) === selectedVoice) ? selectedVoice : '';
    const liveSelect = $('liveVoiceSelect');
    if (liveSelect) {
        liveSelect.innerHTML = voiceSelectOptions(selectedVoice);
        liveSelect.value = select.value;
    }
}

function voiceSelectOptions() {
    return [
        '<option value="">System default</option>',
        ...speechVoices.map(voice => {
            const id = speechVoiceId(voice);
            return `<option value="${esc(id)}">${esc(`${voice.name} (${voice.lang})`)}</option>`;
        })
    ].join('');
}

function handleVoiceRateChange(rate) {
    saveSpeechPreferences(currentSpeechVoice(), rate);
}

function updateVoiceRateLabels() {
    const label = `${currentSpeechRate().toFixed(1)}x`;
    $('voiceRateValue').textContent = label;
    const liveLabel = $('liveVoiceRateValue');
    if (liveLabel) liveLabel.textContent = label;
}

function currentSpeechVoice() {
    return $('voiceSelect')?.value || localStorage.getItem(SPEECH_VOICE_KEY) || '';
}

function currentSpeechRate() {
    const value = Number($('voiceRateInput')?.value || localStorage.getItem(SPEECH_RATE_KEY) || 1);
    return Number.isFinite(value) ? Math.min(Math.max(value, 0.6), 1.4) : 1;
}

function saveSpeechPreferences(voiceId = currentSpeechVoice(), rate = currentSpeechRate()) {
    const normalizedRate = Number.isFinite(Number(rate)) ? Math.min(Math.max(Number(rate), 0.6), 1.4) : 1;
    localStorage.setItem(SPEECH_VOICE_KEY, voiceId);
    localStorage.setItem(SPEECH_RATE_KEY, String(normalizedRate));
    $('voiceSelect').value = voiceId;
    $('voiceRateInput').value = normalizedRate;
    const liveSelect = $('liveVoiceSelect');
    if (liveSelect) liveSelect.value = voiceId;
    const liveRate = $('liveVoiceRateInput');
    if (liveRate) liveRate.value = normalizedRate;
    updateVoiceRateLabels();
}

function preloadOfflineAiModels() {
    if (offlineAi.loadPromise) return offlineAi.loadPromise;
    offlineAi.status = 'loading';
    Object.values(offlineAi.models).forEach(model => {
        model.status = 'waiting';
        model.progress = 0;
        model.loaded = 0;
        model.total = 0;
        model.file = '';
        model.error = '';
    });
    renderOfflineAiStatus();
    offlineAi.loadPromise = import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0/dist/transformers.min.js')
        .then(async ({ pipeline, env }) => {
            env.allowLocalModels = false;
            env.useBrowserCache = true;
            const [embedResult, grammarResult] = await Promise.allSettled([
                loadOfflineAiPipeline(pipeline, 'embed', 'feature-extraction', 'Xenova/all-MiniLM-L6-v2'),
                loadOfflineAiPipeline(pipeline, 'grammar', 'text2text-generation', 'Xenova/flan-t5-small')
            ]);
            if (embedResult.status === 'fulfilled') {
                offlineAi.embedPipe = embedResult.value;
                markOfflineAiModelReady('embed');
            } else {
                markOfflineAiModelFallback('embed', embedResult.reason);
            }
            if (grammarResult.status === 'fulfilled') {
                offlineAi.grammarPipe = grammarResult.value;
                markOfflineAiModelReady('grammar');
            } else {
                markOfflineAiModelFallback('grammar', grammarResult.reason);
            }
            offlineAi.status = offlineAi.embedPipe ? 'ready' : 'fallback';
            renderOfflineAiStatus();
        })
        .catch(error => {
            console.warn('Offline AI model preload failed:', error);
            offlineAi.status = 'fallback';
            markOfflineAiModelFallback('embed', error);
            markOfflineAiModelFallback('grammar', error);
            renderOfflineAiStatus();
        });
    return offlineAi.loadPromise;
}

function retryOfflineAiModels() {
    offlineAi.loadPromise = null;
    offlineAi.embedPipe = null;
    offlineAi.grammarPipe = null;
    preloadOfflineAiModels();
}

async function loadOfflineAiPipeline(pipeline, key, task, modelId) {
    const attempts = [
        { label: 'quantized', options: { dtype: 'q8' } },
        { label: 'standard', options: {} }
    ];
    let lastError = null;
    for (const attempt of attempts) {
        try {
            markOfflineAiModelPreparing(key, attempt.label);
            return await pipeline(task, modelId, {
                ...attempt.options,
                progress_callback: progress => updateOfflineAiProgress(key, progress)
            });
        } catch (error) {
            lastError = error;
            console.warn(`Offline AI ${key} ${attempt.label} load failed:`, error);
            if (attempt !== attempts[attempts.length - 1]) {
                markOfflineAiModelRetrying(key, attempt.label, error);
            }
        }
    }
    throw lastError;
}

function updateOfflineAiProgress(key, event = {}) {
    const model = offlineAi.models[key];
    if (!model) return;
    const status = String(event.status || '').toLowerCase();
    const progress = Number(event.progress);
    const loaded = Number(event.loaded);
    const total = Number(event.total);
    model.file = event.file || event.name || model.file || '';
    model.error = '';
    if (Number.isFinite(loaded)) model.loaded = Math.max(model.loaded || 0, loaded);
    if (Number.isFinite(total) && total > 0) model.total = Math.max(model.total || 0, total);
    if (Number.isFinite(progress)) {
        model.progress = Math.max(model.progress, Math.max(0, Math.min(progress, 100)));
    } else if (Number.isFinite(loaded) && Number.isFinite(total) && total > 0) {
        model.progress = Math.max(model.progress, Math.round((loaded / total) * 100));
    } else if (status.includes('ready') || status.includes('done')) {
        model.progress = 100;
    } else if (status.includes('download') || status.includes('progress')) {
        model.progress = Math.max(model.progress, 5);
    }
    if (status.includes('ready') || status.includes('done')) {
        model.status = 'ready';
    } else if (status.includes('download') || status.includes('progress')) {
        model.status = 'downloading';
    } else if (status.includes('init') || status.includes('load')) {
        model.status = 'preparing';
    } else if (model.status === 'waiting') {
        model.status = 'preparing';
    }
    renderOfflineAiStatus();
}

function markOfflineAiModelPreparing(key, attempt) {
    const model = offlineAi.models[key];
    if (!model) return;
    model.status = 'preparing';
    model.error = '';
    model.file = attempt ? `${attempt} model` : model.file;
    renderOfflineAiStatus();
}

function markOfflineAiModelRetrying(key, attempt, error) {
    const model = offlineAi.models[key];
    if (!model) return;
    model.status = 'retrying';
    model.error = `Retrying after ${attempt} load failed: ${offlineAiErrorMessage(error)}`;
    renderOfflineAiStatus();
}

function markOfflineAiModelReady(key) {
    const model = offlineAi.models[key];
    if (!model) return;
    model.status = 'ready';
    model.progress = 100;
    renderOfflineAiStatus();
}

function markOfflineAiModelFallback(key, error) {
    const model = offlineAi.models[key];
    if (!model || model.status === 'ready') return;
    model.status = 'basic';
    model.error = offlineAiErrorMessage(error);
    renderOfflineAiStatus();
}

function offlineAiErrorMessage(error) {
    if (!error) return '';
    return String(error.message || error.name || error).slice(0, 180);
}

function renderOfflineAiStatus() {
    if (!els.offlineAiStatus) return;
    els.offlineAiStatus.classList.toggle('ready', offlineAi.status === 'ready');
    els.offlineAiStatus.classList.toggle('fallback', offlineAi.status === 'fallback');
    if (offlineAi.status === 'ready') {
        els.offlineAiStatus.textContent = 'Offline AI ready';
    } else if (offlineAi.status === 'fallback') {
        els.offlineAiStatus.textContent = 'Offline AI basic';
    } else {
        const progress = offlineAiAggregateProgress();
        els.offlineAiStatus.textContent = progress > 0 ? `Offline AI loading ${progress}%` : 'Offline AI loading';
    }
    renderOfflineAiDetails();
}

function offlineAiAggregateProgress() {
    const models = Object.values(offlineAi.models);
    if (!models.length) return 0;
    return Math.round(models.reduce((total, model) => total + Number(model.progress || 0), 0) / models.length);
}

function toggleOfflineAiDetails() {
    setOfflineAiDetailsOpen(els.offlineAiStatus.getAttribute('aria-expanded') !== 'true');
}

function setOfflineAiDetailsOpen(open) {
    els.offlineAiStatus.setAttribute('aria-expanded', String(open));
    els.offlineAiDetails.hidden = !open;
    if (open) renderOfflineAiDetails();
}

function renderOfflineAiDetails() {
    if (!els.offlineAiDetails) return;
    const details = offlineAiDetailsCopy();
    els.offlineAiDetails.innerHTML = `
        <strong>${esc(details.title)}</strong>
        <p>${esc(details.body)}</p>
        <div class="ai-progress-list">${renderOfflineAiProgressRows()}</div>
        <p>${esc(details.note)}</p>
        ${offlineAi.status === 'fallback' ? '<button class="btn small-btn ai-retry-btn" type="button" data-offline-ai-retry>Retry download</button>' : ''}
    `;
}

function renderOfflineAiProgressRows() {
    return Object.entries(offlineAi.models).map(([key, model]) => {
        const progress = Math.round(model.progress || 0);
        const label = offlineAiModelStatusLabel(model);
        return `
            <div class="ai-progress-row">
                <div class="ai-progress-head">
                    <span>${esc(model.label)}</span>
                    <span>${esc(label)}</span>
                </div>
                <div class="ai-progress-bar" aria-label="${esc(model.label)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" role="progressbar">
                    <i style="width: ${progress}%"></i>
                </div>
                ${model.file ? `<div class="ai-progress-file">${esc(model.file)}${model.loaded && model.total ? ` - ${formatBytes(model.loaded)} / ${formatBytes(model.total)}` : ''}</div>` : ''}
                ${model.error ? `<div class="ai-progress-error">${esc(model.error)}</div>` : ''}
            </div>
        `;
    }).join('');
}

function offlineAiModelStatusLabel(model) {
    if (model.status === 'ready') return 'Ready';
    if (model.status === 'basic') return 'Basic fallback';
    if (model.status === 'downloading') return `${Math.round(model.progress || 0)}%`;
    if (model.status === 'retrying') return 'Retrying';
    if (model.status === 'preparing') return 'Preparing';
    return 'Waiting';
}

function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
}

function offlineAiDetailsCopy() {
    if (offlineAi.status === 'ready') {
        return {
            title: 'Offline AI ready',
            body: 'Short-answer feedback uses browser-cached AI embeddings plus local checks for key ideas, important values, and answer completeness.',
            note: 'Student answers are assessed in this browser. The model files are reused from browser cache after the first download.'
        };
    }
    if (offlineAi.status === 'fallback') {
        return {
            title: 'Offline AI basic',
            body: 'The full offline model is not available yet, so short-answer feedback uses local scoring based on expected-answer terms, math values, and answer length.',
            note: 'Keep this page open with internet access to let the model download in the background. Feedback still works while it downloads.'
        };
    }
    return {
        title: 'Offline AI loading',
        body: 'The app is downloading browser-cached AI models in the background. Quiz login and question loading can continue meanwhile.',
        note: 'Until the model is ready, short-answer feedback uses the basic local scorer.'
    };
}

async function handleStudentAuth(user) {
    const generation = ++authGeneration;
    studentProfile = null;
    session = null;
    recentSessions = [];
    loadedQuestions = [];
    quiz = null;
    stopTimer();
    window.speechSynthesis?.cancel();
    hasSubmittedCurrentSession = false;
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    els.resetBtn.hidden = true;
    els.viewSubmissionsBtn.hidden = true;
    $('signOutBtn').hidden = !user;
    showOnly('loading');
    if (!user) { window.location.replace(loginUrl()); return; }
    setStatus('Loading student profile...');
    try {
        const snap = await getDoc(doc(db, 'studentProfiles', user.uid));
        if (generation !== authGeneration) return;
        const profile = snap.exists() ? snap.data() : null;
        if (!profile || profile.active !== true || !profile.sectionId || !profile.admissionNo
            || profile.authUid !== user.uid || profile.studentKey !== `${profile.sectionId}_${profile.admissionNo}`) {
            throw new Error('Your student profile is unavailable or inactive. Contact your school administrator.');
        }
        studentProfile = { ...profile, authUid: user.uid, email: user.email };
        setHeaderStudent(studentProfile);
        $('dashboardWelcome').textContent = `Welcome, ${profile.studentName || 'Student'}`;
        $('dashboardSection').textContent = `Admission ${profile.admissionNo}`;
        els.viewSubmissionsBtn.hidden = false;
        await loadStudentSessions();
        maybePromptGuidedTour();
        if (generation !== authGeneration) return;
        const params = new URLSearchParams(window.location.search);
        if (params.get('show-recent') === '1') {
            window.location.href = submissionsUrl({ showRecent: true });
        }
    } catch (error) {
        if (generation !== authGeneration) return;
        window.location.replace(loginUrl());
    }
}

async function loadStudentSessions() {
    if (!studentProfile) return;
    const profile = studentProfile;
    showOnly('dashboard');
    els.resetBtn.hidden = true;
    $('sessionList').textContent = 'Loading quiz sessions...';
    $('refreshSessionsBtn').disabled = true;
    try {
        const [snap, submissionsSnap] = await Promise.all([
            getDocs(query(collection(db, COLLECTIONS.classrooms), where('sectionId', '==', profile.sectionId))),
            getDocs(query(collection(db, COLLECTIONS.submissions), where('studentKey', '==', profile.studentKey)))
        ]);
        const submittedClassrooms = new Set(submissionsSnap.docs.map(item => item.data().classroomId));
        if (studentProfile !== profile) return;
        recentSessions = snap.docs.map(item => ({ classroomId: item.id, classroom: item.data() }))
            .filter(item => item.classroom.classEnabled === true && item.classroom.archived !== true)
            .sort((a, b) => sessionCreatedMillis(b.classroom) - sessionCreatedMillis(a.classroom));
        $('dashboardSection').textContent = `${recentSessions[0]?.classroom.sectionName || profile.sectionId} · Admission ${profile.admissionNo}`;
        $('sessionList').innerHTML = recentSessions.length ? recentSessions.map(({ classroomId, classroom }) => {
            const date = sessionCreatedMillis(classroom);
            const status = quizSessionStatus(classroom, submittedClassrooms.has(classroomId));
            return `<button type="button" class="session-card ${status.className}" data-session-id="${esc(classroomId)}"><strong>${esc(classroom.className || classroom.classCode || classroomId)}</strong>${status.label ? `<span class="session-status">${esc(status.label)}</span>` : ''}<span>${esc(classroom.sectionName || profile.sectionId)}${date ? ` · ${esc(new Date(date).toLocaleString())}` : ''}</span><span class="session-dates"><span>Start: ${esc(sessionScheduleDate(classroom.startAt, 'Not scheduled'))}</span><span>Due: ${esc(sessionScheduleDate(classroom.dueAt, 'No due date'))}</span></span><span>Take Quiz →</span></button>`;
        }).join('') : '<div class="quiz-summary">No active quiz sessions are available for your section yet.</div>';
        setStatus('Choose a quiz session to begin');
    } catch (error) {
        if (studentProfile !== profile) return;
        $('sessionList').textContent = error.message || 'Unable to load quiz sessions. Use Refresh to try again.';
        setStatus('Quiz sessions could not be loaded');
    } finally { $('refreshSessionsBtn').disabled = false; }
}

function quizSessionStatus(classroom, submitted, today = new Date()) {
    if (submitted) return { className: 'session-submitted', label: 'Submitted' };
    const dueMillis = classroom.dueAt?.toMillis?.();
    if (!Number.isFinite(dueMillis)) return { className: '', label: '' };
    const due = new Date(dueMillis);
    // Compare local calendar dates, avoiding daylight-saving changes in day lengths.
    const dayNumber = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
    const daysRemaining = dayNumber(due) - dayNumber(today);
    if (daysRemaining < 0) return { className: 'session-overdue', label: 'Overdue' };
    if (daysRemaining <= 3) return { className: 'session-due-soon', label: daysRemaining === 0 ? 'Due today' : 'Due within 3 days' };
    if (daysRemaining <= 6) return { className: 'session-due-week', label: 'Due within 6 days' };
    return { className: '', label: '' };
}

function sessionScheduleDate(timestamp, fallback) {
    const millis = timestamp?.toMillis?.();
    return Number.isFinite(millis) ? new Date(millis).toLocaleString() : fallback;
}

function sessionCreatedMillis(classroom) {
    return classroom.createdAt?.toMillis?.() || Number(classroom.createdDate) || 0;
}

async function openQuizSession(classroomId) {
    if (!studentProfile || openingSession) return;
    openingSession = true;
    const profile = studentProfile;
    try {
        const snap = await getDoc(doc(db, COLLECTIONS.classrooms, classroomId));
        if (studentProfile !== profile) return;
        const classroom = snap.exists() ? snap.data() : null;
        if (!classroom || classroom.sectionId !== profile.sectionId || classroom.classEnabled !== true || classroom.archived === true) {
            throw new Error('This quiz session is no longer available. Refresh the dashboard.');
        }
        session = { ...profile, classroomId, classroom };
        loadedQuestions = [];
        quiz = null;
        currentIndex = 0;
        stopTimer();
        els.welcomeTitle.textContent = `Welcome, ${profile.studentName || 'Student'}`;
        els.classroomLabel.textContent = `${classroom.className || classroomId} · ${classroom.sectionName || profile.sectionId}`;
        configureSetupForClassroom();
        const existingSubmissionId = await findExistingClassroomSubmissionId();
        hasSubmittedCurrentSession = !!existingSubmissionId;
        if (studentProfile !== profile) return;
        showOnly('setup');
        els.resetBtn.hidden = false;
        if (hasSubmittedCurrentSession) {
            $('loadQuestionsBtn').disabled = true;
            const detailUrl = `submission.html?${new URLSearchParams({ id: existingSubmissionId })}`;
            els.questionLoadSummary.innerHTML = `You have already submitted this quiz session. <a href="${esc(detailUrl)}">View your submission</a> to review your answers.`;
            setStatus('Already submitted for this quiz session');
        } else if (hasQuizSessionQuestionList()) {
            await loadPublishedQuestions();
        } else {
            await loadTaxonomyFilters();
        }
    } catch (error) { toast(error.message || 'Unable to open quiz session.'); }
    finally { openingSession = false; }
}

function submissionsUrl(options = {}) {
    const params = new URLSearchParams({ v: APP_VERSION });
    if (options.showRecent) params.set('show-recent', '1');
    return `submissions.html?${params}`;
}

function configureSetupForClassroom() {
    const hasClassroomList = !!session?.classroom?.questionBankListId;
    const showSettings = shouldShowQuizSettings();
    const showAudioSettings = shouldShowAudioQuizSettings();
    const showPracticeSettings = shouldShowPracticeQuizSettings();
    els.quizFiltersGroup.hidden = hasClassroomList;
    els.quizSettingsGroup.hidden = !showSettings;
    els.instantFeedbackSetting.hidden = !showPracticeSettings;
    els.speakerButtonSetting.hidden = !showAudioSettings;
    els.listenRespondSetting.hidden = !showAudioSettings;
    els.fibChoiceBankSetting.hidden = !showPracticeSettings;
    els.shortAnswerWordBankSetting.hidden = !showPracticeSettings;
    els.translatedShortAnswerSetting.hidden = !showPracticeSettings;
    els.voiceSetting.hidden = !showAudioSettings;
    els.voiceSpeedSetting.hidden = !showAudioSettings;
    els.quizFilterControls.hidden = hasClassroomList && !showSettings;
    $('loadQuestionsBtn').hidden = hasClassroomList;
    $('loadQuestionsBtn').disabled = false;
    els.startQuizBtn.disabled = true;
    els.questionLoadSummary.textContent = hasClassroomList
        ? 'Loading the teacher-selected quiz session question list...'
        : 'Load questions to see availability.';
}

function sessionMode() {
    return String(session?.classroom?.mode || '').trim();
}

function shouldShowQuizSettings() {
    return ['quiz', 'practice', 'wpt', 'rpt', 'reading_practice', 'writing_practice'].includes(sessionMode());
}

function shouldShowAudioQuizSettings() {
    return ['quiz', 'practice', 'wpt', 'rpt', 'reading_practice', 'writing_practice'].includes(sessionMode());
}

function shouldShowPracticeQuizSettings() {
    return ['practice', 'reading_practice', 'writing_practice'].includes(sessionMode());
}

async function loadTaxonomyFilters() {
    try {
        setStatus('Loading quiz filters...');
        const snap = await getDocs(collection(db, COLLECTIONS.taxonomy));
        taxonomyItems = snap.docs
            .map(taxonomyDoc => normalizeTaxonomyItem(taxonomyDoc.id, taxonomyDoc.data()))
            .filter(item => item.id && item.label && ['class', 'subject', 'chapter'].includes(item.type))
            .sort((a, b) => a.label.localeCompare(b.label));
        taxonomyById = new Map(taxonomyItems.map(item => [item.id, item]));
        populateTaxonomySelect('classFilter', taxonomyItems.filter(item => item.type === 'class'), 'Select class');
        populateTaxonomySelect('subjectFilter', [], 'Select subject');
        populateTaxonomySelect('chapterFilter', [], 'Select chapter');
        els.subjectFilterField.hidden = true;
        els.chapterFilterField.hidden = true;
        setStatus('Verified. Choose quiz filters and load questions.');
    } catch (error) {
        els.questionLoadSummary.textContent = error.message || 'Unable to load class, subject, and chapter filters.';
        setStatus('Quiz filter load failed');
    }
}

function normalizeTaxonomyItem(id, item) {
    return {
        id,
        type: String(item.type || ''),
        label: String(item.label || ''),
        parentId: item.parentId || '',
        classId: item.classId || '',
        subjectId: item.subjectId || '',
        chapterId: item.chapterId || ''
    };
}

function populateTaxonomySelect(selectId, items, placeholder) {
    const select = $(selectId);
    select.innerHTML = [
        `<option value="">${esc(placeholder)}</option>`,
        ...items.map(item => `<option value="${esc(item.id)}">${esc(item.label)}</option>`)
    ].join('');
}

function handleClassFilterChange() {
    const classId = $('classFilter').value;
    populateTaxonomySelect('subjectFilter', taxonomyItems.filter(item => item.type === 'subject' && (item.parentId === classId || item.classId === classId)), 'Select subject');
    populateTaxonomySelect('chapterFilter', [], 'Select chapter');
    els.subjectFilterField.hidden = !classId;
    els.chapterFilterField.hidden = true;
    resetLoadedQuestionSelection();
}

function handleSubjectFilterChange() {
    const subjectId = $('subjectFilter').value;
    populateTaxonomySelect('chapterFilter', taxonomyItems.filter(item => item.type === 'chapter' && (item.parentId === subjectId || item.subjectId === subjectId)), 'Select chapter');
    els.chapterFilterField.hidden = !subjectId;
    resetLoadedQuestionSelection();
}

function resetLoadedQuestionSelection() {
    loadedQuestions = [];
    els.startQuizBtn.disabled = true;
    els.questionLoadSummary.textContent = 'Load questions to see availability.';
    if (els.selectionMemoryPanel) {
        els.selectionMemoryPanel.hidden = true;
        els.selectionMemoryDetails.innerHTML = '';
    }
}

async function loadPublishedQuestions() {
    if (!session) return toast('Verify student first');
    if (hasSubmittedCurrentSession) {
        els.startQuizBtn.disabled = true;
        toast('A submission already exists for this admission number in this quiz session.');
        setStatus('Already submitted for this quiz session.');
        return;
    }
    try {
        const listId = session.classroom.questionBankListId;
        if (listId) {
            setStatus('Loading quiz session question list...');
            const listQuestions = await loadQuestionsFromList(listId);
            const difficulty = studentDifficultyLevel();
            const difficultyQuestions = applyStudentDifficulty(listQuestions, difficulty);
            loadedQuestions = applyRandomTypeCounts(difficultyQuestions, session.classroom.randomQuestionTypeCounts);
            els.questionLoadSummary.textContent = classroomListSummary(listQuestions, difficultyQuestions, loadedQuestions, session.classroom.randomQuestionTypeCounts, difficulty);
        } else {
            setStatus('Loading published questions...');
            if (!taxonomyItems.length) await loadTaxonomyFilters();
            const filters = getQuizFilters();
            if (!filters.classId) {
                loadedQuestions = [];
                els.startQuizBtn.disabled = true;
                els.questionLoadSummary.textContent = 'Select a class before loading questions.';
                setStatus('Class is required to load questions.');
                $('classFilter').focus();
                return;
            }
            const snap = await getDocs(query(collection(db, COLLECTIONS.questions), where('status', '==', 'published')));
            loadedQuestions = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(q => matchesQuizFilters(q, filters));
            const requested = Number($('questionCountInput').value || 10);
            const filterSummary = [
                filters.verifiedOnly ? 'staff verified' : '',
                filters.explanationOnly ? 'with explanations' : '',
                filters.translationOnly ? 'with translations' : ''
            ].filter(Boolean).join(' and ');
            els.questionLoadSummary.textContent = `${loadedQuestions.length} published question${loadedQuestions.length === 1 ? '' : 's'}${filterSummary ? ` ${filterSummary}` : ''} match these filters. All are downloaded locally; ${Math.min(requested, loadedQuestions.length)} will be chosen using student performance memory at Start.`;
        }
        els.startQuizBtn.disabled = (hasSubmittedCurrentSession) || !loadedQuestions.length;
        setStatus(hasSubmittedCurrentSession ? 'Already submitted for this quiz session.' : 'Questions loaded. You can start the quiz.');
    } catch (error) {
        els.questionLoadSummary.textContent = error.message || 'Unable to load questions.';
        setStatus('Question load failed');
    }
}

function applyRandomTypeCounts(questions, counts) {
    const normalizedCounts = normalizedQuestionTypeCounts(counts);
    if (!Object.keys(normalizedCounts).length) return questions;

    const selectedById = new Map();
    Object.entries(normalizedCounts).forEach(([type, count]) => {
        const candidates = questions.filter(question => question.type === type);
        shuffle(candidates).slice(0, count).forEach(question => selectedById.set(question.id, question));
    });
    return questions.filter(question => selectedById.has(question.id));
}

function applyStudentDifficulty(questions, difficulty) {
    if (!difficulty) return questions;
    return questions.filter(question => question.difficulty === difficulty);
}

function studentDifficultyLevel() {
    const levels = session?.classroom?.studentDifficultyLevels;
    if (!levels || typeof levels !== 'object' || Array.isArray(levels)) return '';
    const admissionNo = String(session.admissionNo || '');
    return String(levels[admissionNo] || '').trim();
}

function normalizedQuestionTypeCounts(counts) {
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return {};
    return Object.fromEntries(
        Object.entries(counts)
            .map(([type, count]) => [type, Math.floor(Number(count))])
            .filter(([type, count]) => type && Number.isFinite(count) && count > 0)
    );
}

function classroomListSummary(allQuestions, difficultyQuestions, selectedQuestions, counts, difficulty) {
    const normalizedCounts = normalizedQuestionTypeCounts(counts);
    const difficultyPrefix = difficulty
        ? `${difficultyQuestions.length} of ${allQuestions.length} listed question${allQuestions.length === 1 ? '' : 's'} match ${difficulty} difficulty. `
        : '';
    if (!Object.keys(normalizedCounts).length) {
        return `${difficultyPrefix}${selectedQuestions.length} quiz session question${selectedQuestions.length === 1 ? '' : 's'} loaded in teacher-selected order.`;
    }

    const pickedLabels = Object.entries(normalizedCounts)
        .map(([type, requested]) => {
            const picked = selectedQuestions.filter(question => question.type === type).length;
            const available = difficultyQuestions.filter(question => question.type === type).length;
            return `${picked}/${Math.min(requested, available)} ${TYPE_LABELS[type] || type}`;
        });
    return `${difficultyPrefix}${selectedQuestions.length} quiz session question${selectedQuestions.length === 1 ? '' : 's'} randomly selected by type: ${pickedLabels.join(', ')}.`;
}

async function loadQuestionsFromList(listId) {
    const listSnap = await getDoc(doc(db, COLLECTIONS.questionLists, listId));
    if (!listSnap.exists()) throw new Error('The quiz session question list could not be found.');

    const questionIds = Array.isArray(listSnap.data().questionIds)
        ? listSnap.data().questionIds.filter(id => typeof id === 'string' && id.trim())
        : [];
    if (!questionIds.length) return [];

    const questionSnaps = await Promise.all(
        questionIds.map(questionId => getDoc(doc(db, COLLECTIONS.questions, questionId)))
    );
    return questionSnaps
        .map((questionSnap, index) => questionSnap.exists()
            ? { id: questionSnap.id, listOrder: index, ...questionSnap.data() }
            : null)
        .filter(question => question && question.status === 'published');
}

function getQuizFilters() {
    const classId = $('classFilter').value;
    const subjectId = $('subjectFilter').value;
    const chapterId = $('chapterFilter').value;
    return {
        classId,
        subjectId,
        chapterId,
        className: taxonomyLabel(classId),
        subject: taxonomyLabel(subjectId),
        chapter: taxonomyLabel(chapterId),
        questionTypes: selectedQuestionTypes(),
        difficulty: $('difficultyFilter').value.trim(),
        explanationOnly: $('explanationOnlyFilter').checked,
        translationOnly: $('translationOnlyFilter').checked,
        verifiedOnly: $('verifiedOnlyFilter').checked,
        instantFeedback: $('instantFeedbackFilter').checked
    };
}

function matchesQuizFilters(question, filters) {
    if (filters.classId && question.classId !== filters.classId) return false;
    if (filters.subjectId && question.subjectId !== filters.subjectId) return false;
    if (filters.chapterId && question.chapterId !== filters.chapterId) return false;
    if (filters.questionTypes.length && !filters.questionTypes.includes(question.type)) return false;
    if (filters.difficulty && question.difficulty !== filters.difficulty) return false;
    if (filters.verifiedOnly && question.verified !== true) return false;
    if (filters.explanationOnly && !validExplanationUrl(question.explanationUrl)) return false;
    if (filters.translationOnly && !hasQuestionTranslation(question)) return false;
    return true;
}

function hasQuestionTranslation(question) {
    return questionTranslationLanguages({ translations: normalizeTranslations(question.translations) }).length > 0;
}

function selectedQuestionTypes() {
    return Array.from(document.querySelectorAll('.question-type-filter:checked')).map(input => input.value);
}

function taxonomyLabel(id) {
    return id ? taxonomyById.get(id)?.label || '' : '';
}

function validExplanationUrl(value) {
    try {
        const url = new URL(String(value || ''));
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
        return '';
    }
}

function groupQuestionsByExplanationUrl(questions) {
    const grouped = new Map();
    questions.forEach(question => {
        const key = validExplanationUrl(question.explanationUrl) || `question:${question.id}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(question);
    });
    return Array.from(grouped.values()).flat();
}

async function selectAdaptiveQuestions(questions, count) {
    setStatus('Choosing questions from student performance memory...');
    let memory;
    try {
        memory = await buildStudentPerformanceMemory();
    } catch (error) {
        console.warn('Student performance memory unavailable:', error);
        memory = emptyStudentPerformanceMemory();
        memory.memoryError = error.message || 'Unable to read previous submissions.';
    }
    const ranked = await rankQuestionsForStudent(questions, memory, { useOfflineSemantic: false });
    const selected = ranked.slice(0, count).map(item => item.question);
    selected.selectionMemory = {
        mode: 'Fast local ranking',
        summary: studentMemorySummary(memory),
        picked: ranked.slice(0, count).map((item, index) => ({
            index: index + 1,
            questionId: item.question.id,
            title: stripHtml(item.question.promptHtml || '').slice(0, 140) || `${TYPE_LABELS[item.question.type] || item.question.type} question`,
            type: TYPE_LABELS[item.question.type] || item.question.type,
            chapter: taxonomyLabel(item.question.chapterId) || item.question.chapter || 'Any chapter',
            actfl: actflMemoryDetails(item.question),
            score: item.score,
            reasons: item.reasons
        }))
    };
    selected.performanceMemory = memory;
    return selected;
}

async function buildStudentPerformanceMemory() {
    const memory = emptyStudentPerformanceMemory();
    if (!session?.studentKey) return memory;
    const snap = await getDocs(query(
        collection(db, COLLECTIONS.submissions),
        where('studentKey', '==', session.studentKey)
    ));
    memory.submissions = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    memory.submissions.forEach(submission => {
        (submission.answers || []).forEach(answer => {
            applyAnswerToPerformanceMemory(memory, {
                ...answer,
                chapter: answer.chapter || submission.chapter || '',
                difficulty: answer.difficulty || submission.difficulty || ''
            });
        });
    });
    return memory;
}

function emptyStudentPerformanceMemory() {
    return {
        submissions: [],
        answers: [],
        answeredIds: new Set(),
        missedIds: new Set(),
        correctIds: new Set(),
        weakChapters: new Map(),
        weakTypes: new Map(),
        weakDifficulties: new Map(),
        weakSkills: new Map(),
        weakActflLevels: new Map(),
        weakActflSublevels: new Map(),
        weakActflModes: new Map(),
        weakTerms: new Map(),
        strongTerms: new Map(),
        liveAnswerCount: 0
    };
}

function applyAnswerToPerformanceMemory(memory, answer, source = 'history') {
    if (!memory || !answer?.questionId) return;
    memory.answers.push(answer);
    memory.answeredIds.add(answer.questionId);
    if (source === 'live') memory.liveAnswerCount = (memory.liveAnswerCount || 0) + 1;
    const result = answerPerformanceResult(answer);
    if (result === 'weak') {
        memory.missedIds.add(answer.questionId);
        incrementMap(memory.weakChapters, answer.chapter || '');
        incrementMap(memory.weakTypes, answer.type || '');
        incrementMap(memory.weakDifficulties, answer.difficulty || '');
        if (shouldUseActflMemory()) {
            incrementMap(memory.weakSkills, answer.skill || '');
            incrementMap(memory.weakActflLevels, answer.actfl_level || '');
            incrementMap(memory.weakActflSublevels, answer.actfl_sublevel || '');
            incrementMap(memory.weakActflModes, answer.actfl_mode || '');
        }
        addWeightedTerms(memory.weakTerms, answerMemoryText(answer), source === 'live' ? 1.5 : 1);
    } else if (result === 'strong') {
        memory.correctIds.add(answer.questionId);
        addWeightedTerms(memory.strongTerms, answerMemoryText(answer), source === 'live' ? 1 : 0.5);
    }
}

function answerPerformanceResult(answer) {
    if (answer.aiReview?.maxMarks) {
        const ratio = Number(answer.aiReview.marks || 0) / Number(answer.aiReview.maxMarks || 1);
        if (ratio < 0.7) return 'weak';
        if (ratio >= 0.85) return 'strong';
        return 'mixed';
    }
    if (answer.isCorrect === false || answer.isCorrect === null) return 'weak';
    if (answer.isCorrect === true) return 'strong';
    return 'mixed';
}

function answerMemoryText(answer) {
    return [
        stripHtml(answer.promptHtml || ''),
        answer.correctAnswer || '',
        answer.displayAnswer || '',
        answer.chapter || '',
        answer.topic || '',
        answer.type || '',
        shouldUseActflMemory() ? actflMemoryText(answer) : ''
    ].join(' ');
}

async function rankQuestionsForStudent(questions, memory, options = {}) {
    const useOfflineSemantic = options.useOfflineSemantic !== false && !!offlineAi.embedPipe;
    const weakTerms = topMapKeys(memory.weakTerms, 18);
    const weakMemoryText = weakTerms.join(' ');
    const strongTerms = topMapKeys(memory.strongTerms, 18);
    const strongMemoryText = strongTerms.join(' ');
    const ranked = await Promise.all(questions.map(async (question, index) => {
        let score = Math.max(0, questions.length - index) * 0.001;
        const reasons = [];
        if (memory.missedIds.has(question.id)) {
            score += 5;
            reasons.push('Previously missed this exact question, so it is useful for retest.');
        } else if (memory.correctIds.has(question.id)) {
            score -= 3;
            reasons.push('Previously answered correctly, so it is deprioritized unless needed for balance.');
        } else {
            score += 2;
            reasons.push('New question for this student.');
        }

        const chapter = taxonomyLabel(question.chapterId) || question.chapter || '';
        const type = question.type || '';
        const difficulty = question.difficulty || '';
        const chapterWeakness = memory.weakChapters.get(chapter) || 0;
        const typeWeakness = memory.weakTypes.get(type) || 0;
        const difficultyWeakness = memory.weakDifficulties.get(difficulty) || 0;
        if (chapterWeakness) {
            score += Math.min(chapterWeakness, 4) * 1.5;
            reasons.push(`Targets weak chapter memory: ${chapter} (${chapterWeakness} past issue${chapterWeakness === 1 ? '' : 's'}).`);
        }
        if (typeWeakness) {
            score += Math.min(typeWeakness, 4);
            reasons.push(`Targets weak question type memory: ${TYPE_LABELS[type] || type}.`);
        }
        if (difficultyWeakness) {
            score += Math.min(difficultyWeakness, 3) * 0.6;
            reasons.push(`Matches difficulty where the student has struggled: ${difficulty}.`);
        }
        if (shouldUseActflMemory()) {
            const actflScore = actflWeaknessScore(question, memory);
            if (actflScore.score) {
                score += actflScore.score;
                reasons.push(`Targets ACTFL memory: ${actflScore.reasons.join(', ')}.`);
            }
        }

        const questionText = questionMemoryText(question);
        if (weakMemoryText) {
            if (useOfflineSemantic) {
                const similarity = await offlineSemanticScore(weakMemoryText, questionText);
                if (similarity !== null) {
                    score += similarity * 4;
                    reasons.push(`Offline AI similarity to weak-memory concepts: ${Math.round(similarity * 100)}%.`);
                }
            } else {
                const overlap = termOverlapScore(weakTerms, contentTerms(questionText));
                if (overlap) {
                    score += overlap * 4;
                    reasons.push(`Keyword overlap with weak-memory concepts: ${Math.round(overlap * 100)}%.`);
                }
            }
        }
        if (strongMemoryText) {
            if (useOfflineSemantic) {
                const similarity = await offlineSemanticScore(strongMemoryText, questionText);
                if (similarity !== null && similarity > 0.35) {
                    score -= similarity * 1.5;
                    reasons.push(`Lower priority because it is similar to concepts already answered well: ${Math.round(similarity * 100)}%.`);
                }
            } else {
                const overlap = termOverlapScore(strongTerms, contentTerms(questionText));
                if (overlap) {
                    score -= overlap * 1.5;
                    reasons.push(`Lower priority because it overlaps concepts already answered well: ${Math.round(overlap * 100)}%.`);
                }
            }
        }
        if (validExplanationUrl(question.explanationUrl)) {
            score += 0.5;
            reasons.push('Has an explanation link for supported revision.');
        }
        if (!reasons.length) reasons.push('Selected to keep the quiz balanced across the matching pool.');
        return { question, score, reasons };
    }));
    return ranked.sort((a, b) => b.score - a.score);
}

function questionMemoryText(question) {
    return [
        stripHtml(question.promptHtml || ''),
        correctAnswerText(question),
        taxonomyLabel(question.chapterId) || question.chapter || '',
        taxonomyLabel(question.topicId) || question.topic || '',
        question.type || '',
        question.difficulty || '',
        question.explanation || '',
        shouldUseActflMemory() ? actflMemoryText(question) : ''
    ].join(' ');
}

function shouldUseActflMemory() {
    return ['reading_practice', 'writing_practice'].includes(String(session?.classroom?.mode || '').trim());
}

function actflMemoryText(item) {
    return [
        item.skill || '',
        item.actfl_level || '',
        item.actfl_sublevel || '',
        item.actfl_mode || ''
    ].filter(Boolean).join(' ');
}

function actflMemoryDetails(item) {
    if (!shouldUseActflMemory()) return [];
    return [
        item.skill ? `Skill: ${item.skill}` : '',
        item.actfl_level ? `ACTFL Level: ${item.actfl_level}` : '',
        item.actfl_sublevel ? `ACTFL Sublevel: ${item.actfl_sublevel}` : '',
        item.actfl_mode ? `ACTFL Mode: ${item.actfl_mode}` : ''
    ].filter(Boolean);
}

function actflWeaknessScore(question, memory) {
    const matches = [
        { label: 'skill', value: question.skill, map: memory.weakSkills, weight: 1.2 },
        { label: 'level', value: question.actfl_level, map: memory.weakActflLevels, weight: 1.1 },
        { label: 'sublevel', value: question.actfl_sublevel, map: memory.weakActflSublevels, weight: 0.7 },
        { label: 'mode', value: question.actfl_mode, map: memory.weakActflModes, weight: 1 }
    ]
        .map(item => ({ ...item, count: item.value ? item.map.get(item.value) || 0 : 0 }))
        .filter(item => item.count > 0);
    return {
        score: matches.reduce((total, item) => total + Math.min(item.count, 4) * item.weight, 0),
        reasons: matches.map(item => `${item.label} ${item.value} (${item.count} past issue${item.count === 1 ? '' : 's'})`)
    };
}

function studentMemorySummary(memory) {
    if (!memory.answers.length) {
        return [
            memory.memoryError ? `Previous-answer memory unavailable: ${memory.memoryError}` : 'No previous answered questions found for this student.',
            'Selection favors new questions and questions with explanations.'
        ];
    }
    const weakChapters = topMapKeys(memory.weakChapters, 4);
    const weakTypes = topMapKeys(memory.weakTypes, 4).map(type => TYPE_LABELS[type] || type);
    const weakTerms = topMapKeys(memory.weakTerms, 8);
    const liveText = memory.liveAnswerCount ? `${memory.liveAnswerCount} live answer${memory.liveAnswerCount === 1 ? '' : 's'} from this attempt included. ` : '';
    return [
        `${liveText}${memory.answers.length} answer${memory.answers.length === 1 ? '' : 's'} in memory across ${memory.submissions.length} past submission${memory.submissions.length === 1 ? '' : 's'}.`,
        weakChapters.length ? `Weak chapters: ${weakChapters.join(', ')}.` : 'No repeated weak chapter found.',
        weakTypes.length ? `Weak question types: ${weakTypes.join(', ')}.` : 'No repeated weak question type found.',
        weakTerms.length ? `Memory terms: ${weakTerms.join(', ')}.` : 'No weak-memory terms extracted.'
    ];
}

function incrementMap(map, key, amount = 1) {
    if (!key) return;
    map.set(key, (map.get(key) || 0) + amount);
}

function addWeightedTerms(map, text, weight) {
    contentTerms(text).forEach(term => incrementMap(map, term, weight));
}

function topMapKeys(map, limit) {
    return Array.from(map.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([key]) => key)
        .filter(Boolean);
}

function termOverlapScore(referenceTerms, candidateTerms) {
    if (!referenceTerms.length || !candidateTerms.length) return 0;
    const candidate = new Set(candidateTerms);
    return referenceTerms.filter(term => candidate.has(term)).length / referenceTerms.length;
}

async function updateLiveSelectionMemory(answer) {
    if (!quiz?.performanceMemory || !answer?.questionId || quiz.memoryApplied.has(answer.questionId)) return;
    applyAnswerToPerformanceMemory(quiz.performanceMemory, answer, 'live');
    quiz.memoryApplied.add(answer.questionId);
    await reorderRemainingQuestions();
}

async function reorderRemainingQuestions() {
    const remaining = quiz.questions.slice(currentIndex + 1);
    if (!remaining.length) {
        refreshSelectionMemoryDisplay([]);
        return;
    }
    const ranked = await rankQuestionsForStudent(remaining, quiz.performanceMemory, { useOfflineSemantic: false });
    const answerByQuestionId = new Map(quiz.answers.map(answer => [answer.questionId, answer]));
    const feedbackByQuestionId = new Map(quiz.feedback.map((feedback, index) => [quiz.questions[index].id, feedback]));
    const feedbackShownByQuestionId = new Map(quiz.feedbackShown.map((shown, index) => [quiz.questions[index].id, shown]));
    const promptRevealedByQuestionId = new Map(quiz.promptRevealed.map((shown, index) => [quiz.questions[index].id, shown]));
    const translationByQuestionId = new Map(quiz.translationChoices.map((language, index) => [quiz.questions[index].id, language]));
    const lockedQuestions = quiz.questions.slice(0, currentIndex + 1);
    quiz.questions = [...lockedQuestions, ...ranked.map(item => item.question)];
    quiz.answers = quiz.questions.map(question => answerByQuestionId.get(question.id) || emptyAnswer(question));
    quiz.feedback = quiz.questions.map(question => feedbackByQuestionId.get(question.id) || null);
    quiz.feedbackShown = quiz.questions.map(question => feedbackShownByQuestionId.get(question.id) || false);
    quiz.promptRevealed = quiz.questions.map(question => promptRevealedByQuestionId.get(question.id) ?? !quiz.listenRespond);
    quiz.translationChoices = quiz.questions.map(question => translationByQuestionId.get(question.id) || '');
    refreshSelectionMemoryDisplay(ranked);
}

function refreshSelectionMemoryDisplay(rankedRemaining) {
    const picked = quiz.questions.map((question, index) => {
        const rankedItem = rankedRemaining.find(item => item.question.id === question.id);
        return {
            index: index + 1,
            questionId: question.id,
            title: stripHtml(question.promptHtml || '').slice(0, 140) || `${TYPE_LABELS[question.type] || question.type} question`,
            type: TYPE_LABELS[question.type] || question.type,
            chapter: taxonomyLabel(question.chapterId) || question.chapter || 'Any chapter',
            actfl: actflMemoryDetails(question),
            score: rankedItem?.score ?? 0,
            reasons: index <= currentIndex
                ? ['Already answered in this attempt; position is locked.']
                : rankedItem?.reasons || ['Kept in remaining queue.']
        };
    });
    quiz.selectionMemory = {
        mode: 'Fast local ranking - updated after live answer',
        summary: studentMemorySummary(quiz.performanceMemory),
        picked
    };
}

async function startQuiz() {
    if (hasSubmittedCurrentSession) {
        toast('A submission already exists for this admission number in this quiz session.');
        setStatus('Already submitted for this quiz session.');
        els.startQuizBtn.disabled = true;
        return;
    }
    if (!loadedQuestions.length) return toast('Load questions first');
    const hasClassroomList = !!session?.classroom?.questionBankListId;
    const count = hasClassroomList
        ? loadedQuestions.length
        : Math.max(1, Number($('questionCountInput').value || loadedQuestions.length));
    const selectedQuestions = hasClassroomList
        ? loadedQuestions
        : await selectAdaptiveQuestions(loadedQuestions, Math.min(count, loadedQuestions.length));
    const selected = groupQuestionsByExplanationUrl(selectedQuestions).map(snapshotQuestion);
    const audioSettings = shouldShowAudioQuizSettings();
    const practiceSettings = shouldShowPracticeQuizSettings();
    quiz = {
        questions: selected,
        answers: selected.map(q => emptyAnswer(q)),
        instantFeedback: practiceSettings && $('instantFeedbackFilter').checked,
        showSpeaker: audioSettings && $('speakerButtonFilter').checked,
        listenRespond: audioSettings && $('listenRespondFilter').checked,
        fibChoiceBank: practiceSettings && $('fibChoiceBankFilter').checked,
        shortAnswerWordBank: practiceSettings && $('shortAnswerWordBankFilter').checked,
        showTranslatedShortAnswer: practiceSettings && $('translatedShortAnswerFilter').checked,
        promptRevealed: selected.map(() => !(audioSettings && $('listenRespondFilter').checked)),
        translationChoices: selected.map(() => ''),
        feedback: selected.map(() => null),
        feedbackShown: selected.map(() => false),
        selectionMemory: selectedQuestions.selectionMemory || null,
        performanceMemory: selectedQuestions.performanceMemory || emptyStudentPerformanceMemory(),
        memoryApplied: new Set(),
        startedAt: Date.now(),
        submitted: false,
        filters: getQuizFilters()
    };
    currentIndex = 0;
    startTimer();
    showOnly('quiz');
    setStatus('Quiz started. Questions are now local until submit.');
    renderSelectionMemory();
    renderQuiz();
}

function snapshotQuestion(question) {
    const snapshot = {
        id: question.id,
        type: question.type,
        classId: question.classId || '',
        subjectId: question.subjectId || '',
        chapterId: question.chapterId || '',
        topicId: question.topicId || '',
        className: taxonomyLabel(question.classId) || question.className || '',
        subject: taxonomyLabel(question.subjectId) || question.subject || '',
        chapter: taxonomyLabel(question.chapterId) || question.chapter || '',
        topic: taxonomyLabel(question.topicId) || question.topic || '',
        difficulty: question.difficulty || '',
        skill: question.skill || '',
        actfl_level: question.actfl_level || '',
        actfl_sublevel: question.actfl_sublevel || '',
        actfl_mode: question.actfl_mode || '',
        explanationUrl: validExplanationUrl(question.explanationUrl),
        explanation: question.explanation || '',
        promptHtml: question.promptHtml || '',
        options: (question.options || []).map(opt => ({ html: opt.html || '', correct: !!opt.correct })),
        trueAnswer: !!question.trueAnswer,
        fibBanks: (question.fibBanks || []).map(bank => ({ label: bank.label || 'Blank', answers: bank.answers || [] })),
        shortAnswerHtml: question.shortAnswerHtml || '',
        translations: normalizeTranslations(question.translations)
    };
    snapshot.fibChoiceOptions = buildFibChoiceOptions(snapshot);
    snapshot.shortAnswerWordOptions = buildShortAnswerWordOptions(snapshot);
    snapshot.shortAnswerTranslationWordOptions = buildShortAnswerTranslationWordOptions(snapshot);
    return snapshot;
}

function normalizeTranslations(translations) {
    if (!translations || typeof translations !== 'object') return {};
    return Object.entries(translations).reduce((normalized, [language, value]) => {
        if (!language || !value || typeof value !== 'object') return normalized;
        const entry = {
            question: String(value.question || '').trim(),
            answer: String(value.answer || '').trim(),
            options: Array.isArray(value.options) ? value.options.map(option => String(option || '').trim()) : []
        };
        if (entry.question || entry.answer || entry.options.some(Boolean)) {
            normalized[language] = entry;
        }
        return normalized;
    }, {});
}

function questionTranslationLanguages(question) {
    return Object.keys(question.translations || {}).filter(language => {
        const translation = question.translations[language];
        return translation?.question || translation?.answer || translation?.options?.some(Boolean);
    });
}

function sanitizeTranslationLanguage(question, language) {
    return language && questionTranslationLanguages(question).includes(language) ? language : '';
}

function currentTranslationLanguage(question = null) {
    const language = quiz?.translationChoices?.[currentIndex] || '';
    return question ? sanitizeTranslationLanguage(question, language) : language;
}

function ensureQuestionTranslationSelection(question) {
    if (!quiz) return;
    const language = currentTranslationLanguage(question);
    if (quiz.translationChoices[currentIndex] !== language) {
        quiz.translationChoices[currentIndex] = language;
        if (quiz.answers?.[currentIndex]) quiz.answers[currentIndex].translationLanguage = language;
    }
}

function currentTranslation(question) {
    const language = currentTranslationLanguage(question);
    return questionTranslation(question, language);
}

function questionTranslation(question, language) {
    return language ? question.translations?.[language] || null : null;
}

function questionDisplayPrompt(question) {
    return questionPromptText(question, currentTranslationLanguage(question));
}

function questionDisplayOptions(question) {
    return questionOptionTexts(question, currentTranslationLanguage(question));
}

function questionDisplayShortAnswer(question) {
    return questionShortAnswerText(question, currentTranslationLanguage(question));
}

function questionPromptText(question, language = '') {
    return questionTranslation(question, language)?.question || question.promptHtml || '';
}

function questionOptionTexts(question, language = '') {
    const translatedOptions = questionTranslation(question, language)?.options || [];
    return (question.options || []).map((option, index) => translatedOptions[index] || option.html || '');
}

function questionShortAnswerText(question, language = '') {
    return questionTranslation(question, language)?.answer || question.shortAnswerHtml || '';
}

function currentShortAnswerWordOptions(question) {
    const language = currentTranslationLanguage(question);
    return language && question.shortAnswerTranslationWordOptions?.[language]?.length
        ? question.shortAnswerTranslationWordOptions[language]
        : question.shortAnswerWordOptions || [];
}

function buildFibChoiceOptions(question) {
    if (question.type !== 'fib' || (question.fibBanks || []).length <= 1) return [];
    const primaryAnswers = (question.fibBanks || [])
        .map(bank => String(bank.answers?.[0] || '').trim())
        .filter(Boolean);
    return shuffle(primaryAnswers);
}

function buildShortAnswerWordOptions(question) {
    if (question.type !== 'short_answer') return [];
    return shuffle(shortAnswerWords(question.shortAnswerHtml));
}

function buildShortAnswerTranslationWordOptions(question) {
    if (question.type !== 'short_answer') return {};
    return Object.entries(question.translations || {}).reduce((options, [language, translation]) => {
        const words = shortAnswerWords(translation.answer || '');
        if (words.length) options[language] = shuffle(words);
        return options;
    }, {});
}

function emptyAnswer(question) {
    return {
        questionId: question.id,
        type: question.type,
        selectedOptions: [],
        trueFalseAnswer: null,
        fibAnswers: (question.fibBanks || []).map(() => ''),
        shortAnswerChoiceIndices: [],
        shortAnswerInsertIndex: 0,
        shortAnswerMode: 'word_bank',
        translationLanguage: '',
        shortAnswer: ''
    };
}

function renderQuiz() {
    const question = quiz.questions[currentIndex];
    const answer = quiz.answers[currentIndex];
    ensureQuestionTranslationSelection(question);
    renderExplanationFrame(question.explanationUrl);
    const score = instantFeedbackScore();
    const scoreSummary = quiz.instantFeedback && score.max ? ` · Score ${score.scored}/${score.max}` : '';
    els.progressSummary.textContent = `Question ${currentIndex + 1} of ${quiz.questions.length} · ${quiz.answers.filter((a, i) => isAnswered(quiz.questions[i], a)).length} answered${scoreSummary}`;
    els.timerLabel.textContent = elapsedLabel(Date.now() - quiz.startedAt);
    els.questionMeta.textContent = `${question.className || 'Class'} · ${question.subject || 'Subject'} · ${question.chapter || 'Chapter'} · ${question.difficulty || 'Difficulty'}`;
    els.questionTitle.textContent = `Question ${currentIndex + 1}`;
    els.questionTypeLabel.textContent = TYPE_LABELS[question.type] || question.type;
    els.questionPrompt.innerHTML = sanitizeRich(questionDisplayPrompt(question));
    renderQuestionAudioControls(question);
    els.questionPrompt.hidden = quiz.listenRespond && !quiz.promptRevealed[currentIndex];
    els.answerArea.innerHTML = answerInputHtml(question, answer);
    renderInstantFeedbackPanel();
    if (quiz.instantFeedback && quiz.feedbackShown[currentIndex]) {
        disableAnswerInputs();
    }
    $('nextQuestionBtn').textContent = nextQuestionButtonLabel();
    if (!els.questionPrompt.hidden) renderRich(els.questionPrompt);
    renderRich(els.answerArea);
    renderRich(els.instantFeedbackPanel);
}

function renderQuestionAudioControls(question) {
    const shouldShow = quiz.showSpeaker || quiz.listenRespond || questionTranslationLanguages(question).length;
    els.questionAudioControls.hidden = !shouldShow;
    if (!shouldShow) {
        els.questionAudioControls.innerHTML = '';
        return;
    }
    const canSpeak = 'speechSynthesis' in window;
    const hiddenText = quiz.listenRespond && !quiz.promptRevealed[currentIndex];
    els.questionAudioControls.innerHTML = `
        ${renderTranslationControl(question)}
        ${quiz.showSpeaker || quiz.listenRespond ? `<button class="btn small-btn" type="button" data-speak-question ${canSpeak ? '' : 'disabled'}>${canSpeak ? 'Listen' : 'Speech unavailable'}</button>` : ''}
        ${hiddenText ? '<button class="btn small-btn" type="button" data-reveal-question>View question text</button>' : ''}
        ${quiz.listenRespond ? `<span class="meta-line">${hiddenText ? 'Question text hidden for listen and respond mode.' : 'Question text is visible.'}</span>` : ''}
        ${canSpeak ? `
            <div class="quiz-voice-controls">
                <label class="compact-field">
                    <span>Voice</span>
                    <select id="liveVoiceSelect">${voiceSelectOptions()}</select>
                </label>
                <label class="compact-field voice-speed-field">
                    <span>Speed <strong id="liveVoiceRateValue">${currentSpeechRate().toFixed(1)}x</strong></span>
                    <input id="liveVoiceRateInput" type="range" min="0.6" max="1.4" step="0.1" value="${currentSpeechRate()}" />
                </label>
            </div>
        ` : ''}
    `;
    populateVoiceSelect();
}

function renderTranslationControl(question) {
    const languages = questionTranslationLanguages(question);
    if (!languages.length) return '';
    const selected = currentTranslationLanguage(question);
    return `
        <label class="compact-field translation-field">
            <span>Translation</span>
            <select id="translationSelect">
                <option value="">Original</option>
                ${languages.map(language => `<option value="${esc(language)}" ${selected === language ? 'selected' : ''}>${esc(language)}</option>`).join('')}
            </select>
        </label>
    `;
}

function translatedShortAnswerPanel(question) {
    if (!quiz.showTranslatedShortAnswer || question.type !== 'short_answer') return '';
    const language = currentTranslationLanguage(question);
    const answer = language ? questionTranslation(question, language)?.answer || '' : '';
    if (!answer) return '';
    return `
        <details class="translated-answer-panel">
            <summary>View translated answer</summary>
            <div class="rich-content">${sanitizeRich(answer)}</div>
        </details>
    `;
}

function speakCurrentQuestion() {
    if (!quiz || !('speechSynthesis' in window)) return;
    const question = quiz.questions[currentIndex];
    const text = stripHtml(questionDisplayPrompt(question) || '').trim();
    if (!text) return toast('No question text to read.');
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voiceId = currentSpeechVoice();
    const voice = speechVoices.find(item => speechVoiceId(item) === voiceId);
    if (voice) utterance.voice = voice;
    utterance.rate = currentSpeechRate();
    window.speechSynthesis.speak(utterance);
}

function revealCurrentQuestionText() {
    if (!quiz) return;
    quiz.promptRevealed[currentIndex] = true;
    renderQuiz();
}

function speechVoiceId(voice) {
    return `${voice.name}__${voice.lang}`;
}

function toggleFibChoice(value) {
    const inputs = Array.from(document.querySelectorAll('.fib-input'));
    const selected = inputs.find(input => input.value === value);
    if (selected) {
        selected.value = '';
        refreshFibChoiceButtons();
        return;
    }
    const empty = inputs.find(input => !input.value.trim());
    if (!empty) {
        toast('All blanks are filled. Undo one answer to change it.');
        return;
    }
    empty.value = value;
    refreshFibChoiceButtons();
}

function clearFibChoice(index) {
    const input = document.querySelector(`.fib-input[data-fib="${index}"]`);
    if (!input) return;
    input.value = '';
    refreshFibChoiceButtons();
}

function refreshFibChoiceButtons() {
    const selectedCounts = countValues(Array.from(document.querySelectorAll('.fib-input')).map(input => input.value).filter(Boolean));
    document.querySelectorAll('[data-fib-choice]').forEach(button => {
        const value = button.dataset.fibChoice;
        const selected = (selectedCounts.get(value) || 0) > 0;
        button.classList.toggle('selected', selected);
        if (selected) selectedCounts.set(value, selectedCounts.get(value) - 1);
    });
    document.querySelectorAll('[data-fib-clear]').forEach(button => {
        const input = document.querySelector(`.fib-input[data-fib="${button.dataset.fibClear}"]`);
        button.disabled = !input?.value;
    });
}

function toggleShortAnswerChoice(optionIndex) {
    const question = quiz.questions[currentIndex];
    const answer = quiz.answers[currentIndex];
    if (!currentShortAnswerWordOptions(question)?.[optionIndex]) return;
    answer.shortAnswerChoiceIndices = answer.shortAnswerChoiceIndices || [];
    const selectedIndex = answer.shortAnswerChoiceIndices.indexOf(optionIndex);
    if (selectedIndex >= 0) {
        answer.shortAnswerChoiceIndices.splice(selectedIndex, 1);
        answer.shortAnswerInsertIndex = clampShortAnswerInsertIndex(answer.shortAnswerInsertIndex, answer);
    } else {
        const insertIndex = clampShortAnswerInsertIndex(answer.shortAnswerInsertIndex, answer);
        answer.shortAnswerChoiceIndices.splice(insertIndex, 0, optionIndex);
        answer.shortAnswerInsertIndex = insertIndex + 1;
    }
    updateShortAnswerFromChoices(question, answer);
    renderQuiz();
}

function removeShortAnswerChoice(selectedIndex) {
    const question = quiz.questions[currentIndex];
    const answer = quiz.answers[currentIndex];
    if (!answer?.shortAnswerChoiceIndices || selectedIndex < 0) return;
    answer.shortAnswerChoiceIndices.splice(selectedIndex, 1);
    if ((answer.shortAnswerInsertIndex || 0) > selectedIndex) {
        answer.shortAnswerInsertIndex -= 1;
    }
    answer.shortAnswerInsertIndex = clampShortAnswerInsertIndex(answer.shortAnswerInsertIndex, answer);
    updateShortAnswerFromChoices(question, answer);
    renderQuiz();
}

function setShortAnswerInsertIndex(insertIndex) {
    const answer = quiz.answers[currentIndex];
    answer.shortAnswerInsertIndex = clampShortAnswerInsertIndex(insertIndex, answer);
    renderQuiz();
}

function setShortAnswerMode(mode) {
    const question = quiz.questions[currentIndex];
    const answer = quiz.answers[currentIndex];
    if (mode !== 'word_bank' && mode !== 'typing') return;
    saveCurrentAnswer();
    answer.shortAnswerMode = mode;
    if (mode === 'word_bank') {
        updateShortAnswerFromChoices(question, answer);
    }
    renderQuiz();
}

function clampShortAnswerInsertIndex(insertIndex, answer) {
    const max = answer?.shortAnswerChoiceIndices?.length || 0;
    return Math.max(0, Math.min(Number.isFinite(insertIndex) ? insertIndex : max, max));
}

function updateShortAnswerFromChoices(question, answer) {
    answer.shortAnswer = (answer.shortAnswerChoiceIndices || [])
        .map(index => currentShortAnswerWordOptions(question)?.[index])
        .filter(Boolean)
        .join(' ');
}

function setQuestionTranslation(language) {
    if (!quiz) return;
    saveCurrentAnswer();
    const question = quiz.questions[currentIndex];
    const selectedLanguage = sanitizeTranslationLanguage(question, language);
    quiz.translationChoices[currentIndex] = selectedLanguage;
    const answer = quiz.answers[currentIndex];
    answer.translationLanguage = selectedLanguage;
    if (question.type === 'short_answer') {
        answer.shortAnswerChoiceIndices = [];
        answer.shortAnswerInsertIndex = 0;
        if ((answer.shortAnswerMode || 'word_bank') === 'word_bank') {
            answer.shortAnswer = '';
        }
    }
    renderQuiz();
}

function renderSelectionMemory() {
    const memory = quiz?.selectionMemory;
    if (!els.selectionMemoryPanel || !els.selectionMemoryDetails) return;
    if (!memory) {
        els.selectionMemoryPanel.hidden = true;
        els.selectionMemoryDetails.innerHTML = '';
        return;
    }
    els.selectionMemoryPanel.hidden = false;
    els.selectionMemoryDetails.innerHTML = `
        <div class="selection-memory-summary">
            <strong>${esc(memory.mode)}</strong>
            ${(memory.summary || []).map(item => `<p>${esc(item)}</p>`).join('')}
        </div>
        <ol class="selection-reason-list">
            ${(memory.picked || []).map(item => `
                <li>
                    <strong>Q${item.index}: ${esc(item.type)} - ${esc(item.chapter)}</strong>
                    <div>${esc(item.title)}</div>
                    ${(item.actfl || []).length ? `<div class="meta-line">${item.actfl.map(detail => esc(detail)).join(' · ')}</div>` : ''}
                    <div class="score-line">Selection score: ${formatPoints(item.score)}</div>
                    <ul>
                        ${(item.reasons || []).map(reason => `<li>${esc(reason)}</li>`).join('')}
                    </ul>
                </li>
            `).join('')}
        </ol>
    `;
}

function renderExplanationFrame(explanationUrl) {
    if (!validExplanationUrl(explanationUrl)) {
        els.quizPanel.classList.remove('has-explanation');
        els.explanationFramePanel.hidden = true;
        els.explanationFrame.removeAttribute('src');
        els.explanationOpenLink.href = '#';
        return;
    }
    els.quizPanel.classList.add('has-explanation');
    els.explanationFramePanel.hidden = false;
    if (els.explanationFrame.getAttribute('src') !== explanationUrl) {
        els.explanationFrame.src = explanationUrl;
    }
    els.explanationOpenLink.href = explanationUrl;
}

function renderInstantFeedbackPanel() {
    if (!quiz?.instantFeedback || !quiz.feedbackShown[currentIndex]) {
        els.instantFeedbackPanel.hidden = true;
        els.instantFeedbackPanel.innerHTML = '';
        return;
    }
    const feedback = quiz.feedback[currentIndex] || gradeAnswer(quiz.questions[currentIndex], quiz.answers[currentIndex]);
    const points = feedbackPoints(feedback);
    const total = instantFeedbackScore();
    const status = feedbackStatus(feedback);
    els.instantFeedbackPanel.hidden = false;
    els.instantFeedbackPanel.innerHTML = `
        <div class="review-head">
            <strong>Instant Feedback</strong>
            <span class="status-chip ${status.className}">${status.label}</span>
        </div>
        <div class="feedback-grid">
            <div><strong>Question points:</strong> ${formatPoints(points.scored)}/${formatPoints(points.max)}</div>
            <div><strong>Total points:</strong> ${formatPoints(total.scored)}/${formatPoints(total.max)}</div>
            <div><strong>Correct answer:</strong> ${esc(feedback.correctAnswer || 'Teacher review')}</div>
        </div>
        ${feedback.aiReview?.reason ? `<div class="feedback-reasons"><strong>Reason for points:</strong> ${esc(feedback.aiReview.reason)}</div>` : ''}
        ${feedback.aiReview ? renderDetailedAiReview(feedback.aiReview, feedback.shortAnswer || '') : ''}
        ${feedback.explanation ? `<div class="feedback-explanation"><strong>Explanation:</strong> ${esc(feedback.explanation)}</div>` : ''}
    `;
}

function renderDetailedAiReview(aiReview, studentAnswer) {
    if (!aiReview?.agents?.length) return '';
    const final = aiReview.final || {};
    const scorePercent = Math.round((Number(final.score || 0)) * 100);
    const keyIdeas = [
        ...(aiReview.matchedTerms || []).map(term => ({ term, hit: true })),
        ...(aiReview.missingTerms || []).map(term => ({ term, hit: false }))
    ];
    return `
        <section class="ai-assessment-detail">
            <div class="ai-scorecard">
                <div class="ai-bigscore">${formatPoints(aiReview.marks)}<small>/${formatPoints(aiReview.maxMarks)}</small></div>
                <div class="ai-scoremeta">
                    <span class="ai-band ${esc(final.bandClass || 'manual')}">${esc(final.bandLabel || 'Review')}</span>
                    <div class="ai-scorebar"><i style="width: ${scorePercent}%"></i></div>
                    <p>${esc(final.verdict || aiReview.reason || '')}</p>
                </div>
            </div>
            <div class="ai-agent-list">
                ${aiReview.agents.map(renderAiAgentCard).join('')}
            </div>
            <div class="ai-annotation-block">
                <strong>Student answer - annotated by AI</strong>
                <div class="ai-annotated-answer">${annotateStudentAnswer(studentAnswer, aiReview.spellingIssues || [], aiReview.grammarIssues || [])}</div>
                <div class="ai-legend">
                    <span><i class="spell"></i>spelling</span>
                    <span><i class="grammar"></i>grammar</span>
                    <span>Hover a mark for the AI suggestion.</span>
                </div>
            </div>
            <div class="ai-key-ideas">
                <strong>Key ideas vs expected answer</strong>
                <div class="ai-key-chip-list">
                    ${keyIdeas.length ? keyIdeas.map(item => `<span class="ai-key-chip ${item.hit ? 'hit' : 'miss'}">${item.hit ? 'yes' : 'no'} ${esc(item.term)}</span>`).join('') : '<span class="ai-key-chip">No key terms extracted.</span>'}
                </div>
            </div>
            <p class="ai-assessment-foot">Assessed in <strong>${formatPoints(aiReview.assessedMs || 0)} ms</strong> - ${esc(aiReview.agentCount || 5)} AI agents - 0 network calls after model download - ran entirely on this device.</p>
        </section>
    `;
}

function renderAiAgentCard(agent) {
    const percent = Math.round(Number(agent.score || 0) * 100);
    const points = Number(agent.points || 0);
    const max = Number(agent.max || 0);
    return `
        <article class="ai-agent-card">
            <div class="ai-agent-head">
                <strong>${esc(agent.name)}</strong>
                <span class="step-chip">${formatPoints(points)} / ${formatPoints(max)}</span>
            </div>
            <div class="ai-agent-meter"><i style="width: ${percent}%"></i></div>
            <p>${esc(agent.summary || '')}</p>
            ${(agent.findings || []).length ? `<ul>${agent.findings.map(finding => `<li>${esc(finding)}</li>`).join('')}</ul>` : ''}
        </article>
    `;
}

function annotateStudentAnswer(answer, spellingIssues, grammarIssues) {
    const marks = [
        ...spellingIssues.map(issue => ({ ...issue, className: 'm-spell' })),
        ...grammarIssues.map(issue => ({ ...issue, className: 'm-grammar' }))
    ]
        .filter(issue => Number.isFinite(issue.start) && Number.isFinite(issue.end) && issue.end > issue.start)
        .sort((a, b) => a.start - b.start || b.end - a.end);
    let html = '';
    let cursor = 0;
    marks.forEach(mark => {
        if (mark.start < cursor) return;
        html += esc(String(answer || '').slice(cursor, mark.start));
        html += `<mark class="${mark.className}" title="${esc(mark.message || '')}">${esc(String(answer || '').slice(mark.start, mark.end))}</mark>`;
        cursor = mark.end;
    });
    html += esc(String(answer || '').slice(cursor));
    return html || '<em>No answer submitted.</em>';
}

function feedbackPoints(feedback) {
    if (feedback?.aiReview) {
        return {
            scored: Number(feedback.aiReview.marks || 0),
            max: Number(feedback.aiReview.maxMarks || 0)
        };
    }
    if (!feedback || feedback.isCorrect === null) return { scored: 0, max: 0 };
    return { scored: feedback.isCorrect ? 1 : 0, max: 1 };
}

function feedbackStatus(feedback) {
    if (feedback?.aiReview) {
        const points = feedbackPoints(feedback);
        const ratio = points.max ? points.scored / points.max : 0;
        if (!points.max) return { label: 'Manual Review', className: 'manual' };
        if (ratio >= 0.9) return { label: 'Offline AI: Correct', className: 'correct' };
        if (ratio >= 0.45) return { label: 'Offline AI: Partial', className: 'manual' };
        return { label: 'Offline AI: Revise', className: 'wrong' };
    }
    if (feedback.isCorrect === null) return { label: 'Manual Review', className: 'manual' };
    return feedback.isCorrect
        ? { label: 'Correct', className: 'correct' }
        : { label: 'Incorrect', className: 'wrong' };
}

function formatPoints(value) {
    const number = Number(value || 0);
    return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, '');
}

function instantFeedbackScore() {
    if (!quiz?.feedback) return { scored: 0, max: 0 };
    return quiz.feedback.reduce((total, feedback) => {
        const points = feedbackPoints(feedback);
        total.scored += points.scored;
        total.max += points.max;
        return total;
    }, { scored: 0, max: 0 });
}

function disableAnswerInputs() {
    els.answerArea.querySelectorAll('input, textarea, select, button').forEach(control => {
        control.disabled = true;
    });
}

function nextQuestionButtonLabel() {
    if (quiz.instantFeedback && !quiz.feedbackShown[currentIndex]) return 'Check Answer';
    return currentIndex === quiz.questions.length - 1 ? 'Submit Quiz' : 'Next';
}

function answerInputHtml(question, answer) {
    if (question.type === 'mcq') {
        const translatedOptions = questionDisplayOptions(question);
        return (question.options || []).map((option, index) => `
            <label class="option-card">
                <input type="checkbox" class="mcq-answer" value="${index}" ${answer.selectedOptions.includes(index) ? 'checked' : ''}>
                <span><strong>${String.fromCharCode(65 + index)}.</strong> <span class="rich-content">${sanitizeRich(translatedOptions[index] || option.html || '')}</span></span>
            </label>
        `).join('');
    }
    if (question.type === 'true_false') {
        return `
            <label class="option-card"><input type="radio" name="tfAnswer" value="true" ${answer.trueFalseAnswer === true ? 'checked' : ''}> True</label>
            <label class="option-card"><input type="radio" name="tfAnswer" value="false" ${answer.trueFalseAnswer === false ? 'checked' : ''}> False</label>
        `;
    }
    if (question.type === 'fib') {
        if (quiz.fibChoiceBank && (question.fibBanks || []).length > 1 && question.fibChoiceOptions?.length) {
            const selectedCounts = countValues((answer.fibAnswers || []).filter(Boolean));
            return `
                <div class="fib-choice-layout">
                    <div class="fib-blank-list">
                        ${(question.fibBanks || []).map((bank, index) => `
                            <label class="field text-answer fib-choice-blank">
                                <span>${esc(bank.label || `Blank ${index + 1}`)}</span>
                                <div class="fib-choice-input-row">
                                    <input class="fib-input" data-fib="${index}" value="${esc(answer.fibAnswers[index] || '')}" placeholder="Select an answer" readonly />
                                    <button class="btn small-btn" type="button" data-fib-clear="${index}" ${answer.fibAnswers[index] ? '' : 'disabled'}>Undo</button>
                                </div>
                            </label>
                        `).join('')}
                    </div>
                    <div class="fib-choice-bank" aria-label="Answer choices">
                        ${question.fibChoiceOptions.map(option => {
                            const selected = (selectedCounts.get(option) || 0) > 0;
                            if (selected) selectedCounts.set(option, selectedCounts.get(option) - 1);
                            return `<button class="fib-choice-chip ${selected ? 'selected' : ''}" type="button" data-fib-choice="${esc(option)}">${esc(option)}</button>`;
                        }).join('')}
                    </div>
                </div>
            `;
        }
        return (question.fibBanks || []).map((bank, index) => `
            <label class="field text-answer">
                <span>${esc(bank.label || `Blank ${index + 1}`)}</span>
                <input class="fib-input" data-fib="${index}" value="${esc(answer.fibAnswers[index] || '')}" placeholder="Your answer" />
            </label>
        `).join('');
    }
    if (quiz.shortAnswerWordBank && currentShortAnswerWordOptions(question)?.length) {
        const mode = answer.shortAnswerMode || 'word_bank';
        const selectedIndices = answer.shortAnswerChoiceIndices || [];
        const wordOptions = currentShortAnswerWordOptions(question);
        const expectedWords = shortAnswerWords(questionDisplayShortAnswer(question));
        const selectedSet = new Set(selectedIndices);
        const insertIndex = clampShortAnswerInsertIndex(answer.shortAnswerInsertIndex, answer);
        const modeToggle = renderShortAnswerModeToggle(mode);
        if (mode === 'typing') {
            return `
                <div class="short-word-layout">
                    ${translatedShortAnswerPanel(question)}
                    ${modeToggle}
                    <label class="field text-answer">
                        <span>Short Answer</span>
                        <textarea id="shortAnswerInput" rows="5" placeholder="Type your answer">${esc(answer.shortAnswer || '')}</textarea>
                    </label>
                </div>
            `;
        }
        return `
            <div class="short-word-layout">
                ${translatedShortAnswerPanel(question)}
                ${modeToggle}
                <input id="shortAnswerInput" type="hidden" value="${esc(answer.shortAnswer || '')}" />
                <div class="short-answer-line" aria-label="Selected answer words">
                    ${selectedIndices.length ? renderShortAnswerSelectedWords(question, selectedIndices, expectedWords, insertIndex) : '<span class="short-answer-placeholder">Click words below to build your answer.</span>'}
                </div>
                ${selectedIndices.length ? '<div class="meta-line">Tap a gap to choose where the next word is inserted. Tap a selected word to remove it.</div>' : ''}
                <div class="short-word-bank" aria-label="Short answer word choices">
                    ${wordOptions.map((word, optionIndex) => `
                        <button class="short-word-chip ${selectedSet.has(optionIndex) ? 'selected' : ''}" type="button" data-short-choice-index="${optionIndex}">${esc(word)}</button>
                    `).join('')}
                </div>
            </div>
        `;
    }
    return `
        <div class="short-word-layout">
            ${translatedShortAnswerPanel(question)}
            <label class="field text-answer">
                <span>Short Answer</span>
                <textarea id="shortAnswerInput" rows="5" placeholder="Type your answer">${esc(answer.shortAnswer || '')}</textarea>
            </label>
        </div>
    `;
}

function renderShortAnswerSelectedWords(question, selectedIndices, expectedWords, insertIndex) {
    const parts = [];
    const wordOptions = currentShortAnswerWordOptions(question);
    for (let gapIndex = 0; gapIndex <= selectedIndices.length; gapIndex += 1) {
        parts.push(`
            <button class="short-insert-gap ${insertIndex === gapIndex ? 'active' : ''}" type="button" data-short-insert-index="${gapIndex}" aria-label="Insert next word here">
                +
            </button>
        `);
        if (gapIndex >= selectedIndices.length) continue;
        const optionIndex = selectedIndices[gapIndex];
        const word = wordOptions[optionIndex] || '';
        const status = normalizeWord(word) === normalizeWord(expectedWords[gapIndex] || '') ? 'correct' : 'wrong';
        parts.push(`<button class="short-selected-word ${status}" type="button" data-short-selected-index="${gapIndex}" title="Click to remove">${esc(word)}</button>`);
    }
    return parts.join('');
}

function renderShortAnswerModeToggle(mode) {
    return `
        <div class="short-mode-toggle" aria-label="Short answer input mode">
            <button class="btn small-btn ${mode === 'word_bank' ? 'active' : ''}" type="button" data-short-answer-mode="word_bank">Word bank</button>
            <button class="btn small-btn ${mode === 'typing' ? 'active' : ''}" type="button" data-short-answer-mode="typing">Type answer</button>
        </div>
    `;
}

function saveCurrentAnswer() {
    if (!quiz) return;
    if (quiz.instantFeedback && quiz.feedbackShown[currentIndex]) return;
    const question = quiz.questions[currentIndex];
    const answer = quiz.answers[currentIndex];
    answer.translationLanguage = currentTranslationLanguage(question);
    if (question.type === 'mcq') {
        answer.selectedOptions = Array.from(document.querySelectorAll('.mcq-answer:checked')).map(input => Number(input.value));
    } else if (question.type === 'true_false') {
        const checked = document.querySelector('input[name="tfAnswer"]:checked');
        answer.trueFalseAnswer = checked ? checked.value === 'true' : null;
    } else if (question.type === 'fib') {
        answer.fibAnswers = Array.from(document.querySelectorAll('.fib-input')).map(input => input.value.trim());
    } else {
        if (quiz.shortAnswerWordBank && currentShortAnswerWordOptions(question)?.length && (answer.shortAnswerMode || 'word_bank') === 'word_bank') {
            updateShortAnswerFromChoices(question, answer);
        } else {
            answer.shortAnswer = $('shortAnswerInput')?.value.trim() || '';
        }
    }
}

async function advanceQuestion() {
    saveCurrentAnswer();
    if (quiz.instantFeedback && !quiz.feedbackShown[currentIndex]) {
        await showInstantFeedback();
        return;
    }
    if (currentIndex === quiz.questions.length - 1) {
        submitQuiz();
        return;
    }
    if (!quiz.feedback[currentIndex]) {
        quiz.feedback[currentIndex] = await gradeAnswerWithOfflineAi(quiz.questions[currentIndex], quiz.answers[currentIndex]);
        await updateLiveSelectionMemory(quiz.feedback[currentIndex]);
    }
    currentIndex += 1;
    renderSelectionMemory();
    renderQuiz();
}

async function showInstantFeedback() {
    const question = quiz.questions[currentIndex];
    const nextButton = $('nextQuestionBtn');
    nextButton.disabled = true;
    nextButton.textContent = question.type === 'short_answer' ? 'Assessing...' : 'Checking...';
    quiz.feedback[currentIndex] = await gradeAnswerWithOfflineAi(question, quiz.answers[currentIndex]);
    quiz.feedbackShown[currentIndex] = true;
    await updateLiveSelectionMemory(quiz.feedback[currentIndex]);
    renderSelectionMemory();
    renderQuiz();
    nextButton.disabled = false;
}

async function submitQuiz() {
    if (!quiz || quiz.submitted) return;
    saveCurrentAnswer();
    const unanswered = quiz.answers.filter((a, i) => !isAnswered(quiz.questions[i], a)).length;
    if (unanswered && !confirm(`${unanswered} question(s) are unanswered. Submit anyway?`)) return;
    const gradedAnswers = await Promise.all(quiz.questions.map((question, index) => {
        if (quiz.feedback[index]) return quiz.feedback[index];
        return gradeAnswerWithOfflineAi(question, quiz.answers[index]);
    }));
    const gradable = gradedAnswers.filter(a => a.isCorrect !== null);
    const correct = gradable.filter(a => a.isCorrect).length;
    const submission = {
        authUid: session.authUid,
        email: session.email,
        classroomId: session.classroomId,
        sectionId: session.sectionId,
        admissionNo: session.admissionNo,
        studentName: session.studentName,
        studentKey: session.studentKey,
        quizSessionLabel: els.classroomLabel.textContent,
        classId: quiz.filters.classId,
        subjectId: quiz.filters.subjectId,
        chapterId: quiz.filters.chapterId,
        className: quiz.filters.className,
        subject: quiz.filters.subject,
        chapters: unique(quiz.questions.map(q => q.chapter).filter(Boolean)),
        difficulty: quiz.filters.difficulty,
        questionCount: quiz.questions.length,
        answeredCount: quiz.answers.filter((a, i) => isAnswered(quiz.questions[i], a)).length,
        gradableCount: gradable.length,
        correctCount: correct,
        answers: gradedAnswers,
        submittedAt: serverTimestamp(),
        submittedAtMillis: Date.now()
    };
    try {
        setStatus('Submitting quiz...');
        if (await hasExistingClassroomSubmission()) {
            toast('A submission already exists for this admission number in this quiz session.');
            setStatus('Duplicate submission blocked');
            return;
        }
        await setDoc(doc(db, COLLECTIONS.submissions, submissionDocId()), submission);
        quiz.submitted = true;
        stopTimer();
        renderResult(submission);
        showOnly('result');
        setStatus('Submitted successfully.');
    } catch (error) {
        toast(error.message || 'Submit failed. Reconnect and try again.');
        setStatus('Submit failed');
    }
}

async function hasExistingClassroomSubmission() {
    return !!(await findExistingClassroomSubmissionId());
}

async function findExistingClassroomSubmissionId() {
    const snap = await getDocs(query(
        collection(db, COLLECTIONS.submissions),
        where('studentKey', '==', session.studentKey)
    ));
    return snap.docs.find(existing => existing.data().classroomId === session.classroomId)?.id || null;
}

function hasQuizSessionQuestionList() {
    return !!session?.classroom?.questionBankListId;
}

function submissionDocId() {
    return [
        session.classroomId,
        session.sectionId,
        session.admissionNo
    ].map(value => encodeURIComponent(String(value || 'unknown'))).join('__');
}

function gradeAnswer(question, answer) {
    const translationLanguage = sanitizeTranslationLanguage(question, answer.translationLanguage || '');
    const base = {
        questionId: question.id,
        type: question.type,
        classId: question.classId || '',
        subjectId: question.subjectId || '',
        chapterId: question.chapterId || '',
        topicId: question.topicId || '',
        className: question.className || '',
        subject: question.subject || '',
        chapter: question.chapter || '',
        topic: question.topic || '',
        difficulty: question.difficulty || '',
        skill: question.skill || '',
        actfl_level: question.actfl_level || '',
        actfl_sublevel: question.actfl_sublevel || '',
        actfl_mode: question.actfl_mode || '',
        explanationUrl: validExplanationUrl(question.explanationUrl),
        explanation: question.explanation || '',
        promptHtml: questionPromptText(question, translationLanguage),
        displayAnswer: '',
        isCorrect: null,
        correctAnswer: correctAnswerText(question, translationLanguage),
        translationLanguage,
        selectedOptions: answer.selectedOptions || [],
        fibAnswers: answer.fibAnswers || [],
        trueFalseAnswer: answer.trueFalseAnswer,
        shortAnswer: answer.shortAnswer || ''
    };
    if (question.type === 'mcq') {
        const correctIndexes = (question.options || []).map((opt, i) => opt.correct ? i : -1).filter(i => i >= 0).sort();
        const selected = [...(answer.selectedOptions || [])].sort();
        base.displayAnswer = selected.map(i => `Option ${String.fromCharCode(65 + i)}`).join(', ') || 'Not answered';
        base.isCorrect = correctIndexes.length === selected.length && correctIndexes.every((value, i) => value === selected[i]);
    } else if (question.type === 'true_false') {
        base.displayAnswer = answer.trueFalseAnswer === null ? 'Not answered' : String(answer.trueFalseAnswer);
        base.isCorrect = answer.trueFalseAnswer === question.trueAnswer;
    } else if (question.type === 'fib') {
        base.displayAnswer = (answer.fibAnswers || []).join(', ') || 'Not answered';
        base.isCorrect = (question.fibBanks || []).every((bank, index) => {
            const studentValue = normalizeText(answer.fibAnswers?.[index]);
            return (bank.answers || []).some(correct => normalizeText(correct) === studentValue);
        });
    } else {
        base.displayAnswer = answer.shortAnswer || 'Not answered';
        base.aiReview = assessShortAnswerOffline(question, answer.shortAnswer || '', null, translationLanguage);
        base.isCorrect = base.aiReview.maxMarks > 0 ? base.aiReview.marks >= base.aiReview.maxMarks * 0.9 : null;
    }
    return base;
}

async function gradeAnswerWithOfflineAi(question, answer) {
    const graded = gradeAnswer(question, answer);
    if (question.type !== 'short_answer' || !answer.shortAnswer || !offlineAi.embedPipe) return graded;
    const translationLanguage = sanitizeTranslationLanguage(question, answer.translationLanguage || '');
    const semanticScore = await offlineSemanticScore(correctAnswerText(question, translationLanguage), answer.shortAnswer);
    graded.aiReview = assessShortAnswerOffline(question, answer.shortAnswer || '', semanticScore, translationLanguage);
    graded.isCorrect = graded.aiReview.maxMarks > 0 ? graded.aiReview.marks >= graded.aiReview.maxMarks * 0.9 : null;
    return graded;
}

async function offlineSemanticScore(expectedAnswer, studentAnswer) {
    try {
        const [expectedVector, studentVector] = await Promise.all([
            offlineAi.embedPipe(expectedAnswer, { pooling: 'mean', normalize: true }),
            offlineAi.embedPipe(studentAnswer, { pooling: 'mean', normalize: true })
        ]);
        return cosineSimilarity(Array.from(expectedVector.data), Array.from(studentVector.data));
    } catch (error) {
        console.warn('Offline semantic scoring failed:', error);
        return null;
    }
}

function correctAnswerText(question, language = '') {
    if (question.type === 'mcq') {
        const optionTexts = questionOptionTexts(question, language);
        return (question.options || []).map((opt, i) => opt.correct ? `Option ${String.fromCharCode(65 + i)}: ${stripHtml(optionTexts[i] || opt.html)}` : '').filter(Boolean).join('; ');
    }
    if (question.type === 'true_false') return String(question.trueAnswer);
    if (question.type === 'fib') {
        return (question.fibBanks || []).map(bank => `${bank.label}: ${(bank.answers || []).join(' / ')}`).join('; ');
    }
    return stripHtml(questionShortAnswerText(question, language) || '');
}

function assessShortAnswerOffline(question, studentAnswer, semanticScore = null, language = '') {
    const startedAt = performance.now();
    const expectedAnswer = stripHtml(questionShortAnswerText(question, language) || '');
    const student = String(studentAnswer || '').trim();
    const maxMarks = expectedAnswer.trim() ? 10 : 0;
    if (!maxMarks) {
        return {
            marks: 0,
            maxMarks,
            reason: 'No expected answer is available for offline scoring, so this response needs teacher review.',
            mode: 'offline_ai',
            agents: [],
            final: { score: 0, bandLabel: 'Teacher review', bandClass: 'manual', verdict: 'No expected answer is available for offline scoring.' },
            agentCount: 5,
            assessedMs: Math.round((performance.now() - startedAt) * 10) / 10
        };
    }
    if (!student) {
        return {
            marks: 0,
            maxMarks,
            reason: 'No student answer was submitted.',
            mode: 'offline_ai',
            agents: [],
            final: { score: 0, bandLabel: 'No answer', bandClass: 'wrong', verdict: 'No student answer was submitted.' },
            agentCount: 5,
            assessedMs: Math.round((performance.now() - startedAt) * 10) / 10
        };
    }

    const expectedTerms = unique(contentTerms(expectedAnswer));
    const studentTerms = new Set(contentTerms(student));
    const matchedTerms = expectedTerms.filter(term => studentTerms.has(term));
    const missingTerms = expectedTerms.filter(term => !studentTerms.has(term));
    const termCoverage = expectedTerms.length ? matchedTerms.length / expectedTerms.length : 0;

    const expectedNumbers = unique(extractMathTokens(expectedAnswer));
    const studentNumbers = new Set(extractMathTokens(student));
    const matchedNumbers = expectedNumbers.filter(token => studentNumbers.has(token));
    const numberCoverage = expectedNumbers.length ? matchedNumbers.length / expectedNumbers.length : 1;
    const expectedBigrams = bigrams(expectedTerms);
    const studentBigrams = new Set(bigrams(contentTerms(student)));
    const matchedBigrams = expectedBigrams.filter(phrase => studentBigrams.has(phrase));
    const phraseCoverage = expectedBigrams.length ? matchedBigrams.length / expectedBigrams.length : 0;

    const expectedNormalized = normalizeAssessmentText(expectedAnswer);
    const studentNormalized = normalizeAssessmentText(student);
    const exactBonus = expectedNormalized && expectedNormalized === studentNormalized ? 0.2 : 0;
    const lengthRatio = expectedAnswer.length ? Math.min(student.length / expectedAnswer.length, 1) : 1;
    const lengthScore = Math.min(lengthRatio / 0.7, 1);
    const spellingIssues = spellingAssessmentIssues(student, expectedTerms);
    const grammarIssues = grammarAssessmentIssues(student);
    const spellingScore = Math.max(0, 1 - spellingIssues.length * 0.18);
    const grammarScore = Math.max(0, 1 - grammarIssues.length * 0.11);
    const matcherScore = Math.max(0, Math.min(termCoverage * 0.75 + phraseCoverage * 0.25, 1));
    const semanticValue = semanticScore === null
        ? Math.max(0, Math.min(termCoverage * 0.75 + lengthScore * 0.25 + exactBonus, 1))
        : Math.max(0, Math.min(semanticScore, 1));
    const semanticAlignment = semanticScore === null
        ? Math.max(0, Math.min((termCoverage + phraseCoverage + lengthScore) / 3, 1))
        : semanticValue;
    const mathScore = expectedNumbers.length ? numberCoverage : 1;
    const weighted = {
        matcher: matcherScore * 3.5,
        semantic: semanticValue * 3,
        grammar: grammarScore * 2,
        spelling: spellingScore * 1.5
    };
    const rawPoints = weighted.matcher + weighted.semantic + weighted.grammar + weighted.spelling;
    const mathAdjustedPoints = expectedNumbers.length ? rawPoints * 0.7 + mathScore * 10 * 0.3 : rawPoints;
    const marks = Math.round(Math.max(0, Math.min(mathAdjustedPoints, 10)) * 10) / 10;
    const finalScore = maxMarks ? marks / maxMarks : 0;
    const band = aiReviewBand(marks);
    const closeness = Math.round((matcherScore * 0.6 + semanticValue * 0.4) * 100);

    const reasons = [
        `Matched ${matchedTerms.length}/${expectedTerms.length || 0} key idea${expectedTerms.length === 1 ? '' : 's'}${matchedTerms.length ? ` (${matchedTerms.slice(0, 6).join(', ')})` : ''}.`
    ];
    if (expectedNumbers.length) {
        reasons.push(`Matched ${matchedNumbers.length}/${expectedNumbers.length} important value${expectedNumbers.length === 1 ? '' : 's'}${matchedNumbers.length ? ` (${matchedNumbers.slice(0, 6).join(', ')})` : ''}.`);
    }
    if (semanticScore !== null) {
        reasons.push(`Offline AI semantic similarity: ${Math.round(Math.max(0, Math.min(semanticScore, 1)) * 100)}%.`);
    }
    if (missingTerms.length) {
        reasons.push(`Missing or unclear: ${missingTerms.slice(0, 6).join(', ')}${missingTerms.length > 6 ? '...' : ''}.`);
    }
    if (lengthScore < 0.75) {
        reasons.push('Answer is much shorter than the expected answer.');
    }
    const agents = [
        {
            key: 'matcher',
            name: 'Agent 2 - Expected-answer matcher (Hybrid)',
            score: matcherScore,
            points: weighted.matcher,
            max: 3.5,
            summary: `Covers ${Math.round(termCoverage * 100)}% of expected key terms (${matchedTerms.length}/${expectedTerms.length}).`,
            findings: [
                missingTerms.length ? `Missing key ideas: ${missingTerms.slice(0, 8).join(', ')}${missingTerms.length > 8 ? '...' : ''}` : 'All expected key terms are present.',
                `Phrase-level match: ${Math.round(phraseCoverage * 100)}%.`
            ]
        },
        {
            key: 'semantic',
            name: 'Agent 3 - Semantic meaning (AI)',
            score: semanticValue,
            points: weighted.semantic,
            max: 3,
            summary: semanticSummary(semanticValue),
            findings: [
                `Concept overlap${semanticScore === null ? ' estimate' : ' (cosine)'}: ${Math.round(semanticValue * 100)}%.`,
                `Idea-by-idea alignment: ${Math.round(semanticAlignment * 100)}%.`
            ]
        },
        {
            key: 'grammar',
            name: 'Agent 4 - Sentence formation (AI)',
            score: grammarScore,
            points: weighted.grammar,
            max: 2,
            summary: grammarIssues.length ? `${grammarIssues.length} grammar issue(s) detected by AI.` : 'Sentences are well formed.',
            findings: grammarIssues.length ? grammarIssues.map(issue => issue.message) : ['No grammar or sentence-formation problems detected.']
        },
        {
            key: 'spelling',
            name: 'Agent 1 - Spelling (AI)',
            score: spellingScore,
            points: weighted.spelling,
            max: 1.5,
            summary: `${spellingIssues.length} spelling issue(s) found.`,
            findings: spellingIssues.length ? spellingIssues.map(issue => issue.message) : ['No spelling problems detected.']
        }
    ];

    return {
        marks,
        maxMarks,
        reason: reasons.join(' '),
        mode: 'offline_ai',
        final: {
            score: finalScore,
            bandLabel: band.label,
            bandClass: band.className,
            closeness,
            verdict: `AI-weighted assessment. Closeness to expected answer: ${closeness}%. Content is the strongest area; spelling and sentence formation affect the total.`
        },
        agents,
        spellingIssues,
        grammarIssues,
        matchedTerms: matchedTerms.slice(0, 12),
        missingTerms: missingTerms.slice(0, 12),
        matchedValues: matchedNumbers,
        expectedValues: expectedNumbers,
        agentCount: 5,
        assessedMs: Math.round((performance.now() - startedAt) * 10) / 10
    };
}

function contentTerms(value) {
    const tokens = normalizeAssessmentText(value).match(/[a-z0-9]+/g) || [];
    return tokens
        .map(token => token.replace(/s$/, ''))
        .filter(token => token.length > 2 && !SHORT_ANSWER_STOP_WORDS.has(token));
}

function bigrams(items) {
    const output = [];
    for (let index = 0; index < items.length - 1; index += 1) {
        output.push(`${items[index]} ${items[index + 1]}`);
    }
    return output;
}

function aiReviewBand(points) {
    if (points >= 9) return { label: 'Full credit', className: 'correct' };
    if (points >= 7) return { label: 'Good - minor gaps', className: 'correct' };
    if (points >= 5) return { label: 'Partial credit', className: 'manual' };
    if (points >= 3) return { label: 'Weak - major gaps', className: 'manual' };
    return { label: 'Little / no credit', className: 'wrong' };
}

function semanticSummary(score) {
    if (score >= 0.75) return 'Meaning matches the expected answer closely.';
    if (score >= 0.5) return 'Meaning is partly aligned - the main idea is there but detail is lost.';
    if (score >= 0.25) return 'Only loose semantic overlap with the expected answer.';
    return 'Meaning does not align well with the expected answer.';
}

function spellingAssessmentIssues(student, expectedTerms) {
    const expected = new Set(expectedTerms);
    const corrections = {
        becaus: 'because',
        brigde: 'bridge',
        conect: 'connect',
        supplys: 'supplies',
        villager: 'villagers'
    };
    return findWordTokens(student)
        .map(token => {
            const normalized = normalizeAssessmentText(token.word).replace(/s$/, '');
            const correction = corrections[normalized] || closestExpectedTerm(normalized, expected);
            if (!correction || correction === normalized) return null;
            return {
                start: token.start,
                end: token.end,
                message: `"${token.word}" -> "${correction}"`
            };
        })
        .filter(Boolean)
        .slice(0, 8);
}

function closestExpectedTerm(word, expectedTerms) {
    if (!word || word.length < 4 || expectedTerms.has(word)) return '';
    let best = '';
    let bestDistance = Infinity;
    expectedTerms.forEach(term => {
        if (Math.abs(term.length - word.length) > 2) return;
        const distance = levenshteinDistance(word, term);
        if (distance < bestDistance) {
            best = term;
            bestDistance = distance;
        }
    });
    return bestDistance > 0 && bestDistance <= 2 ? best : '';
}

function grammarAssessmentIssues(student) {
    const issues = [];
    splitSentencesWithOffsets(student).forEach(sentence => {
        const match = /[A-Za-z]/.exec(sentence.text);
        if (match && match[0] === match[0].toLowerCase()) {
            issues.push({
                start: sentence.start + match.index,
                end: sentence.start + match.index + 1,
                message: 'Sentence should start with a capital letter.'
            });
        }
    });
    const trimmedEnd = String(student || '').replace(/\s+$/, '').length;
    if (trimmedEnd > 0 && !/[.!?"')]/.test(student[trimmedEnd - 1])) {
        issues.push({
            start: trimmedEnd - 1,
            end: trimmedEnd,
            message: 'Sentence should end with punctuation.'
        });
    }
    return issues.slice(0, 8);
}

function findWordTokens(text) {
    const tokens = [];
    const regex = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
    let match = regex.exec(String(text || ''));
    while (match) {
        tokens.push({ word: match[0], start: match.index, end: match.index + match[0].length });
        match = regex.exec(String(text || ''));
    }
    return tokens;
}

function splitSentencesWithOffsets(text) {
    const sentences = [];
    const regex = /[^.!?]+[.!?]*/g;
    let match = regex.exec(String(text || ''));
    while (match) {
        if (match[0].trim()) sentences.push({ text: match[0], start: match.index });
        match = regex.exec(String(text || ''));
    }
    return sentences;
}

function levenshteinDistance(a, b) {
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        let last = i - 1;
        previous[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const old = previous[j];
            previous[j] = Math.min(
                previous[j] + 1,
                previous[j - 1] + 1,
                last + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
            last = old;
        }
    }
    return previous[b.length];
}

function extractMathTokens(value) {
    return (String(value || '').toLowerCase().match(/-?\d+(?:\.\d+)?(?:\/-?\d+(?:\.\d+)?)?|[αβ]|alpha|beta|x²|x\^2|[a-z]\^2/g) || [])
        .map(token => token.replace(/\s+/g, ''));
}

function normalizeAssessmentText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[α]/g, 'alpha')
        .replace(/[β]/g, 'beta')
        .replace(/[²]/g, '^2')
        .replace(/[^a-z0-9/\-.^]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function cosineSimilarity(a, b) {
    if (!a?.length || !b?.length || a.length !== b.length) return 0;
    let dot = 0;
    let aMagnitude = 0;
    let bMagnitude = 0;
    for (let index = 0; index < a.length; index += 1) {
        dot += a[index] * b[index];
        aMagnitude += a[index] * a[index];
        bMagnitude += b[index] * b[index];
    }
    return dot / (Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude) || 1);
}

function renderResult(submission) {
    els.resultSummary.textContent = `${submission.correctCount} correct out of ${submission.gradableCount} auto-graded questions. Short answers are stored for teacher review.`;
    els.reviewList.innerHTML = submission.answers.map((answer, index) => `
        <article class="review-card">
            <div class="review-head">
                <strong>Question ${index + 1}</strong>
                ${answer.isCorrect === null ? '<span class="status-chip manual">Manual Review</span>' : answer.isCorrect ? '<span class="status-chip correct">Correct</span>' : '<span class="status-chip wrong">Incorrect</span>'}
            </div>
            <div class="rich-content">${sanitizeRich(answer.promptHtml)}</div>
            <div><strong>Your answer:</strong> ${esc(answer.displayAnswer)}</div>
            <div><strong>Correct answer:</strong> ${esc(answer.correctAnswer || 'Teacher review')}</div>
            ${answer.explanation ? `<div><strong>Explanation:</strong> ${esc(answer.explanation)}</div>` : ''}
        </article>
    `).join('');
    renderRich(els.reviewList);
}

function isAnswered(question, answer) {
    if (question.type === 'mcq') return !!answer.selectedOptions?.length;
    if (question.type === 'true_false') return answer.trueFalseAnswer !== null;
    if (question.type === 'fib') return (answer.fibAnswers || []).some(Boolean);
    return !!answer.shortAnswer;
}

async function renderRich(root) {
    root.querySelectorAll('.math-token').forEach(token => {
        const latex = token.dataset.latex;
        if (latex && window.katex) token.innerHTML = window.katex.renderToString(latex, { throwOnError: false });
    });
    if (!window.mermaid) return;
    for (const token of root.querySelectorAll('.mermaid-token')) {
        const code = token.dataset.code || token.textContent;
        try {
            const { svg } = await window.mermaid.render(`quiz_diag_${Date.now()}_${Math.random().toString(16).slice(2)}`, code);
            token.innerHTML = svg;
        } catch {
            token.innerHTML = '<code>Diagram unavailable</code>';
        }
    }
}

function showOnly(view) {
    els.dashboardView.hidden = view !== 'dashboard';
    els.setupView.hidden = view !== 'setup';
    els.quizView.hidden = view !== 'quiz';
    els.resultView.hidden = view !== 'result';
}

function resetApp() {
    session = null;
    loadedQuestions = [];
    quiz = null;
    currentIndex = 0;
    hasSubmittedCurrentSession = false;
    stopTimer();
    window.speechSynthesis?.cancel();
    loadStudentSessions();
}

function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
        if (quiz && !quiz.submitted) {
            els.timerLabel.textContent = elapsedLabel(Date.now() - quiz.startedAt);
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
}

function setStatus(message) {
    els.statusText.textContent = message;
}


function normalizeText(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeWord(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function shortAnswerWords(value) {
    return stripHtml(value || '')
        .match(/[\p{L}\p{N}'-]+/gu)
        ?.map(word => word.trim())
        .filter(Boolean) || [];
}

function contains(value, needle) {
    return String(value || '').toLowerCase().includes(String(needle || '').toLowerCase());
}

function unique(values) {
    return Array.from(new Set(values));
}

function countValues(values) {
    return values.reduce((counts, value) => {
        counts.set(value, (counts.get(value) || 0) + 1);
        return counts;
    }, new Map());
}

function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function elapsedLabel(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function sanitizeRich(value) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    template.content.querySelectorAll('script, iframe, object, embed').forEach(node => node.remove());
    template.content.querySelectorAll('*').forEach(node => {
        Array.from(node.attributes).forEach(attr => {
            if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
        });
    });
    return template.innerHTML;
}

function stripHtml(value = '') {
    const div = document.createElement('div');
    div.innerHTML = String(value || '');
    return div.textContent || div.innerText || '';
}

function esc(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}
