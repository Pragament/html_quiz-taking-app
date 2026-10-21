const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');

function setup() {
    const records = new Map();
    const cache = new Map();
    const nodes = new Map();
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, { disabled: false, textContent: '' });
        return nodes.get(id);
    };
    const owner = { authUid: 'u1', email: 'student@example.com', studentKey: 's1_001', sectionId: 's1', admissionNo: '001', classroomId: 'practice1', classroom: { mode: 'practice' } };
    const ctx = vm.createContext({
        console, Date, Map, Set, session: owner, studentProfile: owner,
        quiz: {
            localPractice: false, submitted: false, startedAt: Date.now() - 32000,
            questions: [{ id: 'first' }, { id: 'second' }], answers: [{ questionId: 'first', selectedOptions: ['a'] }, { questionId: 'second', fibAnswers: ['answer'] }],
            feedback: [{ isCorrect: true }, null], feedbackShown: [true, false], promptRevealed: [true, false], translationChoices: ['', 'hi'],
            memoryApplied: new Set(['first']), performanceMemory: { weakTypes: new Map([['fib', 2]]) },
            showSpeaker: true, listenRespond: true, useAiSelectionMemory: true
        }, currentIndex: 1, loadedQuestions: [], hasSubmittedCurrentSession: false,
        practiceSaveQueue: Promise.resolve(), practiceSaveTimer: null, practiceSavingAction: false, practiceDrafts: new Map(),
        practiceQuestionNavigation: { render() {} },
        $: node, els: { classroomLabel: { textContent: 'Practice One' } },
        db: {}, COLLECTIONS: { submissions: 'submissions' }, doc: (db, collection, id) => id,
        setDoc: async (id, value) => { if (ctx.failWrite) throw new Error('Offline'); records.set(id, structuredClone(value)); },
        getDoc: async id => ({ exists: () => records.has(id), data: () => structuredClone(records.get(id)) }),
        localStorage: { setItem: (k, v) => cache.set(k, v), getItem: k => cache.get(k), removeItem: k => cache.delete(k) },
        clearTimeout() {}, setTimeout: () => 1,
        shouldShowPracticeQuizSettings: () => ['practice', 'reading_practice', 'writing_practice'].includes(ctx.session?.classroom?.mode),
        saveCurrentAnswer() {}, stopTimer() { ctx.timerStopped = true; }, startTimer() { ctx.timerStarted = true; },
        window: { speechSynthesis: { cancel() {} } },
        toast: message => { ctx.error = message; }, setStatus: message => { ctx.status = message; },
        loadStudentSessions: async () => { ctx.dashboardLoaded = true; },
        setExplanationCollapsed() {}, showOnly: view => { ctx.view = view; }, renderSelectionMemory() {}, renderQuiz() {}
    });
    vm.runInContext(source.slice(source.indexOf('function isPracticeDraft('), source.indexOf('function showOnly(')), ctx);
    vm.runInContext(source.slice(source.indexOf('function emptyAnswer('), source.indexOf('function renderQuiz(')), ctx);
    vm.runInContext(source.slice(source.indexOf('function emptyStudentPerformanceMemory('), source.indexOf('function applyAnswerToPerformanceMemory(')), ctx);
    vm.runInContext(source.slice(source.indexOf('function submissionDocId('), source.indexOf('function gradeAnswer(')), ctx);
    return { ctx, records, cache, owner, node };
}

test('practice pause persists answers, position, settings and AI memory, and resumes after a fresh page', async () => {
    const h = setup();
    await h.ctx.pausePractice();
    assert.equal(h.ctx.quiz, null);
    assert.equal(h.ctx.dashboardLoaded, true);
    const [id, draft] = [...h.records][0];
    assert.equal(draft.status, 'paused');
    assert.equal(draft.currentIndex, 1);
    assert.equal(draft.practiceProgress, true);
    const fresh = setup();
    fresh.records.set(id, draft);
    await fresh.ctx.resumePractice(id);
    assert.equal(fresh.ctx.currentIndex, 1);
    assert.equal(fresh.ctx.quiz.answers[1].fibAnswers[0], 'answer');
    assert.equal(fresh.ctx.quiz.feedbackShown[0], true);
    assert.equal(fresh.ctx.quiz.promptRevealed[1], false);
    assert.equal(fresh.ctx.quiz.translationChoices[1], 'hi');
    assert.equal(fresh.ctx.quiz.listenRespond, true);
    assert.equal(fresh.ctx.quiz.memoryApplied.has('first'), true);
    assert.equal(fresh.ctx.quiz.performanceMemory.weakTypes.get('fib'), 2);
    assert.ok(Math.abs(Date.now() - fresh.ctx.quiz.startedAt - 32000) < 1000);
    assert.equal(fresh.ctx.view, 'quiz');
    assert.equal(fresh.records.get(id).status, 'in_progress');
});

test('different practice sessions save into separate submission documents', async () => {
    const h = setup();
    await h.ctx.savePracticeProgress();
    h.ctx.session = { ...h.owner, classroomId: 'practice2' };
    await h.ctx.savePracticeProgress();
    assert.equal(h.records.size, 2);
    assert.deepEqual([...h.records.values()].map(item => item.classroomId), ['practice1', 'practice2']);
});

