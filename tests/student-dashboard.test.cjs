const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('app.js', 'utf8');
function setup() {
    const nodes = new Map();
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, { hidden: false, disabled: false, textContent: '', innerHTML: '' });
        return nodes.get(id);
    };
    let rows = [];
    let submissionRows = [];
    let selected = null;
    const ctx = vm.createContext({
        console, Date, Number, URLSearchParams,
        $: node, els: { dashboardView: node('dashboard'), resetBtn: node('reset'), welcomeTitle: node('welcome'), classroomLabel: node('label'), questionLoadSummary: node('summary') },
        db: {}, COLLECTIONS: { classrooms: 'classrooms', submissions: 'submissions' },
        collection: (...args) => args, query: (...args) => args, where: (...args) => args, doc: (...args) => args,
        getDocs: async q => ({ docs: q[0][1] === 'submissions' ? submissionRows : rows }), getDoc: async () => selected,
        showOnly: view => { ctx.view = view; }, setStatus: value => { ctx.status = value; },
        toast: value => { ctx.error = value; }, esc: s => String(s).replaceAll('<', '&lt;'),
        stopTimer() {}, configureSetupForClassroom() {}, findExistingClassroomSubmissionId: async () => 'existing&submission',
        hasQuizSessionQuestionList: () => false,
        loadTaxonomyFilters: async () => {}
    });
    vm.runInContext(`let studentProfile = { sectionId: 's1', admissionNo: '001', studentName: 'Student' }; let recentSessions = []; let session = null; let openingSession = false; let loadedQuestions = []; let quiz = null; let currentIndex = 0; let hasSubmittedCurrentSession = false;`, ctx);
    const a = source.indexOf('async function loadStudentSessions()');
    const b = source.indexOf('function submissionsUrl(', a);
    vm.runInContext(source.slice(source.indexOf('function isPracticeDraft('), source.indexOf('function canSavePracticeProgress(')), ctx);
    vm.runInContext(source.slice(a, b), ctx);
    return { ctx, node, rows: values => { rows = values.map(([id, data]) => ({ id, data: () => ({ ...data, dueAt: { toMillis: () => 4102444800000 - (data.createdAt?.toMillis?.() || data.createdDate || 0) } }) })); }, submissions: values => { submissionRows = values.map(([id, data]) => ({ id, data: () => data })); }, selected: data => { selected = { exists: () => !!data, data: () => ({ ...data, dueAt: { toMillis: () => 4102444800000 } }) }; } };
}
test('dashboard lists only enabled unarchived pending sessions by due date, preserving admission number', async () => {
    const h = setup();
    h.rows([
        ['old', { classEnabled: true, createdDate: 1 }],
        ['disabled', { classEnabled: false, createdDate: 100 }],
        ['archived', { classEnabled: true, archived: true, createdDate: 90 }],
        ['new', { classEnabled: true, createdAt: { toMillis: () => 20 } }]
    ]);
    await h.ctx.loadStudentSessions();
    assert.equal(h.ctx.view, 'dashboard');
    assert.deepEqual(Array.from(vm.runInContext('recentSessions.map(s => s.classroomId)', h.ctx)), ['new', 'old']);
    assert.match(h.node('dashboardSection').textContent, /001/);
    assert.equal(h.node('refreshSessionsBtn').disabled, false);
});
test('saved practice stays pending and appears under resume while completed sessions are excluded', async () => {
    const h = setup();
    h.rows([['practice', { classEnabled: true }], ['completed', { classEnabled: true }]]);
    h.submissions([
        ['draft-id', { classroomId: 'practice', practiceProgress: true, status: 'paused', currentIndex: 2, questionCount: 10, quizSessionLabel: 'Reading Practice' }],
        ['completed-id', { classroomId: 'completed' }]
    ]);
    await h.ctx.loadStudentSessions();
    assert.deepEqual(Array.from(vm.runInContext('recentSessions.map(s => s.classroomId)', h.ctx)), ['practice']);
    assert.equal(h.node('savedPracticeSection').hidden, false);
    assert.match(h.node('savedPracticeList').innerHTML, /Question 3 of 10/);
    assert.match(h.node('savedPracticeList').innerHTML, /Resume Practice/);
    assert.match(h.node('savedPracticeList').innerHTML, /Restart from Beginning/);
    assert.doesNotMatch(h.node('savedPracticeList').innerHTML, /completed/);
});
test('cancelling restart keeps the dashboard and saved progress untouched', async () => {
    const h = setup();
    h.ctx.confirm = () => false;
    await h.ctx.openQuizSession('practice', { restart: true });
    assert.equal(vm.runInContext('session', h.ctx), null);
    assert.equal(vm.runInContext('openingSession', h.ctx), false);
    assert.equal(h.ctx.status, undefined);
});
test('dashboard shows an empty state', async () => {
    const h = setup();
    await h.ctx.loadStudentSessions();
    assert.match(h.node('sessionList').innerHTML, /No pending quiz sessions/);
});
test('opening refuses another section, disabled and archived sessions', async () => {
    for (const data of [{ sectionId: 'other', classEnabled: true }, { sectionId: 's1', classEnabled: false }, { sectionId: 's1', classEnabled: true, archived: true }]) {
        const h = setup(); h.selected(data);
        await h.ctx.openQuizSession('quiz');
        assert.match(h.ctx.error, /no longer available/);
        assert.equal(vm.runInContext('session', h.ctx), null);
    }
});
test('previous submission blocks starting a quiz even without a teacher question list', async () => {
    const h = setup(); h.selected({ sectionId: 's1', classEnabled: true });
    await h.ctx.openQuizSession('quiz');
    assert.equal(h.ctx.view, 'setup');
    assert.equal(vm.runInContext('hasSubmittedCurrentSession', h.ctx), true);
    assert.equal(h.node('loadQuestionsBtn').disabled, true);
    assert.match(h.node('summary').innerHTML, /already submitted/);
    assert.match(h.node('summary').innerHTML, /submission.html\?id=existing%26submission/);
});
