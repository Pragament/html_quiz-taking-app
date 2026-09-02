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

loadSubmissionHistory();

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
    els.historyList.innerHTML = submissions.length ? submissions.map(sub => `
        <article class="history-card">
            <div class="history-head">
                <strong>${new Date(sub.submittedAtMillis || Date.now()).toLocaleString()}</strong>
                <span class="step-chip">${sub.correctCount}/${sub.gradableCount}</span>
            </div>
            <div class="score-line">
                <span>${sub.questionCount} questions</span>
                <span>${sub.answeredCount} answered</span>
                <span>${esc(sub.subject || 'Any subject')}</span>
                <span>${esc((sub.chapters || []).join(', ') || 'Any chapter')}</span>
            </div>
        </article>
    `).join('') : '<div class="quiz-summary">No previous submissions for this student.</div>';
}

function esc(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
