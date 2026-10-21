const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const mistakes = import(pathToFileURL(path.resolve('practice-mistakes.js')).href);

test('review includes only checked incorrect FIB and short answers with nonempty student responses', async () => {
    const { collectPracticeMistakes } = await mistakes;
    const questions = ['fib', 'short_answer', 'fib', 'short_answer', 'fib', 'short_answer', 'mcq', 'short_answer', 'short_answer'].map((type, index) => ({ type, id: `q${index}` }));
    const quiz = {
        questions,
        answers: [{ fibAnswers: ['wrong'] }, { shortAnswer: 'My response' }, { fibAnswers: [' ', ''] }, { shortAnswer: '\n ' }, { fibAnswers: ['skipped draft'] }, { shortAnswer: 'correct' }, { selectedOptions: [0] }, { shortAnswer: 'ungraded' }, { shortAnswer: 'skipped' }],
        feedback: [{ isCorrect: false }, { isCorrect: false }, { isCorrect: false }, { isCorrect: false }, { isCorrect: false }, { isCorrect: true }, { isCorrect: false }, { isCorrect: null }, null],
        feedbackShown: [true, true, true, true, false, true, true, true, false]
    };
    assert.deepEqual(collectPracticeMistakes(quiz).map(row => row.index), [0, 1]);
});

test('partial FIB answers and a zero response are meaningful submissions, not empty answers', async () => {
    const { collectPracticeMistakes } = await mistakes;
    const quiz = { questions: [{ type: 'fib' }, { type: 'short_answer' }], answers: [{ fibAnswers: ['', '0'] }, { shortAnswer: '0' }], feedback: [{ isCorrect: false }, { isCorrect: false }], feedbackShown: [true, true] };
    assert.equal(collectPracticeMistakes(quiz).length, 2);
});

test('review derives from restored practice snapshots and clears with a fresh attempt', async () => {
    const { collectPracticeMistakes } = await mistakes;
    const quiz = { questions: [{ type: 'short_answer', promptHtml: 'Question' }], answers: [{ shortAnswer: 'Incorrect text' }], feedback: [{ isCorrect: false, correctAnswer: 'Teacher answer', explanation: 'Why', aiReview: { marks: 4.2, maxMarks: 10 } }], feedbackShown: [true] };
    const restored = JSON.parse(JSON.stringify(quiz));
    const [row] = collectPracticeMistakes(restored);
    assert.equal(row.feedback.aiReview.marks, 4.2);
    assert.equal(row.feedback.correctAnswer, 'Teacher answer');
    assert.equal(row.feedback.explanation, 'Why');
    restored.feedbackShown = [false];
    assert.deepEqual(collectPracticeMistakes(restored), []);
    assert.deepEqual(collectPracticeMistakes(null), []);
});

test('score sorting uses earned/max ratios with original question order for ties and leaves source rows unchanged', async () => {
    const { sortPracticeMistakes } = await mistakes;
    const rows = [
        { index: 0, feedback: { scored: 5, max: 10 } },
        { index: 1, feedback: { scored: 2, max: 10 } },
        { index: 2, feedback: { scored: 1, max: 2 } },
        { index: 3, feedback: { scored: 0, max: 0 } }
    ];
    const points = feedback => feedback;
    assert.deepEqual(sortPracticeMistakes(rows, 'score-asc', points).map(row => row.index), [1, 0, 2, 3]);
    assert.deepEqual(sortPracticeMistakes(rows, 'score-desc', points).map(row => row.index), [0, 2, 1, 3]);
    assert.deepEqual(sortPracticeMistakes([...rows].reverse(), 'question', points).map(row => row.index), [0, 1, 2, 3]);
    assert.deepEqual(rows.map(row => row.index), [0, 1, 2, 3]);
});
