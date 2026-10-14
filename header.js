import { initializeTours } from './tours.js';
import { auth } from './firebase.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

export function initializeHeader({ page, statusId, statusText, tourPage = page }) {
    const header = document.getElementById('appHeader');
    header.innerHTML = `
        <div class="header-brand">
            <h1><a href="index.html">Quiz Activity</a></h1>
            <p id="${statusId}" aria-live="polite"></p>
        </div>
        <nav class="topbar-actions" aria-label="Student navigation">
            <a class="btn" href="index.html" ${page === 'dashboard' ? 'aria-current="page"' : ''}>Dashboard</a>
            <a class="btn" id="viewSubmissionsBtn" href="submissions.html" ${page === 'submissions' ? 'aria-current="page"' : ''}>Past Submissions</a>
            <button class="btn" id="tourBtn" type="button">Tour</button>
            <span class="header-student" id="headerStudent"></span>
            <button class="btn" id="signOutBtn" type="button">Sign Out</button>
        </nav>
        <p class="header-error" id="headerError" role="alert" hidden></p>
    `;
    document.getElementById(statusId).textContent = statusText;
    initializeTours(tourPage);
    const button = document.getElementById('signOutBtn');
    button.addEventListener('click', async () => {
        button.disabled = true;
        const errorBox = document.getElementById('headerError');
        errorBox.hidden = true;
        try { await signOut(auth); }
        catch (error) {
            errorBox.textContent = error.message || 'Unable to sign out. Please try again.';
            errorBox.hidden = false;
            button.disabled = false;
        }
    });
}

export function setHeaderStudent(profile) {
    const student = document.getElementById('headerStudent');
    student.textContent = profile.studentName || profile.email || 'Student';
    student.title = profile.email || '';
}
