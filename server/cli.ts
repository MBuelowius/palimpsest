import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { SkillLibrary, type Tool } from "./library.ts";
import { createServer } from "./http.ts";

import { Marketplaces } from "./marketplaces.ts";
import { SkillReviews, type ReviewSettings } from "./skillReviews.ts";
import { detectHarnesses, harnessDefinitions } from "./harnesses.ts";

const args = process.argv.slice(2);
function option(flag: string) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (
    value === undefined ||
    (!value && flag !== "--model" && flag !== "--context") ||
    value.startsWith("--")
  )
    throw new Error(flag + " needs a value.");
  return value;
}
function print(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}
const help = `Palimpsest

palimpsest ui                         Open the local web UI
palimpsest serve [--port 4319]         Run the server in this terminal
palimpsest stop [--port 4319]          Stop this library’s local server
palimpsest list [--json]               List personal and shared skills
palimpsest harnesses [--json]          Detect installed AI harnesses
palimpsest inspect <name>              Read versions, issues, and diffs
palimpsest review --agent codex        Review setup using installed Codex or Claude
palimpsest review --due                Run a saved automatic review if due
palimpsest review settings             Show review preferences
palimpsest review configure            Set --agent, --model, --context,
                                      --schedule off|weekly|monthly,
                                      --on-change on|off
palimpsest review history              List saved reviews
palimpsest review report <id>          Read a saved report
palimpsest share <name> --source <id>   Preview sharing; add --apply to commit
palimpsest share-identical             Preview identical packages; add --apply
palimpsest sync                        Preview existing skill sync; add --apply
palimpsest enable <name> <harness>
palimpsest disable <name> <harness>
palimpsest marketplace list           List marketplace sources
palimpsest marketplace add <repo>     Add a public GitHub source
palimpsest marketplace browse <id>    List skills in a source
palimpsest marketplace refresh <id>   Download the latest source snapshot
palimpsest marketplace inspect <id> <skill-id>
palimpsest marketplace install <id> <skill-id> [--apply]
palimpsest marketplace remove <id>    Unregister a source
palimpsest history                     List backups and operations
palimpsest restore <operation-id>      Restore the latest operation

Options: --home <directory> (isolated library), --tools <comma-separated harnesses>
Harnesses: ${harnessDefinitions.map((harness) => harness.id).join(", ")}
Sharing and installation default to detected harnesses. --tools overrides detection.
Sources: harness IDs, agents, devin, shared. No skill scripts are executed.
`;

