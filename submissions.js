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

const TYPE_LABELS = {
    mcq: 'MCQ',
    true_false: 'True/False',
    fib: 'Fill in the Blank',
    short_answer: 'Short Answer'
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
    studentReport: $('studentReport'),
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
    els.studentReport.innerHTML = renderStudentReport(submissions);
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
    renderRich(els.studentReport);
    renderRich(els.historyList);
    if (showRecent && submissions.length) {
        els.statusText.textContent = 'Showing most recent submission.';
        els.historyList.querySelector('.history-card')?.scrollIntoView({ block: 'start' });
    }
}

function renderStudentReport(submissions) {
    if (!submissions.length) return '';
    const metrics = reportMetrics(submissions);
    const chapterRows = aggregateAnswers(metrics.answerRows, row => answerChapter(row));
    const difficultyRows = aggregateAnswers(metrics.answerRows, row => row.answer.difficulty || row.sub.difficulty || 'Unspecified');
    const typeRows = aggregateAnswers(metrics.answerRows, row => TYPE_LABELS[row.answer.type] || row.answer.type || 'Unknown');
    const weakChapters = chapterRows
        .filter(row => row.gradable && row.accuracy < 80)
        .sort((a, b) => a.accuracy - b.accuracy)
        .slice(0, 4);
    const mistakes = metrics.answerRows
        .filter(row => row.answer.isCorrect !== true)
        .slice(0, 8);

    return `
        <div class="report-stack">
            <section class="report-section">
                <div class="report-card-grid">
                    ${reportMetricCard('Attempts', metrics.totalSubmissions)}
                    ${reportMetricCard('Average', percentText(metrics.averageScore))}
                    ${reportMetricCard('Latest', percentText(metrics.latestScore))}
                    ${reportMetricCard('Trend', trendLabel(metrics.trend))}
                    ${reportMetricCard('Best', percentText(metrics.bestScore))}
                    ${reportMetricCard('Answered', `${metrics.totalAnswered}/${metrics.totalQuestions}`)}
                </div>
            </section>
            <section class="report-section">
                <div class="section-title compact-title">
                    <h2>Progress Over Time</h2>
                    <span class="step-chip">${esc(metrics.trendSummary)}</span>
                </div>
                ${renderTrendChart(metrics.timeline)}
            </section>
            <section class="report-section report-two-column">
                <div>
                    <div class="section-title compact-title">
                        <h2>Chapter Breakdown</h2>
                        <span class="step-chip">Revision Signal</span>
                    </div>
                    ${renderBreakdownTable(chapterRows, 'Chapter')}
                </div>
                <div>
                    <div class="section-title compact-title">
                        <h2>Difficulty</h2>
                        <span class="step-chip">Accuracy</span>
                    </div>
                    ${renderBreakdownTable(difficultyRows, 'Difficulty')}
                </div>
            </section>
            <section class="report-section report-two-column">
                <div>
                    <div class="section-title compact-title">
                        <h2>Question Types</h2>
                        <span class="step-chip">Format</span>
                    </div>
                    ${renderBreakdownTable(typeRows, 'Type')}
                </div>
                <div>
                    <div class="section-title compact-title">
                        <h2>Revision Plan</h2>
                        <span class="step-chip">Next Steps</span>
                    </div>
                    ${renderRevisionPlan(weakChapters, difficultyRows, typeRows)}
                </div>
            </section>
            <section class="report-section">
                <div class="section-title compact-title">
                    <h2>Mistake Review</h2>
                    <span class="step-chip">${mistakes.length} focus item${mistakes.length === 1 ? '' : 's'}</span>
                </div>
                ${renderMistakeList(mistakes)}
            </section>
            <div class="section-title compact-title history-title">
                <h2>Submission History</h2>
                <span class="step-chip">Details</span>
            </div>
        </div>
    `;
}

