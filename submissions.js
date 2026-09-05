import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
    collection,
    getDocs,
    getFirestore,
    query,
    where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
    apiKey: 'AIzaSyAYlezFn0tSSQHA-vRnJeBfJ-Om1YlDghk',
    authDomain: 'eschool-dev-4c6b4.firebaseapp.com',
    projectId: 'eschool-dev-4c6b4',
    storageBucket: 'eschool-dev-4c6b4.firebasestorage.app',
    messagingSenderId: '875648503944',
    appId: '1:875648503944:web:5df5e950b6215a446f0f3d',
    measurementId: 'G-E2JHVL7Q4V'
};

const COLLECTIONS = {
    submissions: 'qb_quiz_submissions_v1'
};

const SESSION_STORAGE_KEY = 'quizActivityVerifiedSession';
const SHOW_RECENT_PARAM = 'show-recent';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const els = {
    statusText: $('historyStatusText'),
    studentName: $('historyStudentName'),
    classroomLabel: $('historyClassroomLabel'),
    historyList: $('historyList'),
    toast: $('toast')
};

if (window.mermaid) {
    window.mermaid.initialize({ startOnLoad: false, theme: 'default' });
}

loadSubmissionHistory();

els.historyList.addEventListener('click', event => {
    const tab = event.target.closest('[data-review-filter]');
    if (!tab) return;
    event.preventDefault();
    const review = tab.closest('.submission-review');
    if (!review) return;
    setReviewFilter(review, tab.dataset.reviewFilter);
});

async function loadSubmissionHistory() {
    const verifiedSession = readVerifiedSession();
    if (!verifiedSession?.studentKey) {
        els.statusText.textContent = 'Verify a student before viewing past submissions.';
        els.studentName.textContent = 'No verified student';
        els.classroomLabel.textContent = 'Return to the quiz page and verify student details first.';
        els.historyList.innerHTML = '<div class="quiz-summary">No verified student session found.</div>';
        return;
    }

    els.studentName.textContent = verifiedSession.studentName || 'Student';
    els.classroomLabel.textContent = verifiedSession.classroomLabel || verifiedSession.studentKey;

    try {
        const snap = await getDocs(query(
            collection(db, COLLECTIONS.submissions),
            where('studentKey', '==', verifiedSession.studentKey)
        ));
        const submissions = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.submittedAtMillis || 0) - (a.submittedAtMillis || 0));
        renderHistory(submissions);
        els.statusText.textContent = `${submissions.length} submission${submissions.length === 1 ? '' : 's'} found.`;
    } catch (error) {
        els.statusText.textContent = 'Submission history could not be loaded.';
        els.historyList.innerHTML = `<div class="error-box">${esc(error.message || 'Unable to load submissions.')}</div>`;
    }
}

function readVerifiedSession() {
    try {
        return JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || 'null');
    } catch {
        return null;
    }
}

function renderHistory(submissions) {
    const showRecent = new URLSearchParams(window.location.search).get(SHOW_RECENT_PARAM) === '1';
    els.historyList.innerHTML = submissions.length ? submissions.map((sub, index) => `
        <details class="history-card" ${showRecent && index === 0 ? 'open' : ''}>
            <summary class="history-summary">
                <span class="history-summary-main">
                    <strong>${new Date(sub.submittedAtMillis || Date.now()).toLocaleString()}</strong>
                    <span class="score-line">
                        <span>${sub.questionCount} questions</span>
                        <span>${sub.answeredCount} answered</span>
                        <span>${sub.correctCount}/${sub.gradableCount} auto-graded</span>
                        <span>${esc(sub.subject || 'Any subject')}</span>
                        <span>${esc((sub.chapters || []).join(', ') || 'Any chapter')}</span>
                    </span>
                </span>
                <span class="step-chip">${sub.correctCount}/${sub.gradableCount}</span>
            </summary>
            <div class="submission-review">
                ${renderSubmissionDetails(sub)}
                ${renderReviewTabs(sub.answers || [])}
                ${renderSubmissionAnswers(sub.answers || [])}
            </div>
        </details>
    `).join('') : '<div class="quiz-summary">No previous submissions for this student.</div>';
    renderRich(els.historyList);
    if (showRecent && submissions.length) {
        els.statusText.textContent = 'Showing most recent submission.';
        els.historyList.querySelector('.history-card')?.scrollIntoView({ block: 'start' });
    }
}

