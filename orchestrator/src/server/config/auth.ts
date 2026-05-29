export function isAuthDisabled(): boolean {
  return process.env.JOBOPS_AUTH_DISABLED === "1";
}
