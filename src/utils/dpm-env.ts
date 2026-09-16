export function nestedDpmExecaOptions(): {
  env: NodeJS.ProcessEnv;
  extendEnv: false;
} {
  const env = { ...process.env };
  delete env.DPM_RESOLUTION_FILE;
  return { env, extendEnv: false };
}
