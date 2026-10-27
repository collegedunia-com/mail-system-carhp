export function cronTrackerOption(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): boolean | undefined {
  let value = env.npm_config_tracker ?? env.NPM_CONFIG_TRACKER;
  if (value === "") value = "false";
  for (const argument of args) {
    const match = /^--tracker(?:=(true|false))?$/.exec(argument);
    if (!match)
      throw new Error(
        "Unknown cron option; use --tracker=true or --tracker=false",
      );
    value = match[1] ?? "true";
  }
  if (value === undefined) return undefined;
  if (value !== "true" && value !== "false")
    throw new Error("--tracker must be true or false");
  return value === "true";
}
