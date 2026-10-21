const clean = value => String(value || '').trim();

export function evaluatePracticeBadges(questions = [], feedback = [], shown = []) {
    const distinct = new Map();
    questions.forEach((question, index) => {
        if (question.id && shown[index] && typeof feedback[index]?.isCorrect === 'boolean') {
            distinct.set(question.id, { question, correct: feedback[index].isCorrect });
        }
    });
    const groups = new Map();
    const add = (id, name, label, icon, threshold, correct) => {
        if (!groups.has(id)) groups.set(id, { id, name, label, icon, threshold, minimum: 10, correct: 0, checked: 0 });
        const badge = groups.get(id);
        badge.checked += 1;
        badge.correct += Number(correct);
    };
    for (const { question: q, correct } of distinct.values()) {
        const topic = clean(q.topic) || clean(q.topicId);
        if (topic) add(`topic:${q.topicId || [q.classId, q.subjectId, q.chapterId, topic].join('|')}`, 'Topic Master', topic, '🎯', 90, correct);
        if (['hard', 'very hard'].includes(clean(q.difficulty).toLowerCase())) add('difficulty:hard', 'Difficulty Champion', 'Hard / Very Hard', '💪', 80, correct);
        const skill = clean(q.skill).toLowerCase();
        const skills = { listening: ['Listening Star', '👂'], reading: ['Reading Star', '📖'], writing: ['Writing Star', '✍️'], speaking: ['Speaking Star', '🗣️'] };
        if (skills[skill]) add(`skill:${skill}`, skills[skill][0], skill.charAt(0).toUpperCase() + skill.slice(1), skills[skill][1], 80, correct);
        const level = clean(q.actfl_level);
        if (level) add(`actfl:${level.toLowerCase()}`, 'ACTFL Practice Star', level, '🌟', 80, correct);
        const mode = clean(q.actfl_mode).toLowerCase();
        const modes = { interpretive: ['Interpretive Explorer', '🔍'], interpersonal: ['Interpersonal Explorer', '🤝'], presentational: ['Presentational Explorer', '🎤'] };
        if (modes[mode]) add(`mode:${mode}`, modes[mode][0], mode.charAt(0).toUpperCase() + mode.slice(1), modes[mode][1], 80, correct);
    }
    return [...groups.values()].map(badge => ({
        ...badge,
        accuracy: badge.checked ? Math.round(badge.correct / badge.checked * 100) : 0,
        earned: badge.checked >= badge.minimum && badge.correct * 100 >= badge.threshold * badge.checked
    }));
}

export function updatePracticeBadgeAwards(quiz) {
    const progress = evaluatePracticeBadges(quiz.questions, quiz.feedback, quiz.feedbackShown);
    const earned = new Map((Array.isArray(quiz.earnedPracticeBadges) ? quiz.earnedPracticeBadges : []).map(badge => [badge.id, badge]));
    for (const badge of progress) if (badge.earned && !earned.has(badge.id)) earned.set(badge.id, { ...badge });
    quiz.earnedPracticeBadges = [...earned.values()];
    return { progress, earned };
}

export function snapshotPracticeBadges(quiz, completedFeedback = null) {
    const source = completedFeedback ? {
        ...quiz, feedback: completedFeedback, feedbackShown: completedFeedback.map(() => true)
    } : quiz;
    const { earned } = updatePracticeBadgeAwards(source);
    quiz.earnedPracticeBadges = [...earned.values()];
    return {
        practiceBadgeVersion: 1,
        practiceBadges: quiz.earnedPracticeBadges.map(badge => ({ ...badge }))
    };
}

export function initializePracticeBadgeHeader({ isVisible, getAttempt }) {
    const header = document.querySelector('#quizView > .nav-panel');
    const section = document.createElement('section');
    section.className = 'practice-badge-header';
    section.id = 'practiceBadgeHeader';
    section.hidden = true;
    section.setAttribute('aria-label', 'Practice achievements');
    section.innerHTML = `
        <div class="practice-badge-heading"><strong>Practice badges</strong><span id="practiceBadgeCount" role="status" aria-live="polite"></span></div>
        <div id="practiceEarnedBadges" class="practice-earned-badges"></div>
        <details class="practice-badge-details"><summary>Badge requirements and progress</summary>
            <p>Current attempt only. Each badge needs 10 distinct checked, gradable questions. Topic Master needs 90% accuracy; all other badges need 80%. Earned badges stay earned for this attempt. Restart begins a new attempt.</p>
            <p>ACTFL badges are practice achievements, not official proficiency certifications.</p>
            <div id="practiceBadgeProgress" class="practice-badge-progress"></div>
        </details>`;
    header.append(section);
    let lastSignature = '';
    function render() {
        section.hidden = !isVisible();
        if (section.hidden) return;
        const quiz = getAttempt();
        if (!quiz) return;
        const { progress, earned } = updatePracticeBadgeAwards(quiz);
        const signature = JSON.stringify({ progress, earned: quiz.earnedPracticeBadges });
        if (signature === lastSignature) return;
        lastSignature = signature;
        const count = section.querySelector('#practiceBadgeCount');
        count.textContent = `${earned.size} earned in this attempt`;
        const list = section.querySelector('#practiceEarnedBadges');
        list.replaceChildren();
        if (!earned.size) {
            const empty = document.createElement('span');
            empty.className = 'practice-badge-empty';
            empty.textContent = 'Check answers to unlock Topic Master, Difficulty Champion, Skill Stars, and ACTFL practice badges.';
            list.append(empty);
        }
        for (const badge of earned.values()) {
            const chip = document.createElement('span');
            chip.className = 'practice-earned-badge';
            chip.textContent = `${badge.icon} ${badge.name} · ${badge.label}`;
            chip.title = `Awarded at ${badge.correct}/${badge.checked} correct (${badge.accuracy}%). Requirement: ${badge.threshold}% across at least ${badge.minimum} distinct questions.`;
            list.append(chip);
        }
        const rows = section.querySelector('#practiceBadgeProgress');
        rows.replaceChildren();
        const entries = progress.length ? progress : [
            { name: 'Topic Master', label: 'Each topic', threshold: 90, minimum: 10, checked: 0, correct: 0, accuracy: 0 },
            { name: 'Difficulty Champion', label: 'Hard / Very Hard', threshold: 80, minimum: 10, checked: 0, correct: 0, accuracy: 0 },
            { name: 'Skill Stars', label: 'Listening, Reading, Writing, Speaking', threshold: 80, minimum: 10, checked: 0, correct: 0, accuracy: 0 },
            { name: 'ACTFL Practice Star / Explorer', label: 'Each level / communication mode', threshold: 80, minimum: 10, checked: 0, correct: 0, accuracy: 0 }
        ];
        for (const badge of entries) {
            const row = document.createElement('p');
            row.textContent = `${earned.has(badge.id) ? '✓ ' : ''}${badge.name} · ${badge.label}: ${badge.correct}/${badge.checked} correct (${badge.accuracy}%) · needs ${badge.threshold}% and at least ${badge.minimum} distinct questions.`;
            rows.append(row);
        }
    }
    const observer = new MutationObserver(render);
    for (const id of ['quizView', 'resultView']) observer.observe(document.getElementById(id), { attributes: true, attributeFilter: ['hidden'] });
    render();
    return { render };
}
