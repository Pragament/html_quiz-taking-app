export function activeMemberships(profile, uid) {
    if (!profile || profile.active !== true || profile.authUid !== uid) return [];
    const valid = ([sectionId, entry]) => typeof sectionId === 'string' && !!sectionId.trim()
        && entry?.active === true && typeof entry.admissionNo === 'string' && !!entry.admissionNo.trim()
        && entry.studentKey === `${sectionId}_${entry.admissionNo}`;
    const hasMap = Object.hasOwn(profile, 'memberships');
    const entries = hasMap
        ? (profile.memberships && typeof profile.memberships === 'object' && !Array.isArray(profile.memberships)
            ? Object.entries(profile.memberships) : [])
        : [[profile.sectionId, profile]];
    return entries.filter(valid).map(([sectionId, entry]) => ({
        sectionId, admissionNo: entry.admissionNo, studentKey: entry.studentKey, legacy: !hasMap
    }));
}

export function submissionScope(membership, where) {
    const key = where('studentKey', '==', membership.studentKey);
    return membership.legacy ? [key] : [where('sectionId', '==', membership.sectionId), key];
}

export function ownsSubmission(memberships, submission) {
    return !!submission && memberships.some(m => m.studentKey === submission.studentKey
        && (m.legacy || m.sectionId === submission.sectionId));
}