async function main() {
  const library = new SkillLibrary(
    option("--home") ?? process.env.SKILL_LIBRARY_HOME,
  );
  const command = args[0] ?? "ui",
    name = args[1];
  const chosenTools = option("--tools");
  const tools = chosenTools
    ? (chosenTools.split(",") as Tool[])
    : library.detectedTools();
  if (args.includes("--help") || command === "help") {
    process.stdout.write(help);
    return;
  }
  if (command === "harnesses") {
    const harnesses = detectHarnesses(library.home);
    if (args.includes("--json")) print(harnesses);
    else
      for (const harness of harnesses) {
        process.stdout.write(
          `${harness.name.padEnd(20)} ${harness.detected ? "Detected" : "Not detected"}\n`,
        );
        for (const evidence of harness.evidence)
          process.stdout.write(`  ${evidence.kind}: ${evidence.path}\n`);
      }
    return;
  }
  if (command === "review") {
    const reviews = new SkillReviews(library);
    if (name === "settings") return print(reviews.status().settings);
    if (name === "history") return print(reviews.status());
    if (name === "report") {
      if (!args[2]) throw new Error("Provide a review ID from review history.");
      process.stdout.write(reviews.report(args[2]).report + "\n");
      return;
    }
    if (name === "configure") {
      const current = reviews.status().settings;
      const onChange = option("--on-change");
      if (onChange !== undefined && onChange !== "on" && onChange !== "off")
        throw new Error("Use --on-change on or off.");
      return print(
        reviews.saveSettings({
          ...current,
          agent: (option("--agent") ?? current.agent) as Tool,
          model: option("--model") ?? current.model,
          context: option("--context") ?? current.context,
          schedule: (option("--schedule") ??
            current.schedule) as ReviewSettings["schedule"],
          onChange:
            onChange === undefined ? current.onChange : onChange === "on",
        }),
      );
    }
    if (args.includes("--due")) {
      if (
        ["--agent", "--model", "--context"].some((flag) => args.includes(flag))
      )
        throw new Error(
          "Use review configure to set the agent and model context for automatic reviews.",
        );
      return print(await reviews.runDue());
    }
    if (name && !name.startsWith("--"))
      throw new Error("Unknown review command.");
    const result = await reviews.run(
      option("--agent") as Tool | undefined,
      option("--model"),
      option("--context"),
    );
    process.stdout.write(result.report + "\n");
    return;
  }
  if (command === "marketplace") {
    const marketplaces = new Marketplaces(library),
      action = args[1],
      id = args[2],
      skillId = args[3];
    if (action === "list") return print(marketplaces.list());
    if (!id) throw new Error("Provide a repository or source ID.");
    if (action === "add") return print(await marketplaces.add(id));
    if (action === "browse") return print(marketplaces.catalogue(id));
    if (action === "refresh") return print(await marketplaces.refresh(id));
    if (action === "remove") {
      marketplaces.remove(id);
      return print({ removed: id });
    }
    if (!skillId)
      throw new Error("Provide a skill ID from marketplace browse.");
    if (action === "inspect") return print(marketplaces.preview(id, skillId));
    if (action === "install") {
      const preview = marketplaces.preview(id, skillId);
      return print(
        args.includes("--apply")
          ? marketplaces.install(id, skillId, preview.hash, tools)
          : { preview, tools, apply: false },
      );
    }
    throw new Error("Unknown marketplace command.");
  }
  if (command === "stop") {
    const port = Number(option("--port") ?? 4319);
    const runtimeFile = path.join(library.state, `server-${port}.json`);
    if (!fs.existsSync(runtimeFile))
      throw new Error(
        "No server started by Palimpsest is recorded on this port.",
      );
    const runtime = JSON.parse(fs.readFileSync(runtimeFile, "utf8")) as {
      pid: number;
    };
    const response = await fetch(`http://127.0.0.1:${port}/api/runtime`, {
      signal: AbortSignal.timeout(2000),
    });
    const live = (await response.json()) as { pid: number; state: string };
    if (live.pid !== runtime.pid || live.state !== library.state)
      throw new Error(
        "The port now belongs to a different process. It has been left running.",
      );
    process.kill(runtime.pid, "SIGTERM");
    process.stdout.write(
      "Palimpsest server stopped. Skills and app links are unchanged.\n",
    );
    return;
  }
  if (command === "serve" || command === "ui") {
    const port = Number(option("--port") ?? 4319);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error("Choose a port between 1024 and 65535.");
    if (command === "ui") {
      const url = `http://127.0.0.1:${port}`;
      async function running() {
        try {
          const response = await fetch(url + "/api/runtime", {
            signal: AbortSignal.timeout(1500),
          });
          const inventory = (await response.json()) as { state?: string };
          if (inventory.state !== library.state)
            throw new Error(
              "The port belongs to another application or library. Choose --port with a different number.",
            );
          return true;
        } catch (error) {
          if ((error as Error).message.startsWith("The port belongs"))
            throw error;
          return false;
        }
      }
      if (!(await running())) {
        fs.mkdirSync(library.state, { recursive: true, mode: 0o700 });
        const log = fs.openSync(
          path.join(library.state, "server.log"),
          "a",
          0o600,
        );
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(import.meta.url),
            "serve",
            "--home",
            library.home,
            "--port",
            String(port),
          ],
          { detached: true, stdio: ["ignore", log, log] },
        );
        child.unref();
        fs.closeSync(log);
        let ready = false;
        for (let i = 0; i < 30; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (await running()) {
            ready = true;
            break;
          }
        }
        if (!ready)
          throw new Error(
            "The server did not start. Check " +
              path.join(library.state, "server.log"),
          );
      }
      if (process.platform === "darwin" && !args.includes("--no-open"))
        spawn("open", [url], { stdio: "ignore" }).unref();
      process.stdout.write(`Palimpsest: ${url}\n`);
      return;
    }
    const webDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../dist/web",
    );
    const bundledWeb = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "web",
    );
    const server = createServer(
      library,
      fs.existsSync(bundledWeb) ? bundledWeb : webDir,
    );
    server.on("error", (error) => {
      process.stderr.write(error.message + "\n");
      process.exitCode = 1;
    });
    server.listen(port, "127.0.0.1", () => {
      fs.mkdirSync(library.state, { recursive: true, mode: 0o700 });
      const runtimeFile = path.join(library.state, `server-${port}.json`);
      fs.writeFileSync(runtimeFile, JSON.stringify({ pid: process.pid }), {
        mode: 0o600,
      });
      const stop = () =>
        server.close(() => {
          fs.rmSync(runtimeFile, { force: true });
          process.exit(0);
        });
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
      process.stdout.write(
        `Palimpsest: http://127.0.0.1:${port}\nLibrary: ${library.shared}\n`,
      );
    });
    return;
  }
  if (command === "list") {
    const inventory = library.inventory();
    if (args.includes("--json")) print(inventory);
    else {
      process.stdout.write(
        `Skills: ${inventory.counts.total} | Shared: ${inventory.counts.shared} | Conflicts: ${inventory.counts.conflicts}\n\n`,
      );
      for (const skill of inventory.skills)
        process.stdout.write(
          `${skill.name.padEnd(44)} ${skill.status.padEnd(12)} ${skill.tools.join(", ")}${skill.issues.length ? "  [review]" : ""}\n`,
        );
      for (const issue of inventory.scanIssues)
        process.stderr.write(issue + "\n");
    }
    return;
  }
  if (command === "share-identical") {
    print(library.shareIdentical(!args.includes("--apply")));
    return;
  }
  if (command === "sync") {
    const preview = library.syncPlan(tools);
    print(
      args.includes("--apply") && preview.plans.length
        ? {
            ...library.sync(preview.plans, preview.tools),
            skipped: preview.skipped,
          }
        : preview,
    );
    return;
  }
  if (command === "history") {
    print(library.history());
    return;
  }
  if (command === "restore") {
    if (!name) throw new Error("Choose an operation ID.");
    print(library.restore(name));
    return;
  }
  if (!name || name.startsWith("--"))
    throw new Error("Choose a skill name. Run palimpsest --help for commands.");
  if (command === "inspect") {
    print(library.detail(name));
    return;
  }
  const skill = library.skill(name);
  if (command === "share") {
    const source = option("--source");
    if (!source)
      throw new Error(
        "Choose --source from the skill's version IDs in inspect.",
      );
    print(
      args.includes("--apply")
        ? library.share(name, source, skill.revision, tools)
        : library.plan(name, source, skill.revision, tools),
    );
    return;
  }
  if (command === "enable" || command === "disable") {
    const tool = args[2] as Tool;
    print(library.setEnabled(name, tool, command === "enable", skill.revision));
    return;
  }
  throw new Error("Unknown command. Run palimpsest --help.");
}
main().catch((error) => {
  process.stderr.write((error as Error).message + "\n");
  process.exitCode = 1;
});
