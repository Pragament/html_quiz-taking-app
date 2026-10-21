const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const navigation = import(pathToFileURL(path.resolve('question-navigation.js')).href);
const source = fs.readFileSync('app.js', 'utf8');

test('question colors distinguish unchecked drafts, checked results and ungraded feedback', async () => {
    const { practiceQuestionState } = await navigation;
    const quiz = { questions: [{}, {}, {}, {}, {}], answers: [{ text: '' }, { text: 'draft' }, {}, {}, {}], feedback: [null, { isCorrect: false }, { isCorrect: true }, { isCorrect: false }, { isCorrect: null }], feedbackShown: [false, false, true, true, true] };
    assert.deepEqual(quiz.questions.map((q, index) => practiceQuestionState(quiz, index, (question, answer) => !!answer.text)), ['unanswered', 'answered', 'correct', 'wrong', 'ungraded']);
});

test('selector filters combine metadata criteria and retain original question indices', async () => {
    const { filteredPracticeQuestionIndices } = await navigation;
    const questions = [
        { difficulty: 'Hard', skill: 'Listening', actfl_level: 'Novice Low', actfl_sublevel: 'Low', actfl_mode: 'Interpretive' },
        { difficulty: 'Easy', skill: 'Reading', actfl_level: 'Novice Low', actfl_sublevel: 'Low', actfl_mode: 'Interpretive' },
        { difficulty: 'Easy', skill: 'Listening', actfl_level: 'Novice Low', actfl_sublevel: 'Low', actfl_mode: 'Interpretive' },
        { difficulty: 'Easy', skill: 'Listening', actfl_level: 'Intermediate Low', actfl_sublevel: 'Low', actfl_mode: 'Presentational' }
    ];
    assert.deepEqual(filteredPracticeQuestionIndices(questions, { difficulty: 'Easy' }), [1, 2, 3]);
    assert.deepEqual(filteredPracticeQuestionIndices(questions, { difficulty: 'Easy', skill: 'Listening', actfl_level: 'Novice Low', actfl_sublevel: 'Low', actfl_mode: 'Interpretive' }), [2]);
    assert.deepEqual(filteredPracticeQuestionIndices(questions, { difficulty: 'Medium' }), []);
    assert.deepEqual(filteredPracticeQuestionIndices(questions, {}), [0, 1, 2, 3]);
    assert.equal(questions.length, 4);
});

test('filter options come from available metadata, deduplicate values and omit missing entries', async () => {
    const { practiceQuestionFilterOptions, filteredPracticeQuestionIndices } = await navigation;
    const questions = [{ skill: 'Listening' }, { skill: ' Listening ' }, { skill: 'Writing' }, {}];
    assert.deepEqual(practiceQuestionFilterOptions(questions, 'skill'), ['Listening', 'Writing']);
    assert.deepEqual(practiceQuestionFilterOptions(questions, 'actfl_level'), []);
    assert.deepEqual(filteredPracticeQuestionIndices(questions, { skill: 'Listening' }), [0, 1]);
    assert.deepEqual(filteredPracticeQuestionIndices(questions), [0, 1, 2, 3]);
});

function setup() {
    const next = { disabled: false };
    const ctx = vm.createContext({
        quiz: { questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }], answers: [{}, {}, {}], submitted: false },
        currentIndex: 1, practiceSavingAction: false,
        $: () => next, shouldShowPracticeQuizSettings: () => true,
        saveCurrentAnswer: () => { ctx.savedIndex = ctx.currentIndex; ctx.quiz.answers[ctx.currentIndex].draft = 'saved'; },
        window: { speechSynthesis: { cancel() {} } },
        renderSelectionMemory() {}, renderQuiz: () => { ctx.renderedIndex = ctx.currentIndex; },
        canSavePracticeProgress: () => true, savePracticeProgress: async () => { ctx.persistedIndex = ctx.currentIndex; }
    });
    vm.runInContext(source.slice(source.indexOf('async function jumpToPracticeQuestion('), source.indexOf('async function advanceQuestion(')), ctx);
    return { ctx, next };
}