test('starting again from Step 2 replaces saved progress with fresh answers and selected settings', async () => {
    const h = setup();
    await h.ctx.savePracticeProgress();
    const id = h.ctx.submissionDocId();
    const other = { untouched: true };
    h.records.set('another-session', other);
    h.ctx.loadedQuestions = h.ctx.quiz.questions;
    h.ctx.session.restartPractice = true;
    h.node('questionCountInput').value = '2';
    h.node('listenRespondFilter').checked = true;
    Object.assign(h.ctx, {
        snapshotQuestion: question => question,
        shouldShowAudioQuizSettings: () => true,
        getQuizFilters: () => ({})
    });
    vm.runInContext(source.slice(source.indexOf('async function startQuiz('), source.indexOf('function snapshotQuestion(')), h.ctx);
    await h.ctx.startQuiz();
    assert.equal(h.ctx.currentIndex, 0);
    assert.deepEqual(Array.from(h.ctx.quiz.questions, q => q.id), ['first', 'second']);
    assert.deepEqual(Array.from(h.ctx.quiz.answers, a => a.selectedOptions.length), [0, 0]);
    assert.deepEqual(Array.from(h.ctx.quiz.feedback), [null, null]);
    assert.deepEqual(Array.from(h.ctx.quiz.feedbackShown), [false, false]);
    assert.deepEqual(Array.from(h.ctx.quiz.promptRevealed), [false, false]);
    assert.deepEqual(Array.from(h.ctx.quiz.translationChoices), ['', '']);
    assert.equal(h.ctx.quiz.memoryApplied.size, 0);
    assert.equal(h.ctx.quiz.performanceMemory.answers.length, 0);
    assert.equal(h.ctx.quiz.selectionMemory, null);
    assert.equal(h.ctx.quiz.listenRespond, true);
    assert.ok(Date.now() - h.ctx.quiz.startedAt < 1000);
    assert.equal(h.records.get(id).currentIndex, 0);
    assert.equal(h.records.get('another-session'), other);
    h.ctx.quiz = null;
    await h.ctx.resumePractice(id);
    assert.equal(h.ctx.currentIndex, 0);
    assert.equal(h.ctx.quiz.answers[1].selectedOptions.length, 0);
});

test('autosave is limited to assigned practice, excluding homepage practice and quiz/test modes', async () => {
    const h = setup();
    for (const mode of ['quiz', 'wpt', 'rpt']) {
        h.ctx.session.classroom.mode = mode;
        await h.ctx.savePracticeProgress();
    }
    h.ctx.session.classroom.mode = 'practice';
    h.ctx.quiz.localPractice = true;
    await h.ctx.savePracticeProgress();
    assert.equal(h.records.size, 0);
});

test('failed pause retains the current attempt and browser backup for retry', async () => {
    const h = setup();
    h.ctx.failWrite = true;
    await h.ctx.pausePractice();
    assert.equal(h.ctx.quiz.answers[1].fibAnswers[0], 'answer');
    assert.equal(h.ctx.dashboardLoaded, undefined);
    assert.equal(h.ctx.timerStarted, true);
    assert.equal(h.node('pausePracticeBtn').disabled, false);
    assert.equal(h.cache.size, 1);
    h.ctx.failWrite = false;
    await h.ctx.savePracticeProgress();
    assert.equal(h.records.size, 1);
});

test('a newer browser backup recovers edits before the autosave debounce after refresh', async () => {
    const h = setup();
    await h.ctx.savePracticeProgress();
    const id = h.ctx.submissionDocId();
    h.ctx.quiz.answers[1].fibAnswers = ['latest answer'];
    const draft = h.ctx.practiceDraftData();
    draft.updatedAtMillis = h.records.get(id).updatedAtMillis + 1;
    h.ctx.cachePracticeDraft(draft);
    await h.ctx.resumePractice(id);
    assert.equal(h.ctx.quiz.answers[1].fibAnswers[0], 'latest answer');
});

test('resume rejects another student, a different session and completed submissions', async () => {
    for (const edit of [{ authUid: 'other' }, { classroomId: 'other' }, { status: 'submitted' }]) {
        const h = setup();
        await h.ctx.savePracticeProgress();
        const [id, draft] = [...h.records][0];
        h.records.set(id, { ...draft, ...edit });
        await assert.rejects(() => h.ctx.resumePractice(id), /unavailable/);
    }
});

test('finishing assigned practice replaces its draft with a completed submission without duplicate blocking', async () => {
    const h = setup();
    await h.ctx.savePracticeProgress();
    const id = h.ctx.submissionDocId();
    Object.assign(h.ctx, {
        isAnswered: () => true, confirm: () => true,
        gradeAnswerWithOfflineAi: async () => ({ isCorrect: true }),
        unique: items => [...new Set(items)], serverTimestamp: () => 'server-time',
        collection: () => ({}), query: () => ({}), where: () => ({}),
        getDocs: async () => ({ docs: [...h.records].map(([key, value]) => ({ id: key, data: () => value })) }),
        renderResult: result => { h.ctx.result = result; }
    });
    h.ctx.quiz.filters = {};
    vm.runInContext(source.slice(source.indexOf('async function submitQuiz('), source.indexOf('function hasQuizSessionQuestionList(')), h.ctx);
    await h.ctx.submitQuiz();
    assert.equal(h.ctx.quiz.submitted, true);
    assert.equal(h.ctx.view, 'result');
    assert.equal(h.records.get(id).practiceProgress, undefined);
    assert.equal(h.records.get(id).submittedAt, 'server-time');
    assert.equal(h.records.get(id).correctCount, 2);
    assert.equal(h.cache.size, 0);
    await h.ctx.savePracticeProgress();
    assert.equal(h.records.get(id).submittedAt, 'server-time');
});