function renderReviewTabs(answers) {
    const counts = {
        all: answers.length,
        correct: answers.filter(answer => answer.isCorrect === true).length,
        incorrect: answers.filter(answer => answer.isCorrect === false).length,
        manual: answers.filter(answer => answer.isCorrect === null).length
    };
    return `
        <div class="review-tabs" role="tablist" aria-label="Filter question review">
            <button class="review-tab active" type="button" data-review-filter="all">All (${counts.all})</button>
            <button class="review-tab" type="button" data-review-filter="correct">Correct (${counts.correct})</button>
            <button class="review-tab" type="button" data-review-filter="incorrect">Incorrect (${counts.incorrect})</button>
            <button class="review-tab" type="button" data-review-filter="manual">Manual (${counts.manual})</button>
        </div>
    `;
}

function renderSubmissionDetails(submission) {
    return `
        <div class="submission-details">
            <span><strong>Questions:</strong> ${esc(submission.questionCount || 0)}</span>
            <span><strong>Answered:</strong> ${esc(submission.answeredCount || 0)}</span>
            <span><strong>Score:</strong> ${esc(submission.correctCount || 0)}/${esc(submission.gradableCount || 0)}</span>
            <span><strong>Subject:</strong> ${esc(submission.subject || 'Any subject')}</span>
            <span><strong>Chapters:</strong> ${esc((submission.chapters || []).join(', ') || 'Any chapter')}</span>
        </div>
    `;
}

function renderSubmissionAnswers(answers) {
    if (!answers.length) return '<div class="quiz-summary">No question details were stored for this submission.</div>';
    return answers.map((answer, index) => `
        <article class="review-card" data-review-result="${answerResult(answer)}">
            <div class="review-head">
                <strong>Question ${index + 1}</strong>
                ${answerStatusHtml(answer)}
            </div>
            <div class="rich-content">${sanitizeRich(answer.promptHtml)}</div>
            <div><strong>Your answer:</strong> ${esc(answer.displayAnswer || 'Not answered')}</div>
            <div><strong>Correct answer:</strong> ${esc(answer.correctAnswer || 'Teacher review')}</div>
            ${renderAiReview(answer.aiReview)}
        </article>
    `).join('');
}

function renderAiReview(aiReview) {
    if (!aiReview) return '';
    const marks = aiReview.marks ?? null;
    const maxMarks = aiReview.maxMarks ?? null;
    const score = marks !== null && maxMarks !== null
        ? `${marks}/${maxMarks}`
        : marks !== null
            ? String(marks)
            : '';
    return `
        <div class="ai-review-box">
            <div class="review-head">
                <strong>Review</strong>
                ${score ? `<span class="step-chip">${esc(score)} marks</span>` : ''}
            </div>
            ${aiReview.reason ? `<div>${esc(aiReview.reason)}</div>` : ''}
        </div>
    `;
}

function setReviewFilter(review, filter) {
    review.querySelectorAll('[data-review-filter]').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.reviewFilter === filter);
    });
    review.querySelectorAll('[data-review-result]').forEach(card => {
        card.hidden = filter !== 'all' && card.dataset.reviewResult !== filter;
    });
}

function answerResult(answer) {
    if (answer.isCorrect === null) return 'manual';
    return answer.isCorrect ? 'correct' : 'incorrect';
}

function answerStatusHtml(answer) {
    if (answer.isCorrect === null) return '<span class="status-chip manual">Manual Review</span>';
    return answer.isCorrect
        ? '<span class="status-chip correct">Correct</span>'
        : '<span class="status-chip wrong">Incorrect</span>';
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
            const { svg } = await window.mermaid.render(`history_diag_${Date.now()}_${Math.random().toString(16).slice(2)}`, code);
            token.innerHTML = svg;
        } catch {
            token.innerHTML = '<code>Diagram unavailable</code>';
        }
    }
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

function esc(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
