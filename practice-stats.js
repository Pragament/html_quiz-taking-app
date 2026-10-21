export const PRACTICE_STAT_GROUPS = [
    { field: 'topic', label: 'Topic' },
    { field: 'difficulty', label: 'Difficulty' },
    { field: 'skill', label: 'Skill' },
    { field: 'actfl_level', label: 'ACTFL level' },
    { field: 'actfl_sublevel', label: 'ACTFL sublevel' },
    { field: 'actfl_mode', label: 'ACTFL mode' }
];

export function summarizePracticeStats(questions = [], feedback = [], feedbackShown = []) {
    const groups = PRACTICE_STAT_GROUPS.map(group => ({ ...group, rows: new Map() }));
    const totals = { correct: 0, wrong: 0, ungraded: 0, unchecked: 0 };
    questions.forEach((question, index) => {
        const result = feedbackShown[index] ? feedback[index] : null;
        const status = !result ? 'unchecked' : result.isCorrect === true ? 'correct' : result.isCorrect === false ? 'wrong' : 'ungraded';
        totals[status] += 1;
        for (const group of groups) {
            const label = String(question[group.field] || (group.field === 'topic' ? question.topicId : '') || '').trim() || 'Not specified';
            const key = group.field === 'topic' ? question.topicId || label : label;
            if (!group.rows.has(key)) group.rows.set(key, { label, correct: 0, wrong: 0, ungraded: 0, unchecked: 0 });
            group.rows.get(key)[status] += 1;
        }
    });
    return {
        totals,
        groups: groups.map(group => ({ ...group, rows: [...group.rows.values()].sort((a, b) => a.label.localeCompare(b.label)) }))
    };
}
