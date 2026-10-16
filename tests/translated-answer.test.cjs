const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');

function setup() {
    const question = {
        type: 'short_answer', shortAnswerHtml: 'Water flows',
        shortAnswerWordOptions: ['Water', 'flows'],
        shortAnswerTranslationWordOptions: { Hindi: ['पानी', 'बहता'] },
        translations: { Hindi: { answer: 'पानी बहता' } }
    };
    const answer = { shortAnswerChoiceIndices: [0], shortAnswerMode: 'word_bank', shortAnswer: 'Water' };
    const ctx = vm.createContext({
        quiz: { shortAnswerWordBank: true, showTranslatedShortAnswer: true, questions: [question], answers: [answer], translationChoices: ['Hindi'] },
        currentIndex: 0,
        currentTranslationLanguage: () => ctx.quiz.translationChoices[0],
        questionTranslation: (q, language) => q.translations[language],
        sanitizeTranslationLanguage: (q, language) => language,
        sanitizeRich: value => value, esc: value => value,
        shortAnswerWords: value => value.split(' '), normalizeWord: value => value.toLowerCase(),
        clampShortAnswerInsertIndex: () => 1, renderQuiz() {},
        $: () => ({ value: 'Typed answer' })
    });
    for (const [start, end] of [
        ['function currentShortAnswerWordOptions(', 'function buildFibChoiceOptions('],
        ['function translatedShortAnswerPanel(', 'function speakCurrentQuestion('],
        ['function answerInputHtml(', 'async function advanceQuestion('],
        ['function updateShortAnswerFromChoices(', 'function renderSelectionMemory(']
    ]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), ctx);
    return { ctx, question, answer };
}

test('translated answer stays in the expandable panel while word choices use original answer words', () => {
    const { ctx, question, answer } = setup();
    const html = ctx.answerInputHtml(question, answer);
    assert.match(html, /View translated answer/);
    assert.match(html, /पानी बहता/);
    const bank = html.slice(html.indexOf('class="short-word-bank"'));
    assert.match(bank, />Water<\/button>/);
    assert.match(bank, />flows<\/button>/);
    assert.doesNotMatch(bank, /पानी|बहता/);
    assert.match(html, /short-selected-word correct/);
});

test('changing translation preserves original word selections and grades word-bank answers in the original language', () => {
    const { ctx, question, answer } = setup();
    ctx.setQuestionTranslation('');
    ctx.setQuestionTranslation('Hindi');
    ctx.saveCurrentAnswer();
    assert.deepEqual(answer.shortAnswerChoiceIndices, [0]);
    assert.equal(answer.shortAnswer, 'Water');
    assert.equal(answer.translationLanguage, '');
    assert.deepEqual(ctx.currentShortAnswerWordOptions(question), ['Water', 'flows']);
});

test('typed answers can still use the selected translation language', () => {
    const { ctx, answer } = setup();
    answer.shortAnswerMode = 'typing';
    ctx.saveCurrentAnswer();
    assert.equal(answer.translationLanguage, 'Hindi');
    assert.equal(answer.shortAnswer, 'Typed answer');
});

test('Original offers all translated answers with language labels without changing word choices', () => {
    const { ctx, question, answer } = setup();
    ctx.quiz.translationChoices[0] = '';
    question.translations.French = { answer: 'L’eau coule' };
    const html = ctx.answerInputHtml(question, answer);
    assert.match(html, /View translated answer/);
    assert.match(html, /<strong>Hindi<\/strong>/);
    assert.match(html, /<strong>French<\/strong>/);
    assert.match(html, /पानी बहता/);
    assert.match(html, /L’eau coule/);
    const bank = html.slice(html.indexOf('class="short-word-bank"'));
    assert.match(bank, />Water<\/button>/);
    assert.doesNotMatch(bank, /पानी|L’eau/);
});

test('translation panel also works for Original in typing mode without a word bank', () => {
    const { ctx, question, answer } = setup();
    ctx.quiz.translationChoices[0] = '';
    ctx.quiz.shortAnswerWordBank = false;
    const html = ctx.answerInputHtml(question, answer);
    assert.match(html, /View translated answer/);
    assert.match(html, /पानी बहता/);
    assert.match(html, /<textarea/);
});

test('selected language shows its answer, with available translations as fallback when its answer is missing', () => {
    const { ctx, question } = setup();
    question.translations.French = { question: 'Question en français' };
    ctx.quiz.translationChoices[0] = 'French';
    assert.match(ctx.translatedShortAnswerPanel(question), /पानी बहता/);
    question.translations.French.answer = 'L’eau coule';
    const html = ctx.translatedShortAnswerPanel(question);
    assert.match(html, /L’eau coule/);
    assert.doesNotMatch(html, /पानी बहता/);
});

test('no empty translation control is shown when disabled or no translated answers exist', () => {
    const { ctx, question } = setup();
    ctx.quiz.showTranslatedShortAnswer = false;
    assert.equal(ctx.translatedShortAnswerPanel(question), '');
    ctx.quiz.showTranslatedShortAnswer = true;
    question.translations = { French: { question: 'Question', answer: ' ' } };
    assert.equal(ctx.translatedShortAnswerPanel(question), '');
});
