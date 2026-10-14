const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');

function loadFunction(ctx, name, nextName) {
    let start = source.indexOf(`function ${name}(`);
    if (source.slice(start - 6, start) === 'async ') start -= 6;
    const end = source.indexOf(`function ${nextName}(`, start);
    vm.runInContext(source.slice(start, end).replace(/\nasync $/, ''), ctx);
}

test('homepage shows practice setup below sessions and hides it during an attempt', () => {
    const ctx = vm.createContext({
        studentProfile: { studentName: 'Student' }, session: null, quiz: null,
        loadedQuestions: [], currentIndex: 3, hasSubmittedCurrentSession: true,
        stopTimer() {}, configureSetupForClassroom() {},
        els: { welcomeTitle: {}, classroomLabel: {}, dashboardView: {}, setupView: {}, quizView: {}, resultView: {} }
    });
    loadFunction(ctx, 'configureLocalPractice', 'quizSessionStatus');
    loadFunction(ctx, 'showOnly', 'resetApp');
    ctx.configureLocalPractice();
    ctx.showOnly('dashboard');
    assert.equal(ctx.session.localPractice, true);
    assert.equal(ctx.session.classroom.mode, 'practice');
    assert.equal(ctx.hasSubmittedCurrentSession, false);
    assert.equal(ctx.els.dashboardView.hidden, false);
    assert.equal(ctx.els.setupView.hidden, false);
    ctx.showOnly('quiz');
    assert.equal(ctx.els.dashboardView.hidden, true);
    assert.equal(ctx.els.setupView.hidden, true);
    ctx.session = { classroomId: 'teacher-session' };
    ctx.showOnly('dashboard');
    assert.equal(ctx.els.setupView.hidden, true);
});

test('practice completion grades answers without any Firestore calls', async () => {
    const forbidden = () => { throw new Error('Practice must not access submission storage'); };
    const ctx = vm.createContext({
        quiz: { localPractice: true, questions: [{ id: 'q1' }], answers: [{ selectedOptions: ['a'] }], feedback: [] },
        practiceSavingAction: false,
        saveCurrentAnswer() {}, isAnswered: () => true,
        gradeAnswerWithOfflineAi: async () => ({ isCorrect: true }),
        stopTimer() { ctx.stopped = true; },
        renderResult(result) { ctx.result = result; }, showOnly(view) { ctx.view = view; },
        setStatus(status) { ctx.status = status; },
        serverTimestamp: forbidden, hasExistingClassroomSubmission: forbidden, setDoc: forbidden
    });
    loadFunction(ctx, 'submitQuiz', 'hasExistingClassroomSubmission');
    await ctx.submitQuiz();
    assert.equal(ctx.quiz.submitted, true);
    assert.equal(ctx.stopped, true);
    assert.equal(ctx.result.correctCount, 1);
    assert.equal(ctx.view, 'result');
    assert.match(ctx.status, /not saved/);
});

test('final action distinguishes local practice from assigned sessions', () => {
    const ctx = vm.createContext({ quiz: { questions: [{}], feedbackShown: [true] }, currentIndex: 0 });
    loadFunction(ctx, 'nextQuestionButtonLabel', 'answerInputHtml');
    assert.equal(ctx.nextQuestionButtonLabel(), 'Submit Quiz');
    ctx.quiz.localPractice = true;
    assert.equal(ctx.nextQuestionButtonLabel(), 'Finish Practice');
    ctx.quiz.instantFeedback = true;
    ctx.quiz.feedbackShown[0] = false;
    assert.equal(ctx.nextQuestionButtonLabel(), 'Check Answer');
});