function reportMetrics(submissions) {
    const timeline = [...submissions]
        .sort((a, b) => (a.submittedAtMillis || 0) - (b.submittedAtMillis || 0))
        .map((sub, index) => ({
            label: `Quiz ${index + 1}`,
            date: sub.submittedAtMillis ? new Date(sub.submittedAtMillis).toLocaleDateString() : `Quiz ${index + 1}`,
            score: scorePercent(sub)
        }));
    const scores = timeline.map(point => point.score).filter(score => score !== null);
    const latestScore = scorePercent(submissions[0]);
    const previousScore = submissions[1] ? scorePercent(submissions[1]) : null;
    const trend = latestScore !== null && previousScore !== null ? latestScore - previousScore : null;
    const answerRows = submissions.flatMap(sub => (sub.answers || []).map((answer, index) => ({ sub, answer, index })));
    return {
        totalSubmissions: submissions.length,
        totalQuestions: submissions.reduce((sum, sub) => sum + Number(sub.questionCount || 0), 0),
        totalAnswered: submissions.reduce((sum, sub) => sum + Number(sub.answeredCount || 0), 0),
        averageScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
        latestScore,
        bestScore: scores.length ? Math.max(...scores) : null,
        trend,
        trendSummary: trendSummary(trend),
        timeline,
        answerRows
    };
}

function scorePercent(submission) {
    const gradable = Number(submission.gradableCount || 0);
    if (!gradable) return null;
    return (Number(submission.correctCount || 0) / gradable) * 100;
}

function reportMetricCard(label, value) {
    return `
        <div class="report-metric-card">
            <span>${esc(label)}</span>
            <strong>${esc(value)}</strong>
        </div>
    `;
}

function renderTrendChart(timeline) {
    const scored = timeline.filter(point => point.score !== null);
    if (!scored.length) return '<div class="quiz-summary">No auto-graded scores available yet.</div>';
    const width = 640;
    const height = 180;
    const pad = 24;
    const points = scored.map((point, index) => {
        const x = scored.length === 1 ? width / 2 : pad + (index * (width - pad * 2)) / (scored.length - 1);
        const y = height - pad - (point.score * (height - pad * 2)) / 100;
        return { ...point, x, y };
    });
    return `
        <div class="trend-chart" aria-label="Score trend chart">
            <svg viewBox="0 0 ${width} ${height}" role="img">
                <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="chart-axis"></line>
                <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="chart-axis"></line>
                <polyline class="chart-line" points="${points.map(point => `${point.x},${point.y}`).join(' ')}"></polyline>
                ${points.map(point => `
                    <g>
                        <circle cx="${point.x}" cy="${point.y}" r="5" class="chart-point"></circle>
                        <text x="${point.x}" y="${Math.max(14, point.y - 10)}" text-anchor="middle">${Math.round(point.score)}%</text>
                        <text x="${point.x}" y="${height - 5}" text-anchor="middle">${esc(point.date)}</text>
                    </g>
                `).join('')}
            </svg>
        </div>
    `;
}

function aggregateAnswers(answerRows, labelForRow) {
    const map = new Map();
    answerRows.forEach(row => {
        const label = labelForRow(row) || 'Unspecified';
        if (!map.has(label)) map.set(label, { label, attempted: 0, correct: 0, gradable: 0, manual: 0 });
        const item = map.get(label);
        item.attempted += 1;
        if (isManualAnswer(row.answer)) item.manual += 1;
        if (!isManualAnswer(row.answer)) item.gradable += 1;
        if (row.answer.isCorrect === true) item.correct += 1;
    });
    return Array.from(map.values())
        .map(item => ({
            ...item,
            accuracy: item.gradable ? (item.correct / item.gradable) * 100 : null
        }))
        .sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101) || b.attempted - a.attempted);
}

function answerChapter(row) {
    if (row.answer.chapter) return row.answer.chapter;
    if (Array.isArray(row.sub.chapters) && row.sub.chapters.length === 1) return row.sub.chapters[0];
    if (row.sub.chapter) return row.sub.chapter;
    return 'Mixed chapters';
}

