export function getStudentClaimToken(searchParams: URLSearchParams): string | null {
  const token = searchParams.get("token")?.trim();
  return token || null;
}