test('jump saves the outgoing draft and persists the selected question position in both directions', async () => {
    const { ctx } = setup();
    await ctx.jumpToPracticeQuestion(0);
    assert.equal(ctx.savedIndex, 1);
    assert.equal(ctx.quiz.answers[1].draft, 'saved');
    assert.equal(ctx.currentIndex, 0);
    assert.equal(ctx.persistedIndex, 0);
    await ctx.jumpToPracticeQuestion(2);
    assert.equal(ctx.savedIndex, 0);
    assert.equal(ctx.currentIndex, 2);
    assert.equal(ctx.renderedIndex, 2);
});

test('jump is ignored outside practice, while busy, after submission, or for invalid indices', async () => {
    for (const change of [ctx => { ctx.shouldShowPracticeQuizSettings = () => false; }, ctx => { ctx.practiceSavingAction = true; }, ctx => { ctx.quiz.completing = true; }, ctx => { ctx.quiz.navigationSubmitting = true; }, ctx => { ctx.quiz.submitted = true; }]) {
        const { ctx } = setup(); change(ctx);
        await ctx.jumpToPracticeQuestion(0);
        assert.equal(ctx.currentIndex, 1);
        assert.equal(ctx.savedIndex, undefined);
    }
    const { ctx, next } = setup(); next.disabled = true;
    await ctx.jumpToPracticeQuestion(0);
    assert.equal(ctx.currentIndex, 1);
    next.disabled = false;
    for (const index of [-1, 3, 1.5, NaN, 1]) await ctx.jumpToPracticeQuestion(index);
    assert.equal(ctx.savedIndex, undefined);
});

test('AI ranking leaves later checked questions and unchecked drafts in their numbered slots', async () => {
    const questions = ['current', 'empty1', 'checked', 'draft', 'empty2'].map(id => ({ id }));
    const ctx = vm.createContext({
        currentIndex: 0,
        quiz: { useAiSelectionMemory: true, questions, answers: questions.map(q => ({ questionId: q.id, text: q.id === 'draft' ? 'draft' : '' })), feedback: [null, null, { isCorrect: true }, null, null], feedbackShown: [false, false, true, false, false], promptRevealed: questions.map(() => true), translationChoices: questions.map(() => ''), performanceMemory: {} },
        isAnswered: (q, a) => !!a.text,
        rankQuestionsForStudent: async remaining => { ctx.rankedIds = remaining.map(q => q.id); return [...remaining].reverse().map(question => ({ question })); },
        refreshSelectionMemoryDisplay() {}
    });
    vm.runInContext(source.slice(source.indexOf('async function reorderRemainingQuestions('), source.indexOf('function refreshSelectionMemoryDisplay(')), ctx);
    await ctx.reorderRemainingQuestions();
    assert.deepEqual(Array.from(ctx.rankedIds), ['empty1', 'empty2']);
    assert.deepEqual(Array.from(ctx.quiz.questions, q => q.id), ['current', 'empty2', 'checked', 'draft', 'empty1']);
    assert.equal(ctx.quiz.feedback[2].isCorrect, true);
    assert.equal(ctx.quiz.answers[3].text, 'draft');
});

test('grading failures restore navigation and Next controls', async () => {
    const next = { disabled: false };
    const ctx = vm.createContext({
        quiz: { questions: [{ type: 'mcq' }], answers: [{}], feedback: [], feedbackShown: [] }, currentIndex: 0,
        $: () => next, practiceQuestionNavigation: { render() {} },
        gradeAnswerWithOfflineAi: async () => { throw new Error('Failed to grade'); },
        toast: message => { ctx.error = message; }, nextQuestionButtonLabel: () => 'Check Answer'
    });
    vm.runInContext(source.slice(source.indexOf('async function showInstantFeedback('), source.indexOf('async function submitQuiz(')), ctx);
    await ctx.showInstantFeedback();
    assert.equal(next.disabled, false);
    assert.equal(next.textContent, 'Check Answer');
    assert.equal(ctx.error, 'Failed to grade');
});
