export function failureMessageKey(failure) {
  if (!failure) return "archiveAnswered";
  if (failure.reason === "rateLimited") return "archiveRateLimited";
  if (failure.reason === "cooldown") return "archiveCooldown";
  if (failure.reason === "timeout") return "archiveTimedOut";
  if (failure.reason === "response") return "archiveInvalidResponse";
  if (failure.reason === "http") {
    if (failure.status === 401 || failure.status === 403) return "archiveAccessDenied";
    if (failure.status === 404) return "archiveEndpointMissing";
    if (failure.status >= 500) return "archiveServerError";
    return "archiveHttpError";
  }
  return "archiveConnectionError";
}

export function archiveFailureSummary(failures) {
  const keys = failures.filter(Boolean).map(failureMessageKey);
  if (keys.length === 0 || !keys.every(key => key === keys[0])) return "archiveUnavailable";
  if (keys[0] === "archiveRateLimited" || keys[0] === "archiveCooldown") return "archiveLimited";
  if (keys[0] === "archiveTimedOut") return "archiveTimeout";
  if (keys[0] === "archiveConnectionError") return "archiveConnection";
  if (keys[0] === "archiveInvalidResponse") return "archiveResponse";
  if (keys[0] === "archiveAccessDenied") return "archiveDenied";
  return "archiveUnavailable";
}
