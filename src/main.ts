import "reflect-metadata";
import { runCommand } from "./cli.js";

void runCommand(["cron", "--tracker=true"]);
