const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');

function setup({ list = false, ai = false, mode = 'practice' } = {}) {
    const questions = [
        { id: 'first', explanationUrl: 'https://example.com/a' },
        { id: 'second', explanationUrl: 'https://example.com/b' },
        { id: 'third', explanationUrl: 'https://example.com/a' }
    ];
    const ctx = vm.createContext({
        session: { classroom: { mode, ...(list ? { questionBankListId: 'list' } : {}) } },
        loadedQuestions: questions, quiz: null, currentIndex: 0, hasSubmittedCurrentSession: false,
        $: id => id === 'aiSelectionMemoryFilter' ? { checked: ai } : { value: '2', checked: false },
        els: { startQuizBtn: {} },
        selectAdaptiveQuestions: async (items, count) => {
            ctx.aiCalls = (ctx.aiCalls || 0) + 1;
            return [...items].reverse().slice(0, count);
        },
        snapshotQuestion: q => q, emptyAnswer: q => ({ questionId: q.id }),
        shouldShowAudioQuizSettings: () => false,
        shuffle: items => { ctx.shuffleCalls = (ctx.shuffleCalls || 0) + 1; return [...items].reverse(); },
        emptyStudentPerformanceMemory: () => ({}), getQuizFilters: () => ({}),
        startTimer() {}, setExplanationCollapsed() {}, showOnly() {}, setStatus() {}, renderSelectionMemory() {}, renderQuiz() {},
        applyAnswerToPerformanceMemory() { ctx.memoryUpdated = true; },
        reorderRemainingQuestions: async () => { ctx.reordered = true; }
    });
    vm.runInContext(source.slice(source.indexOf('function sessionMode('), source.indexOf('function classroomTaxonomyScope(')), ctx);
    vm.runInContext(source.slice(source.indexOf('async function startQuiz('), source.indexOf('function snapshotQuestion(')), ctx);
    vm.runInContext(source.slice(source.indexOf('async function updateLiveSelectionMemory('), source.indexOf('async function reorderRemainingQuestions(')), ctx);
    return ctx;
}

test('default order preserves list order and interleaved explanation URLs without AI reads or live reordering', async () => {
    for (const list of [false, true]) {
        const ctx = setup({ list });
        await ctx.startQuiz();
        assert.deepEqual(Array.from(ctx.quiz.questions, q => q.id), list ? ['first', 'second', 'third'] : ['first', 'second']);
        assert.equal(ctx.aiCalls, undefined);
        assert.equal(ctx.quiz.useAiSelectionMemory, false);
        await ctx.updateLiveSelectionMemory({ questionId: 'first' });
        assert.equal(ctx.memoryUpdated, undefined);
        assert.equal(ctx.reordered, undefined);
    }
});

test('quiz and test modes shuffle lists and filtered questions even if the AI checkbox is checked', async () => {
    for (const mode of ['quiz', 'wpt', 'rpt', 'test']) {
        for (const list of [false, true]) {
            const ctx = setup({ mode, list, ai: true });
            await ctx.startQuiz();
            assert.equal(ctx.shuffleCalls, 1);
            assert.deepEqual(Array.from(ctx.quiz.questions, q => q.id), list ? ['third', 'second', 'first'] : ['third', 'second']);
            assert.deepEqual(Array.from(ctx.loadedQuestions, q => q.id), ['first', 'second', 'third']);
            assert.equal(ctx.aiCalls, undefined);
            assert.equal(ctx.quiz.useAiSelectionMemory, false);
        }
    }
});

test('opting into AI selects questions adaptively and enables live reordering for lists and filters', async () => {
    for (const list of [false, true]) {
        const ctx = setup({ list, ai: true });
        await ctx.startQuiz();
        assert.deepEqual(Array.from(ctx.quiz.questions, q => q.id), list ? ['third', 'second', 'first'] : ['third', 'second']);
        assert.equal(ctx.aiCalls, 1);
        assert.equal(ctx.quiz.useAiSelectionMemory, true);
        await ctx.updateLiveSelectionMemory({ questionId: 'third' });
        assert.equal(ctx.memoryUpdated, true);
        assert.equal(ctx.reordered, true);
    }
});
