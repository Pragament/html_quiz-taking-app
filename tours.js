const stepsByPage = {
    login: [
        { title: 'Student Sign In', intro: 'Use the school email and password provided by your administrator.', element: '#loginForm' },
        { title: 'School Email', intro: 'Enter your student email address.', element: '#emailInput' },
        { title: 'Password', intro: 'Enter your password, then select Sign In to open your dashboard.', element: '#passwordInput' }
    ],
    dashboard: [
        { title: 'Your Section', intro: 'This dashboard shows quiz sessions for your section.', element: '#dashboardWelcome' },
        { title: 'Recent Quiz Sessions', intro: 'Choose a quiz session to open its quiz setup. Sessions are listed newest first.', element: '#sessionList' },
        { title: 'Refresh Sessions', intro: 'Check for newly available quiz sessions.', element: '#refreshSessionsBtn' },
        { title: 'Past Submissions', intro: 'Open your submission history and progress report.', element: '#viewSubmissionsBtn' }
    ],
    setup: [
        { title: 'Quiz Setup', intro: 'Check the selected session before beginning.', element: '#classroomLabel' },
        { title: 'Question Filters', intro: 'Choose the class, subject, difficulty, and question types for this quiz.', element: '#quizFilterControls' },
        { title: 'Question Availability', intro: 'Teacher-selected questions load automatically. An already submitted session includes a link to your submission.', element: '#questionLoadSummary' },
        { title: 'Start Quiz', intro: 'Start once the questions are ready.', element: '#startQuizBtn' }
    ],
    quiz: [
        { title: 'Your Progress', intro: 'Track how many questions you have answered and your running score.', element: '#progressSummary' },
        { title: 'Answer the Question', intro: 'Use the answer controls for the current question.', element: '#answerArea' },
        { title: 'Continue', intro: 'Check your answer when instant feedback is enabled, then continue. Submit after the final question.', element: '#nextQuestionBtn' }
    ],
    result: [
        { title: 'Submission Complete', intro: 'Your quiz has been saved. Review the score summary here.', element: '#resultSummary' },
        { title: 'Review Your Answers', intro: 'See your answers and feedback for this attempt.', element: '#reviewList' },
        { title: 'Submission History', intro: 'Open Past Submissions to revisit this attempt later.', element: '#viewSubmissionsBtn' }
    ],
    submissions: [
        { title: 'Your Submission History', intro: 'Review your past quiz attempts and progress.', element: '#historyStudentName' },
        { title: 'Progress Report', intro: 'Explore your scores, chapter performance, and revision suggestions across submissions.', element: '#studentReport' },
        { title: 'View a Submission', intro: 'Select View Details on an attempt to open its dedicated answer review page.', element: '#historyList' },
        { title: 'Return to Dashboard', intro: 'Choose another available quiz session from your dashboard.', element: '#appHeader a[href="index.html"].btn' }
    ],
    'submission-detail': [
        { title: 'Selected Submission', intro: 'This page reviews one quiz submission.', element: '#historyClassroomLabel' },
        { title: 'Submission Summary', intro: 'Check the quiz session, question counts, score, and subject.', element: '.submission-details' },
        { title: 'Revision Prompts', intro: 'Copy a revision prompt to practice the topics from this attempt.', element: '.submission-prompt-section' },
        { title: 'Filter Answers', intro: 'Switch between all, correct, incorrect, and manually reviewed answers.', element: '.review-tabs' },
        { title: 'Answer Feedback', intro: 'Review your response, expected answer, and any available AI feedback.', element: '.review-card' },
        { title: 'Other Submissions', intro: 'Return to Past Submissions to choose another attempt.', element: '#viewSubmissionsBtn' }
    ]
};
let currentTour = null;
let resolvePage = () => 'dashboard';

export function initializeTours(page) {
    resolvePage = typeof page === 'function' ? page : () => page;
    document.getElementById('tourBtn')?.addEventListener('click', () => startGuidedTour());
}

export function maybePromptGuidedTour(page = resolvePage()) {
    if (localStorage.getItem(`quizActivityHideGuidedTour:${page}`) === 'true') return;
    startGuidedTour(page);
}

export function startGuidedTour(page = resolvePage()) {
    if (!window.introJs || currentTour) return;
    const steps = (stepsByPage[page] || []).filter(step => {
        const element = document.querySelector(step.element);
        return element && element.getClientRects().length && !element.hidden
            && (!(element.id === 'studentReport') || element.textContent.trim());
    });
    if (!steps.length) return;
    let optOut = false;
    const onChange = event => {
        if (event.target.id === 'tourOptOutInput') optOut = event.target.checked;
    };
    document.addEventListener('change', onChange);
    const tour = window.introJs.tour ? window.introJs.tour() : window.introJs();
    currentTour = tour;
    tour.setOptions({
        steps: [{ title: 'Tour This Page', intro: 'A quick walkthrough of this page.<label class="intro-opt-out"><input type="checkbox" id="tourOptOutInput"> Do not show this page tour automatically again</label>' }, ...steps],
        showProgress: true, showBullets: false, nextLabel: 'Next', prevLabel: 'Back', doneLabel: 'Done',
        exitOnOverlayClick: true, tooltipRenderAsHtml: true
    });
    const finish = () => {
        if (optOut) localStorage.setItem(`quizActivityHideGuidedTour:${page}`, 'true');
        document.removeEventListener('change', onChange);
        currentTour = null;
    };
    tour.oncomplete(finish);
    tour.onexit(finish);
    tour.start();
}