function renderBreakdownTable(rows, label) {
    if (!rows.length) return '<div class="quiz-summary">No data available yet.</div>';
    return `
        <div class="report-table-wrap">
            <table class="report-table">
                <thead>
                    <tr>
                        <th>${esc(label)}</th>
                        <th>Attempted</th>
                        <th>Correct</th>
                        <th>Accuracy</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(row => `
                        <tr>
                            <td>${esc(row.label)}</td>
                            <td>${row.attempted}</td>
                            <td>${row.correct}/${row.gradable}</td>
                            <td>${percentText(row.accuracy)}</td>
                            <td>${performanceChip(row.accuracy)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderRevisionPlan(chapterRows, difficultyRows, typeRows) {
    const items = [];
    chapterRows.forEach(row => {
        items.push(`Revise ${row.label}: ${percentText(row.accuracy)} accuracy across ${row.attempted} question${row.attempted === 1 ? '' : 's'}.`);
    });
    const weakestDifficulty = difficultyRows.find(row => row.gradable && row.accuracy < 70);
    if (weakestDifficulty) items.push(`Practice ${weakestDifficulty.label} questions until accuracy reaches 70%.`);
    const weakestType = typeRows.find(row => row.gradable && row.accuracy < 70);
    if (weakestType) items.push(`Do a focused set of ${weakestType.label} questions to improve format confidence.`);
    if (!items.length) items.push('Keep revising mixed practice sets and reattempt any manual-review answers after teacher feedback.');
    return `
        <ol class="revision-list">
            ${items.slice(0, 5).map(item => `<li>${esc(item)}</li>`).join('')}
        </ol>
    `;
}

function renderMistakeList(mistakes) {
    if (!mistakes.length) return '<div class="quiz-summary">No incorrect or manual-review answers found.</div>';
    return `
        <div class="mistake-list">
            ${mistakes.map(row => `
                <article class="mistake-card">
                    <div class="review-head">
                        <strong>${esc(answerChapter(row))}</strong>
                        ${answerStatusHtml(row.answer)}
                    </div>
                    <div class="rich-content">${sanitizeRich(row.answer.promptHtml)}</div>
                    <div><strong>Your answer:</strong> ${esc(row.answer.displayAnswer || 'Not answered')}</div>
                    <div><strong>Correct answer:</strong> ${esc(row.answer.correctAnswer || 'Teacher review')}</div>
                    ${renderAiReview(row.answer.aiReview)}
                </article>
            `).join('')}
        </div>
    `;
}

function performanceChip(accuracy) {
    if (accuracy === null) return '<span class="status-chip manual">Manual</span>';
    if (accuracy >= 80) return '<span class="status-chip correct">Strong</span>';
    if (accuracy >= 60) return '<span class="status-chip manual">Practice</span>';
    return '<span class="status-chip wrong">Revise</span>';
}

function percentText(value) {
    return value === null || Number.isNaN(value) ? 'N/A' : `${Math.round(value)}%`;
}

function trendLabel(trend) {
    if (trend === null) return 'N/A';
    if (trend >= 3) return `+${Math.round(trend)}%`;
    if (trend <= -3) return `${Math.round(trend)}%`;
    return 'Steady';
}

function trendSummary(trend) {
    if (trend === null) return 'Need 2 quizzes';
    if (trend >= 3) return 'Improving';
    if (trend <= -3) return 'Needs attention';
    return 'Steady';
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
    if (isManualAnswer(answer)) return 'manual';
    return answer.isCorrect ? 'correct' : 'incorrect';
}

function answerStatusHtml(answer) {
    if (isManualAnswer(answer)) return '<span class="status-chip manual">Manual Review</span>';
    return answer.isCorrect
        ? '<span class="status-chip correct">Correct</span>'
        : '<span class="status-chip wrong">Incorrect</span>';
}

function isManualAnswer(answer) {
    return answer.isCorrect !== true && answer.isCorrect !== false;
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
