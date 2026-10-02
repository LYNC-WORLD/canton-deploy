export function nestedDpmExecaOptions(): {
  env: NodeJS.ProcessEnv;
  extendEnv: false;
} {
  const env = { ...process.env };
  delete env.DPM_RESOLUTION_FILE;
  delete env.DPM_SDK_VERSION;
  return { env, extendEnv: false };
}
