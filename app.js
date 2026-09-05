import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    getFirestore,
    query,
    serverTimestamp,
    setDoc,
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
    classrooms: 'classrooms',
    classSections: 'classSections',
    questionLists: 'qb_lists_v1',
    questions: 'qb_questions_v1',
    submissions: 'qb_quiz_submissions_v1'
};

const TYPE_LABELS = {
    mcq: 'MCQ',
    true_false: 'True/False',
    fib: 'Fill in the Blank',
    short_answer: 'Short Answer'
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let session = null;
let loadedQuestions = [];
let quiz = null;
let currentIndex = 0;
let toastTimer = null;
let timerInterval = null;
let tourOptOutSelected = false;
let urlClassCode = '';
let urlClassroomResult = null;
let shouldShowRecentSubmission = false;

const SESSION_STORAGE_KEY = 'quizActivityVerifiedSession';
const RECENT_LOGIN_STORAGE_PREFIX = 'quizActivityRecentLogin:';
const TOUR_OPT_OUT_KEY = 'quizActivityHideGuidedTour';
const TOUR_STEPS = [
    {
        title: 'Take a Guided Tour?',
        intro: 'A quick walkthrough can show the main steps before you begin.<label class="intro-opt-out"><input type="checkbox" id="tourOptOutInput"> Do not show this tour again on refresh</label>'
    },
    {
        title: 'Student Login',
        intro: 'Enter the class code, admission number, and registered phone to verify the student.',
        element: '#loginView'
    },
    {
        title: 'Verify Student',
        intro: 'After verification, the quiz setup appears. Classroom question lists load automatically when the teacher has selected one.',
        element: '#verifyBtn'
    },
    {
        title: 'Past Submissions',
        intro: 'After verification, a Past Submissions button appears so the student can review previous attempts.'
    }
];

const $ = (id) => document.getElementById(id);
const els = {
    statusText: $('statusText'),
    resetBtn: $('resetBtn'),
    tourBtn: $('tourBtn'),
    viewSubmissionsBtn: $('viewSubmissionsBtn'),
    classCodeField: $('classCodeField'),
    classCodeInput: $('classCodeInput'),
    loginView: $('loginView'),
    setupView: $('setupView'),
    quizView: $('quizView'),
    resultView: $('resultView'),
    loginError: $('loginError'),
    urlClassroomHint: $('urlClassroomHint'),
    phoneHintBox: $('phoneHintBox'),
    welcomeTitle: $('welcomeTitle'),
    classroomLabel: $('classroomLabel'),
    quizFilterControls: $('quizFilterControls'),
    questionLoadSummary: $('questionLoadSummary'),
    startQuizBtn: $('startQuizBtn'),
    questionNav: $('questionNav'),
    progressSummary: $('progressSummary'),
    questionMeta: $('questionMeta'),
    questionTitle: $('questionTitle'),
    questionTypeLabel: $('questionTypeLabel'),
    questionPrompt: $('questionPrompt'),
    answerArea: $('answerArea'),
    resultSummary: $('resultSummary'),
    reviewList: $('reviewList'),
    timerLabel: $('timerLabel'),
    toast: $('toast')
};

if (window.mermaid) {
    window.mermaid.initialize({ startOnLoad: false, theme: 'default' });
}

bindEvents();
initializeClassroomFromUrl();
maybePromptGuidedTour();

function bindEvents() {
    $('verifyBtn').addEventListener('click', verifyStudent);
    $('loadQuestionsBtn').addEventListener('click', loadPublishedQuestions);
    $('startQuizBtn').addEventListener('click', startQuiz);
    $('prevQuestionBtn').addEventListener('click', () => moveQuestion(-1));
    $('nextQuestionBtn').addEventListener('click', () => moveQuestion(1));
    $('submitQuizBtn').addEventListener('click', submitQuiz);
    els.resetBtn.addEventListener('click', resetApp);
    els.tourBtn.addEventListener('click', () => startGuidedTour());
    els.viewSubmissionsBtn.addEventListener('click', () => {
        window.location.href = submissionsUrl();
    });
    document.addEventListener('change', event => {
        if (event.target.id === 'tourOptOutInput') {
            tourOptOutSelected = event.target.checked;
        }
    });
    ['classFilter', 'subjectFilter', 'chapterFilter', 'difficultyFilter', 'questionCountInput'].forEach(id => {
        $(id).addEventListener('input', () => {
            loadedQuestions = [];
            els.startQuizBtn.disabled = true;
            els.questionLoadSummary.textContent = 'Load questions to see availability.';
        });
        $(id).addEventListener('change', () => {
            loadedQuestions = [];
            els.startQuizBtn.disabled = true;
            els.questionLoadSummary.textContent = 'Load questions to see availability.';
        });
    });
}

function maybePromptGuidedTour() {
    if (localStorage.getItem(TOUR_OPT_OUT_KEY) === 'true') return;
    startGuidedTour();
}

function startGuidedTour() {
    if (!window.introJs) return;
    tourOptOutSelected = false;
    const tour = window.introJs.tour ? window.introJs.tour() : window.introJs();
    tour.setOptions({
        steps: TOUR_STEPS,
        showProgress: true,
        showBullets: false,
        nextLabel: 'Next',
        prevLabel: 'Back',
        doneLabel: 'Done',
        exitOnOverlayClick: true,
        tooltipRenderAsHtml: true
    });
    tour.oncomplete(saveTourPreference);
    tour.onexit(saveTourPreference);
    tour.start();
}

function saveTourPreference() {
    if (tourOptOutSelected) localStorage.setItem(TOUR_OPT_OUT_KEY, 'true');
}

async function verifyStudent() {
    showLoginError('');
    const classCode = els.classCodeInput.value.trim();
    const admissionNo = $('admissionNoInput').value.trim();
    const phone = normalizePhone($('phoneInput').value);
    if (!classCode || !admissionNo || !phone) {
        showLoginError('Class code, admission number, and full phone number are required.');
        return;
    }

    try {
        setStatus('Checking classroom...');
        const classroomResult = urlClassroomResult?.classroom?.classCode === classCode || urlClassroomResult?.classroomId === classCode
            ? urlClassroomResult
            : await findClassroom(classCode);
        if (!classroomResult) {
            showLoginError(`No classroom found for class code ${classCode}.`);
            return;
        }
        const { classroomId, classroom } = classroomResult;
        if (classroom.classEnabled !== true) {
            showLoginError('This classroom is not enabled for student quiz login.');
            return;
        }
        if (!classroom.sectionId) {
            showLoginError('Classroom is missing sectionId, so student records cannot be verified.');
            return;
        }

        setStatus('Checking student record...');
        const studentResult = await findStudent(classroom.sectionId, admissionNo);
        if (!studentResult) {
            showLoginError(`No student found for admission number ${admissionNo} in this section.`);
            return;
        }
        const { student } = studentResult;
        const registeredPhone = normalizePhone(student.phone);
        const hint = registeredPhone.slice(-3);
        els.phoneHintBox.hidden = false;
        els.phoneHintBox.textContent = `Registered phone ends with ${hint || '---'}.`;
        if (registeredPhone !== phone) {
            showLoginError(`Phone number did not match the registered phone ending in ${hint || '---'}.`);
            return;
        }

        session = {
            classroomId,
            classroom,
            sectionId: classroom.sectionId,
            admissionNo,
            student,
            studentName: student.name || `Admission ${admissionNo}`,
            studentKey: `${classroom.sectionId}_${admissionNo}`
        };
        els.welcomeTitle.textContent = `Welcome, ${session.studentName}`;
        els.classroomLabel.textContent = `${classroom.className || classroom.classCode || classroomId} · ${classroom.sectionName || classroom.sectionId}`;
        saveVerifiedSession();
        configureSetupForClassroom();
        setStatus(session.classroom.questionBankListId
            ? 'Verified. Loading classroom questions...'
            : 'Verified. Choose quiz filters and load questions.');
        showOnly('setup');
        els.resetBtn.hidden = false;
        els.viewSubmissionsBtn.hidden = false;
        if (shouldShowRecentSubmission) {
            window.location.href = submissionsUrl({ showRecent: true });
            return;
        }
        if (session.classroom.questionBankListId) await loadPublishedQuestions();
    } catch (error) {
        showLoginError(error.message || 'Unable to verify student.');
        setStatus('Verification failed');
    }
}

async function initializeClassroomFromUrl() {
    const params = new URLSearchParams(window.location.search);
    urlClassCode = params.get('classCode')?.trim()
        || params.get('code')?.trim()
        || '';
    shouldShowRecentSubmission = params.get('show-recent') === '1';
    if (!urlClassCode) return;

    els.classCodeInput.value = urlClassCode;
    els.classCodeInput.readOnly = true;
    setStatus('Loading classroom...');
    try {
        const classroomResult = await findClassroom(urlClassCode);
        if (!classroomResult) {
            els.classCodeInput.readOnly = false;
            showLoginError(`No classroom found for class code ${urlClassCode}.`);
            setStatus('Enter your classroom details to begin');
            return;
        }

        urlClassroomResult = classroomResult;
        els.classCodeField.hidden = true;
        els.urlClassroomHint.hidden = false;
        els.urlClassroomHint.textContent = `${classroomTitle(classroomResult)}. Enter admission number and phone to continue.`;
        prefillRecentLoginForUrlClass();
        setStatus('Classroom found. Enter admission number and phone.');
    } catch (error) {
        els.classCodeInput.readOnly = false;
        showLoginError(error.message || 'Unable to load classroom from the URL.');
        setStatus('Classroom lookup failed');
    }
}

function submissionsUrl(options = {}) {
    const params = new URLSearchParams();
    if (options.showRecent) params.set('show-recent', '1');
    return `submissions.html${params.toString() ? `?${params}` : ''}`;
}

function prefillRecentLoginForUrlClass() {
    if (!shouldShowRecentSubmission || !urlClassCode) return;
    const recentLogin = readRecentLogin(urlClassCode);
    if (!recentLogin) return;
    if (recentLogin.admissionNo) $('admissionNoInput').value = recentLogin.admissionNo;
    if (recentLogin.phone) $('phoneInput').value = recentLogin.phone;
}

async function findClassroom(classCode) {
    const directSnap = await getDoc(doc(db, COLLECTIONS.classrooms, classCode));
    if (directSnap.exists()) return { classroomId: directSnap.id, classroom: directSnap.data() };
    const snap = await getDocs(query(collection(db, COLLECTIONS.classrooms), where('classCode', '==', classCode)));
    if (snap.empty) return null;
    const first = snap.docs[0];
    return { classroomId: first.id, classroom: first.data() };
}

async function findStudent(sectionId, admissionNo) {
    const studentsRef = collection(db, COLLECTIONS.classSections, sectionId, 'students');
    const directSnap = await getDoc(doc(studentsRef, admissionNo));
    if (directSnap.exists()) return { studentDocId: directSnap.id, student: directSnap.data() };
    const snap = await getDocs(query(studentsRef, where('admissionNo', '==', admissionNo)));
    if (snap.empty) return null;
    const first = snap.docs[0];
    return { studentDocId: first.id, student: first.data() };
}

function classroomTitle({ classroomId, classroom }) {
    return classroom.className || classroom.classCode || classroomId;
}

function configureSetupForClassroom() {
    const hasClassroomList = !!session?.classroom?.questionBankListId;
    els.quizFilterControls.hidden = hasClassroomList;
    $('loadQuestionsBtn').hidden = hasClassroomList;
    els.startQuizBtn.disabled = true;
    els.questionLoadSummary.textContent = hasClassroomList
        ? 'Loading the teacher-selected classroom question list...'
        : 'Load questions to see availability.';
}

async function loadPublishedQuestions() {
    if (!session) return toast('Verify student first');
    try {
        const listId = session.classroom.questionBankListId;
        if (listId) {
            setStatus('Loading classroom question list...');
            loadedQuestions = await loadQuestionsFromList(listId);
            els.questionLoadSummary.textContent = `${loadedQuestions.length} classroom question${loadedQuestions.length === 1 ? '' : 's'} loaded in teacher-selected order.`;
        } else {
            setStatus('Loading published questions...');
            const snap = await getDocs(query(collection(db, COLLECTIONS.questions), where('status', '==', 'published')));
            const filters = getQuizFilters();
            loadedQuestions = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(q => matchesQuizFilters(q, filters));
            const requested = Number($('questionCountInput').value || 10);
            els.questionLoadSummary.textContent = `${loadedQuestions.length} published question${loadedQuestions.length === 1 ? '' : 's'} match these filters. ${Math.min(requested, loadedQuestions.length)} will be used.`;
        }
        els.startQuizBtn.disabled = !loadedQuestions.length;
        setStatus('Questions loaded. You can start the quiz.');
    } catch (error) {
        els.questionLoadSummary.textContent = error.message || 'Unable to load questions.';
        setStatus('Question load failed');
    }
}

async function loadQuestionsFromList(listId) {
    const listSnap = await getDoc(doc(db, COLLECTIONS.questionLists, listId));
    if (!listSnap.exists()) throw new Error('The classroom question list could not be found.');

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
    return {
        className: $('classFilter').value.trim(),
        subject: $('subjectFilter').value.trim(),
        chapter: $('chapterFilter').value.trim(),
        difficulty: $('difficultyFilter').value.trim()
    };
}

function matchesQuizFilters(question, filters) {
    if (filters.className && !contains(question.className, filters.className)) return false;
    if (filters.subject && !contains(question.subject, filters.subject)) return false;
    if (filters.chapter && !contains(question.chapter, filters.chapter)) return false;
    if (filters.difficulty && question.difficulty !== filters.difficulty) return false;
    return true;
}

function startQuiz() {
    if (!loadedQuestions.length) return toast('Load questions first');
    const hasClassroomList = !!session?.classroom?.questionBankListId;
    const count = hasClassroomList
        ? loadedQuestions.length
        : Math.max(1, Number($('questionCountInput').value || loadedQuestions.length));
    const selectedQuestions = hasClassroomList
        ? loadedQuestions
        : shuffle(loadedQuestions).slice(0, count);
    const selected = selectedQuestions.map(snapshotQuestion);
    quiz = {
        questions: selected,
        answers: selected.map(q => emptyAnswer(q)),
        startedAt: Date.now(),
        submitted: false,
        filters: getQuizFilters()
    };
    currentIndex = 0;
    startTimer();
    showOnly('quiz');
    setStatus('Quiz started. Questions are now local until submit.');
    renderQuiz();
}

function snapshotQuestion(question) {
    return {
        id: question.id,
        type: question.type,
        className: question.className || '',
        subject: question.subject || '',
        chapter: question.chapter || '',
        topic: question.topic || '',
        difficulty: question.difficulty || '',
        promptHtml: question.promptHtml || '',
        options: (question.options || []).map(opt => ({ html: opt.html || '', correct: !!opt.correct })),
        trueAnswer: !!question.trueAnswer,
        fibBanks: (question.fibBanks || []).map(bank => ({ label: bank.label || 'Blank', answers: bank.answers || [] })),
        shortAnswerHtml: question.shortAnswerHtml || ''
    };
}

function emptyAnswer(question) {
    return {
        questionId: question.id,
        type: question.type,
        selectedOptions: [],
        trueFalseAnswer: null,
        fibAnswers: (question.fibBanks || []).map(() => ''),
        shortAnswer: ''
    };
}

function renderQuiz() {
    const question = quiz.questions[currentIndex];
    const answer = quiz.answers[currentIndex];
    els.questionNav.innerHTML = quiz.questions.map((_, i) => {
        const answered = isAnswered(quiz.questions[i], quiz.answers[i]);
        return `<button class="${i === currentIndex ? 'active' : ''} ${answered ? 'answered' : ''}" data-nav="${i}">${i + 1}</button>`;
    }).join('');
    document.querySelectorAll('[data-nav]').forEach(btn => btn.addEventListener('click', () => {
        saveCurrentAnswer();
        currentIndex = Number(btn.dataset.nav);
        renderQuiz();
    }));
    els.progressSummary.textContent = `${quiz.answers.filter((a, i) => isAnswered(quiz.questions[i], a)).length} of ${quiz.questions.length} answered`;
    els.timerLabel.textContent = elapsedLabel(Date.now() - quiz.startedAt);
    els.questionMeta.textContent = `${question.className || 'Class'} · ${question.subject || 'Subject'} · ${question.chapter || 'Chapter'} · ${question.difficulty || 'Difficulty'}`;
    els.questionTitle.textContent = `Question ${currentIndex + 1}`;
    els.questionTypeLabel.textContent = TYPE_LABELS[question.type] || question.type;
    els.questionPrompt.innerHTML = sanitizeRich(question.promptHtml);
    els.answerArea.innerHTML = answerInputHtml(question, answer);
    renderRich(els.questionPrompt);
    renderRich(els.answerArea);
}

function answerInputHtml(question, answer) {
    if (question.type === 'mcq') {
        return (question.options || []).map((option, index) => `
            <label class="option-card">
                <input type="checkbox" class="mcq-answer" value="${index}" ${answer.selectedOptions.includes(index) ? 'checked' : ''}>
                <span><strong>${String.fromCharCode(65 + index)}.</strong> <span class="rich-content">${sanitizeRich(option.html || '')}</span></span>
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
        return (question.fibBanks || []).map((bank, index) => `
            <label class="field text-answer">
                <span>${esc(bank.label || `Blank ${index + 1}`)}</span>
                <input class="fib-input" data-fib="${index}" value="${esc(answer.fibAnswers[index] || '')}" placeholder="Your answer" />
            </label>
        `).join('');
    }
    return `
        <label class="field text-answer">
            <span>Short Answer</span>
            <textarea id="shortAnswerInput" rows="5" placeholder="Type your answer">${esc(answer.shortAnswer || '')}</textarea>
        </label>
    `;
}

function saveCurrentAnswer() {
    if (!quiz) return;
    const question = quiz.questions[currentIndex];
    const answer = quiz.answers[currentIndex];
    if (question.type === 'mcq') {
        answer.selectedOptions = Array.from(document.querySelectorAll('.mcq-answer:checked')).map(input => Number(input.value));
    } else if (question.type === 'true_false') {
        const checked = document.querySelector('input[name="tfAnswer"]:checked');
        answer.trueFalseAnswer = checked ? checked.value === 'true' : null;
    } else if (question.type === 'fib') {
        answer.fibAnswers = Array.from(document.querySelectorAll('.fib-input')).map(input => input.value.trim());
    } else {
        answer.shortAnswer = $('shortAnswerInput')?.value.trim() || '';
    }
}

function moveQuestion(delta) {
    saveCurrentAnswer();
    currentIndex = Math.max(0, Math.min(quiz.questions.length - 1, currentIndex + delta));
    renderQuiz();
}

async function submitQuiz() {
    if (!quiz || quiz.submitted) return;
    saveCurrentAnswer();
    const unanswered = quiz.answers.filter((a, i) => !isAnswered(quiz.questions[i], a)).length;
    if (unanswered && !confirm(`${unanswered} question(s) are unanswered. Submit anyway?`)) return;
    const gradedAnswers = quiz.questions.map((question, index) => gradeAnswer(question, quiz.answers[index]));
    const gradable = gradedAnswers.filter(a => a.isCorrect !== null);
    const correct = gradable.filter(a => a.isCorrect).length;
    const submission = {
        classroomId: session.classroomId,
        sectionId: session.sectionId,
        admissionNo: session.admissionNo,
        studentName: session.studentName,
        studentKey: session.studentKey,
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
            toast('A submission already exists for this admission number in this classroom.');
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
    const submissionRef = doc(db, COLLECTIONS.submissions, submissionDocId());
    const directSnap = await getDoc(submissionRef);
    if (directSnap.exists()) return true;

    const snap = await getDocs(query(
        collection(db, COLLECTIONS.submissions),
        where('studentKey', '==', session.studentKey)
    ));
    return snap.docs.some(existing => existing.data().classroomId === session.classroomId);
}

function submissionDocId() {
    return [
        session.classroomId,
        session.sectionId,
        session.admissionNo
    ].map(value => encodeURIComponent(String(value || 'unknown'))).join('__');
}

function gradeAnswer(question, answer) {
    const base = {
        questionId: question.id,
        type: question.type,
        promptHtml: question.promptHtml,
        displayAnswer: '',
        isCorrect: null,
        correctAnswer: correctAnswerText(question),
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
        base.isCorrect = null;
    }
    return base;
}

function correctAnswerText(question) {
    if (question.type === 'mcq') {
        return (question.options || []).map((opt, i) => opt.correct ? `Option ${String.fromCharCode(65 + i)}: ${stripHtml(opt.html)}` : '').filter(Boolean).join('; ');
    }
    if (question.type === 'true_false') return String(question.trueAnswer);
    if (question.type === 'fib') {
        return (question.fibBanks || []).map(bank => `${bank.label}: ${(bank.answers || []).join(' / ')}`).join('; ');
    }
    return stripHtml(question.shortAnswerHtml || '');
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
    els.loginView.hidden = view !== 'login';
    els.setupView.hidden = view !== 'setup';
    els.quizView.hidden = view !== 'quiz';
    els.resultView.hidden = view !== 'result';
}

function resetApp() {
    session = null;
    loadedQuestions = [];
    quiz = null;
    currentIndex = 0;
    stopTimer();
    els.resetBtn.hidden = true;
    els.viewSubmissionsBtn.hidden = true;
    els.classCodeField.hidden = !!urlClassroomResult;
    els.phoneHintBox.hidden = true;
    els.urlClassroomHint.hidden = !urlClassroomResult;
    if (urlClassroomResult) {
        els.classCodeInput.value = urlClassCode;
        els.classCodeInput.readOnly = true;
        els.urlClassroomHint.textContent = `${classroomTitle(urlClassroomResult)}. Enter admission number and phone to continue.`;
    }
    els.quizFilterControls.hidden = false;
    $('loadQuestionsBtn').hidden = false;
    els.startQuizBtn.disabled = true;
    els.questionLoadSummary.textContent = 'Load questions to see availability.';
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    showLoginError('');
    setStatus('Enter your classroom details to begin');
    showOnly('login');
}

function saveVerifiedSession() {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        classroomId: session.classroomId,
        sectionId: session.sectionId,
        admissionNo: session.admissionNo,
        studentName: session.studentName,
        studentKey: session.studentKey,
        classroomLabel: els.classroomLabel.textContent
    }));
    saveRecentLogin();
}

function saveRecentLogin() {
    const classCode = session.classroom.classCode || session.classroomId;
    if (!classCode) return;
    localStorage.setItem(recentLoginStorageKey(classCode), JSON.stringify({
        admissionNo: session.admissionNo,
        phone: normalizePhone($('phoneInput').value)
    }));
}

function readRecentLogin(classCode) {
    try {
        return JSON.parse(localStorage.getItem(recentLoginStorageKey(classCode)) || 'null');
    } catch {
        return null;
    }
}

function recentLoginStorageKey(classCode) {
    return `${RECENT_LOGIN_STORAGE_PREFIX}${classCode}`;
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

function showLoginError(message) {
    els.loginError.hidden = !message;
    els.loginError.textContent = message;
}

function setStatus(message) {
    els.statusText.textContent = message;
}

function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '');
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function contains(value, needle) {
    return String(value || '').toLowerCase().includes(String(needle || '').toLowerCase());
}

function unique(values) {
    return Array.from(new Set(values));
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
