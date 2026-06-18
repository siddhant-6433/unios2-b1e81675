export const isBscNursingCourse = (course?: { name?: string | null; code?: string | null } | string | null): boolean => {
  const name = typeof course === "string" ? course : course?.name;
  const code = typeof course === "string" ? "" : course?.code;

  if (code === "BSCN-GN") return true;
  if (!name) return false;

  return /b\.?\s*sc(?:ience)?\.?\s+nursing|bsc\s+nursing|bachelor\s+of\s+science\s+in\s+nursing/i.test(name);
};
