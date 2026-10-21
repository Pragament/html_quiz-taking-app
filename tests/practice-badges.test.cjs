const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const badgeModule = import(pathToFileURL(path.resolve('practice-badges.js')).href);

async function evaluate(count, correct, metadata = {}) {
    const { evaluatePracticeBadges } = await badgeModule;
    return evaluatePracticeBadges(
        Array.from({ length: count }, (_, index) => ({ id: `q${index}`, ...metadata })),
        Array.from({ length: count }, (_, index) => ({ isCorrect: index < correct })),
        Array(count).fill(true)
    );
}

test('Topic Master requires at least ten distinct gradable questions and exact 90% accuracy', async () => {
    assert.equal((await evaluate(9, 9, { topic: 'Fractions' }))[0].earned, false);
    assert.equal((await evaluate(10, 9, { topic: 'Fractions' }))[0].earned, true);
    assert.equal((await evaluate(10, 8, { topic: 'Fractions' }))[0].earned, false);
});

test('Difficulty Champion pools Hard/Very Hard and skill, ACTFL-level and mode badges use 80%', async () => {
    const metadata = { difficulty: 'Hard', skill: 'Listening', actfl_level: 'Novice Low', actfl_mode: 'Interpretive' };
    const earned = await evaluate(10, 8, metadata);
    assert.deepEqual(earned.map(badge => badge.name), ['Difficulty Champion', 'Listening Star', 'ACTFL Practice Star', 'Interpretive Explorer']);
    assert.ok(earned.every(badge => badge.earned));
    assert.ok((await evaluate(10, 7, metadata)).every(badge => !badge.earned));
    assert.equal((await evaluate(10, 8, { difficulty: 'Very Hard' }))[0].earned, true);
    assert.deepEqual(await evaluate(10, 10, { difficulty: 'Easy' }), []);
});

test('all supported skills and communication modes award the named practice badges', async () => {
    for (const skill of ['Listening', 'Reading', 'Writing', 'Speaking']) {
        assert.equal((await evaluate(10, 8, { skill }))[0].name, `${skill} Star`);
    }
    for (const actfl_mode of ['Interpretive', 'Interpersonal', 'Presentational']) {
        assert.equal((await evaluate(10, 8, { actfl_mode }))[0].name, `${actfl_mode} Explorer`);
    }
});

test('duplicate questions, missing identities, unchecked feedback and ungraded responses cannot inflate badge counts', async () => {
    const { evaluatePracticeBadges } = await badgeModule;
    const questions = Array.from({ length: 10 }, () => ({ id: 'same', topic: 'Fractions' }));
    const feedback = questions.map(() => ({ isCorrect: true }));
    const shown = questions.map(() => true);
    assert.equal(evaluatePracticeBadges(questions, feedback, shown)[0].checked, 1);
    assert.equal(evaluatePracticeBadges(questions, feedback, shown)[0].earned, false);
    assert.deepEqual(evaluatePracticeBadges([{ topic: 'Fractions' }], [{ isCorrect: true }], [true]), []);
    questions.forEach((q, index) => { q.id = `q${index}`; });
    feedback[0].isCorrect = null;
    shown[1] = false;
    const badge = evaluatePracticeBadges(questions, feedback, shown)[0];
    assert.equal(badge.checked, 8);
    assert.equal(badge.earned, false);
});

test('accuracy rounding never awards a badge below its actual threshold', async () => {
    const badge = (await evaluate(1001, 900, { topic: 'Fractions' }))[0];
    assert.equal(badge.accuracy, 90);
    assert.equal(badge.earned, false);
    const close = (await evaluate(1001, 800, { skill: 'Writing' }))[0];
    assert.equal(close.accuracy, 80);
    assert.equal(close.earned, false);
});

test('separate topics and attempts do not pool counts; restored attempts reproduce eligibility', async () => {
    const { evaluatePracticeBadges } = await badgeModule;
    const questions = Array.from({ length: 10 }, (_, index) => ({ id: `q${index}`, topicId: index < 5 ? 'one' : 'two', topic: 'Basics' }));
    const feedback = questions.map(() => ({ isCorrect: true }));
    assert.ok(evaluatePracticeBadges(questions, feedback, questions.map(() => true)).every(badge => !badge.earned));
    assert.deepEqual(evaluatePracticeBadges(questions, [], []), []);
    const restored = JSON.parse(JSON.stringify({ questions, feedback, shown: questions.map(() => true) }));
    assert.deepEqual(evaluatePracticeBadges(restored.questions, restored.feedback, restored.shown), evaluatePracticeBadges(questions, feedback, restored.shown));
});

test('awards persist within an attempt and after restore, but a restarted attempt begins without awards', async () => {
    const { updatePracticeBadgeAwards } = await badgeModule;
    const quiz = {
        questions: Array.from({ length: 10 }, (_, index) => ({ id: `q${index}`, topic: 'Fractions' })),
        feedback: Array.from({ length: 10 }, () => ({ isCorrect: true })), feedbackShown: Array(10).fill(true)
    };
    assert.equal(updatePracticeBadgeAwards(quiz).earned.size, 1);
    quiz.questions.push({ id: 'q11', topic: 'Fractions' }, { id: 'q12', topic: 'Fractions' });
    quiz.feedback.push({ isCorrect: false }, { isCorrect: false });
    quiz.feedbackShown.push(true, true);
    const restored = JSON.parse(JSON.stringify(quiz));
    assert.equal(updatePracticeBadgeAwards(restored).progress[0].earned, false);
    assert.equal(updatePracticeBadgeAwards(restored).earned.size, 1);
    assert.equal(updatePracticeBadgeAwards(restored).earned.size, 1);
    const restarted = { questions: quiz.questions, feedback: [], feedbackShown: [] };
    assert.equal(updatePracticeBadgeAwards(restarted).earned.size, 0);
});

test('badge storage fields are versioned and final grades are evaluated even before their feedback is shown', async () => {
    const { snapshotPracticeBadges } = await badgeModule;
    const quiz = {
        questions: Array.from({ length: 10 }, (_, index) => ({ id: `q${index}`, topic: 'Fractions' })),
        feedback: Array.from({ length: 10 }, () => ({ isCorrect: true })), feedbackShown: [...Array(9).fill(true), false]
    };
    assert.deepEqual(snapshotPracticeBadges(quiz), { practiceBadgeVersion: 1, practiceBadges: [] });
    const stored = snapshotPracticeBadges(quiz, quiz.feedback);
    assert.equal(stored.practiceBadgeVersion, 1);
    assert.equal(stored.practiceBadges.length, 1);
    assert.equal(stored.practiceBadges[0].name, 'Topic Master');
    assert.equal(stored.practiceBadges[0].correct, 10);
    assert.equal(stored.practiceBadges[0].checked, 10);
    assert.notEqual(stored.practiceBadges[0], quiz.earnedPracticeBadges[0]);
});
